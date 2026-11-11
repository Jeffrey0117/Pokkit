import { isHotlinked } from '../hotlink.js'
import { isMachineAdmin, librarySelector } from '../auth.js'
import { publicBaseUrl } from '../public-url.js'
import { createReadStream, statSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Storage } from '../storage.js'
import type { PokkitConfig } from '../config.js'
import { requireAuth, canAccessAlbum, canAccessEntry } from '../auth.js'
import { MEDIA_ROUTE } from '../rate-limits.js'

function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }
  return String(text).replace(/[&<>"']/g, (c) => map[c])
}

function shareBaseUrl(request: FastifyRequest, config: PokkitConfig): string {
  return publicBaseUrl(request, config)
}

export function photosRoute(app: FastifyInstance, storage: Storage, config: PokkitConfig) {
  // ── Albums ──

  // POST /api/albums — create album
  // 資料夾只有一層:目標必須是自己看得到、本身不在別的資料夾裡的相簿
  type AlbumRow = { id: string; user_id?: string | null; parent_id?: string | null }
  function folderProblem(user: Parameters<typeof canAccessAlbum>[0], albumId: string | null, parentId: string): { status: number; error: string } | null {
    if (albumId && parentId === albumId) return { status: 400, error: 'An album cannot contain itself' }
    const parent = storage.getAlbum(parentId) as AlbumRow | undefined
    if (!parent || !canAccessAlbum(user, parent)) return { status: 404, error: 'Folder not found' }
    if (parent.parent_id) return { status: 400, error: 'Folders only go one level deep' }
    if (albumId && storage.listAlbums({}).some((a) => (a as AlbumRow).parent_id === albumId)) {
      return { status: 400, error: 'This album already holds other albums' }
    }
    return null
  }

  app.post<{ Body: { name: string; parent_id?: string | null } }>('/api/albums', async (request, reply) => {
    const user = requireAuth(request, reply, config, storage)
    if (!user) return
    const { name, parent_id: parentId } = request.body || {}
    if (!name || typeof name !== 'string') {
      return reply.status(400).send({ error: 'name is required' })
    }
    if (parentId) {
      const problem = folderProblem(user, null, String(parentId))
      if (problem) return reply.status(problem.status).send({ error: problem.error })
    }
    const album = storage.createAlbum(name.trim(), user.userId, parentId ? String(parentId) : null)
    return reply.status(201).send(album)
  })

  // GET /api/albums — 每個人只看自己的相簿,機器身分才看全部
  app.get('/api/albums', async (request, reply) => {
    const user = requireAuth(request, reply, config, storage)
    if (!user) return
    if (isMachineAdmin(user)) return storage.listAlbums({})
    // 沒有擁有者的舊相簿是站長多租戶之前建的,只有管理員看得到
    return storage.listAlbums({ userId: user.userId, includeUnowned: !!user.isAdmin })
  })

  // GET /api/albums/:id — album detail + photo list
  app.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string; order?: string; sort?: string } }>(
    '/api/albums/:id',
    async (request, reply) => {
      const user = requireAuth(request, reply, config, storage)
      if (!user) return
      const album = storage.getAlbum(request.params.id)
      if (!album || !canAccessAlbum(user, album)) {
        return reply.status(404).send({ error: 'Album not found' })
      }
      const limit = Math.min(parseInt(request.query.limit || '200', 10) || 200, 1000)
      const offset = parseInt(request.query.offset || '0', 10) || 0
      const order = request.query.order === 'asc' ? 'asc' : 'desc'
      const sortBy = request.query.sort === 'uploaded' ? 'uploaded' : 'taken'
      const photos = storage.listPhotosByAlbum(album.id, { limit, offset, order, sortBy })
      const visible = isMachineAdmin(user) ? storage.listAlbums({}) : storage.listAlbums({ userId: user.userId, includeUnowned: !!user.isAdmin })
      const children = visible.filter((a) => (a as AlbumRow).parent_id === album.id)
      return { ...album, photos, children }
    },
  )

  // PUT /api/albums/:id — update album
  app.put<{ Params: { id: string }; Body: { name?: string; cover_file_id?: string; parent_id?: string | null } }>(
    '/api/albums/:id',
    async (request, reply) => {
      const user = requireAuth(request, reply, config, storage)
      if (!user) return
      const album = storage.getAlbum(request.params.id)
      if (!album || !canAccessAlbum(user, album)) {
        return reply.status(404).send({ error: 'Album not found' })
      }
      const updates: { name?: string; cover_file_id?: string; parent_id?: string | null } = {}
      if (request.body?.name) updates.name = request.body.name.trim()
      if (request.body?.cover_file_id) updates.cover_file_id = request.body.cover_file_id
      if (request.body && 'parent_id' in request.body) {
        const parentId = request.body.parent_id ? String(request.body.parent_id) : null
        if (parentId) {
          const problem = folderProblem(user, album.id, parentId)
          if (problem) return reply.status(problem.status).send({ error: problem.error })
        }
        updates.parent_id = parentId
      }
      const ok = storage.updateAlbum(request.params.id, updates)
      if (!ok) {
        return reply.status(404).send({ error: 'Album not found or no changes' })
      }
      return { ok: true }
    },
  )

  // DELETE /api/albums/:id — delete album (photos kept)
  app.delete<{ Params: { id: string } }>('/api/albums/:id', async (request, reply) => {
    const user = requireAuth(request, reply, config, storage)
    if (!user) return
    const existing = storage.getAlbum(request.params.id)
    if (!existing || !canAccessAlbum(user, existing)) {
      return reply.status(404).send({ error: 'Album not found' })
    }
    const ok = storage.deleteAlbum(request.params.id)
    if (!ok) {
      return reply.status(404).send({ error: 'Album not found' })
    }
    return { ok: true }
  })

  // ── Photo Serving ──

  // GET /photos/:id/photo.webp — serve compressed photo
  // ── Public album sharing ──
  // POST: mint (or return the existing) share token — owner/admin only.
  app.post<{ Params: { id: string } }>('/api/albums/:id/share', async (request, reply) => {
    const user = requireAuth(request, reply, config, storage)
    if (!user) return
    const album = storage.getAlbum(request.params.id)
    if (!album || !canAccessAlbum(user, album)) {
      return reply.status(404).send({ error: 'Album not found' })
    }
    let token = (album as { share_token?: string | null }).share_token ?? null
    if (!token) {
      token = randomBytes(12).toString('base64url')
      storage.setAlbumShareToken(album.id, token)
    }
    return { token, url: `${shareBaseUrl(request, config)}/a/${token}` }
  })

  // DELETE: revoke the share link (the /a/ page 404s immediately after).
  app.delete<{ Params: { id: string } }>('/api/albums/:id/share', async (request, reply) => {
    const user = requireAuth(request, reply, config, storage)
    if (!user) return
    const album = storage.getAlbum(request.params.id)
    if (!album || !canAccessAlbum(user, album)) {
      return reply.status(404).send({ error: 'Album not found' })
    }
    storage.setAlbumShareToken(album.id, null)
    return { ok: true }
  })

  // GET /a/:token — public album page (no auth: the token IS the capability).
  // Media is referenced through the already-public /photos/:id/* routes.
  app.get<{ Params: { token: string } }>('/a/:token', async (request, reply) => {
    const token = request.params.token
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) {
      return reply.status(404).send({ error: 'Not found' })
    }
    const album = storage.findAlbumByShareToken(token)
    if (!album) return reply.status(404).send({ error: 'Not found' })
    const photos = storage.listPhotosByAlbum(album.id, { limit: 500, offset: 0, order: 'asc' })
      .filter((p) => p.status === 'ready')
    const baseUrl = shareBaseUrl(request, config)
    const name = escapeHtml(album.name)
    const cover = photos.find((p) => p.media_type === 'photo') ?? photos[0]
    const ogImage = cover ? `${baseUrl}/photos/${cover.id}/thumb.webp` : ''
    const cells = photos.map((p) => {
      const thumb = `/photos/${p.id}/thumb.webp`
      const full = p.media_type === 'video' ? `/photos/${p.id}/video.mp4` : `/photos/${p.id}/photo.webp`
      const badge = p.media_type === 'video' ? '<span class="badge">▶</span>' : ''
      return `<a class="cell" href="${full}" target="_blank" rel="noopener">${badge}<img src="${thumb}" loading="lazy" alt=""></a>`
    }).join('')
    const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${name} — Pokkit</title>
  <meta property="og:title" content="${name}">
  <meta property="og:description" content="${photos.length} items · Shared with Pokkit">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Pokkit">
  ${ogImage ? `<meta property="og:image" content="${ogImage}">` : ''}
  <meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
  <meta name="robots" content="noindex">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #030303; color: #fff; font-family: Inter, 'Noto Sans TC', system-ui, sans-serif; }
    .wrap { max-width: 1080px; margin: 0 auto; padding: 24px 16px 48px; }
    .head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    h1 { font-size: 1.4rem; }
    .count { color: #a1a1aa; font-size: 0.875rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 6px; }
    .cell { position: relative; display: block; aspect-ratio: 1; border-radius: 8px; overflow: hidden; background: #111; }
    .cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .badge { position: absolute; top: 6px; right: 8px; z-index: 1; font-size: 0.75rem; background: rgba(0,0,0,.6); border-radius: 6px; padding: 2px 7px; }
    .foot { margin-top: 28px; text-align: center; }
    .foot a { color: #a1a1aa; font-size: 0.8125rem; text-decoration: none; }
    .foot a:hover { color: #fff; }
    .empty { color: #71717a; padding: 48px 0; text-align: center; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="head"><h1>${name}</h1><span class="count">${photos.length} items</span></div>
    ${photos.length ? `<div class="grid">${cells}</div>` : '<div class="empty">This album is empty.</div>'}
    <div class="foot"><a href="${baseUrl}/">Powered by Pokkit</a></div>
  </div>
</body>
</html>`
    return reply.header('Content-Type', 'text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(html)
  })

  // 上鎖或過期的檔案不能從展示網址繞過去
  const notServable = (entry: { password_hash?: string | null } & object) =>
    !!entry.password_hash || storage.isExpired(entry as never)

  app.get<{ Params: { id: string } }>('/photos/:id/photo.webp', MEDIA_ROUTE, async (request, reply) => {
    if (isHotlinked(request, config)) return reply.status(403).header('Cache-Control', 'no-store').send({ error: 'Hotlinking is not allowed' })
    const entry = storage.find(request.params.id)
    if (!entry || notServable(entry)) {
      // no-store: 處理中/尚未生成時瀏覽器絕不能記住這個負面結果
      // (實案:佇列堵塞期間 404 被瀏覽器咬住,縮圖好了還顯示破圖要強制刷新)
      return reply.status(404).header('Cache-Control', 'no-store').send({ error: 'Photo not found' })
    }
    const filePath = storage.getPath(entry.id)
    if (!filePath) {
      return reply.status(404).header('Cache-Control', 'no-store').send({ error: 'File not found on disk' })
    }
    const reply2 = reply
      .header('Content-Type', 'image/webp')
      .header('Cache-Control', 'private, max-age=86400')
    try { reply2.header('Content-Length', statSync(filePath).size) } catch { /* streamed */ }
    return reply2.send(createReadStream(filePath))
  })

  // GET /photos/:id/thumb.webp — serve thumbnail (highest-frequency response)
  app.get<{ Params: { id: string } }>('/photos/:id/thumb.webp', MEDIA_ROUTE, async (request, reply) => {
    if (isHotlinked(request, config)) return reply.status(403).header('Cache-Control', 'no-store').send({ error: 'Hotlinking is not allowed' })
    const thumbEntry = storage.find(request.params.id)
    const thumbPath = thumbEntry && !notServable(thumbEntry) ? storage.getThumbPath(request.params.id) : null
    if (!thumbPath) {
      // no-store: 縮圖還在生成時的 404 不能被快取(見上)
      return reply.status(404).header('Cache-Control', 'no-store').send({ error: 'Thumbnail not found' })
    }
    const reply2 = reply
      .header('Content-Type', 'image/webp')
      .header('Cache-Control', 'private, max-age=86400')
    try { reply2.header('Content-Length', statSync(thumbPath).size) } catch { /* streamed */ }
    return reply2.send(createReadStream(thumbPath))
  })

  // GET /photos/:id/video.mp4 — serve video with Range support
  app.get<{ Params: { id: string } }>('/photos/:id/video.mp4', MEDIA_ROUTE, async (request, reply) => {
    if (isHotlinked(request, config)) return reply.status(403).header('Cache-Control', 'no-store').send({ error: 'Hotlinking is not allowed' })
    const entry = storage.find(request.params.id)
    if (!entry || entry.media_type !== 'video' || notServable(entry)) {
      return reply.status(404).header('Cache-Control', 'no-store').send({ error: 'Video not found' })
    }
    const filePath = storage.getPath(entry.id)
    if (!filePath) {
      return reply.status(404).header('Cache-Control', 'no-store').send({ error: 'Video file not found on disk' })
    }

    const stat = statSync(filePath)
    const fileSize = stat.size
    const range = request.headers.range

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1

      if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
        return reply
          .status(416)
          .header('Content-Range', `bytes */${fileSize}`)
          .send({ error: 'Range not satisfiable' })
      }

      const chunkSize = end - start + 1

      return reply
        .status(206)
        .header('Content-Range', `bytes ${start}-${end}/${fileSize}`)
        .header('Accept-Ranges', 'bytes')
        .header('Content-Length', chunkSize)
        .header('Content-Type', 'video/mp4')
        .header('Cache-Control', 'private, max-age=86400')
        .send(createReadStream(filePath, { start, end }))
    }

    return reply
      .header('Content-Length', fileSize)
      .header('Content-Type', 'video/mp4')
      .header('Accept-Ranges', 'bytes')
      .header('Cache-Control', 'private, max-age=86400')
      .send(createReadStream(filePath))
  })

  // GET /api/photos/:id/original — 影片原始檔(_raw.*),給同機其他服務(plottr)
  // 匯入用。auth + owner only;展示版 video.mp4 是 1080p 轉檔,出片要拿原檔。
  // 沒 raw(歷史資料)退回展示版,Content-Type 跟著實際給出去的檔。
  app.get<{ Params: { id: string } }>('/api/photos/:id/original', async (request, reply) => {
    const user = requireAuth(request, reply, config, storage)
    if (!user) return
    const entry = storage.find(request.params.id)
    if (!entry || entry.media_type !== 'video') {
      return reply.status(404).header('Cache-Control', 'no-store').send({ error: 'Video not found' })
    }
    if (!canAccessEntry(user, entry)) {
      return reply.status(403).send({ error: 'Not your file' })
    }
    const rawPath = storage.getOriginalPath(entry.id)
    const filePath = rawPath ?? storage.getPath(entry.id)
    if (!filePath) {
      return reply.status(404).header('Cache-Control', 'no-store').send({ error: 'Video file not found on disk' })
    }
    let size: number
    try { size = statSync(filePath).size } catch {
      return reply.status(404).header('Cache-Control', 'no-store').send({ error: 'Video file not found on disk' })
    }
    const mime = rawPath ? (entry.mime || 'application/octet-stream') : 'video/mp4'
    const safeName = encodeURIComponent(entry.filename || `${entry.id}.mp4`)
    return reply
      .header('Content-Type', mime)
      .header('Content-Length', size)
      .header('Content-Disposition', `attachment; filename*=UTF-8''${safeName}`)
      .header('X-Pokkit-Original', rawPath ? '1' : '0')
      .header('Cache-Control', 'private, no-store')
      .send(createReadStream(filePath))
  })

  // POST /api/check-hashes — given SHA-256 hashes, return which ones the current
  // user already has. Lets the client skip re-uploading exact duplicates entirely
  // (no transfer) instead of finding out server-side after the bytes are sent.
  // User-scoped so it never leaks whether *another* user has a given file.
  app.post<{ Body: { hashes?: string[] } }>('/api/check-hashes', async (request, reply) => {
    const user = requireAuth(request, reply, config, storage)
    if (!user) return
    const hashes = Array.isArray(request.body?.hashes) ? request.body!.hashes.slice(0, 2000) : []
    const existing: Record<string, { id: string }> = {}
    for (const h of hashes) {
      if (typeof h !== 'string' || !h || existing[h]) continue
      // 垃圾桶和失敗的不算已上傳,不然用戶重傳被跳過,之後垃圾桶清掉就真的沒了
      const mine = storage.findByHash(h).find((m) => {
        const row = m as { user_id?: string | null; deleted_at?: number | null; status?: string }
        return row.user_id === user.userId && !row.deleted_at && row.status !== 'failed'
      })
      if (mine) existing[h] = { id: mine.id }
    }
    return { existing }
  })

  // GET /api/photos/status?ids=a,b,c — batch processing status.
  // Lets the client poll many in-flight uploads with a single request instead
  // of one request per item.
  app.get<{ Querystring: { ids?: string } }>('/api/photos/status', async (request, reply) => {
    const user = requireAuth(request, reply, config, storage)
    if (!user) return
    const ids = (request.query.ids || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 500)
    const statuses: Record<
      string,
      { status: string; duration: number | null; media_type: string }
    > = {}
    for (const id of ids) {
      const meta = storage.getPhotoMeta(id)
      if (meta) statuses[id] = meta
    }
    return { statuses }
  })

  // GET /api/photos/:id/status — processing status
  app.get<{ Params: { id: string } }>('/api/photos/:id/status', async (request, reply) => {
    const user = requireAuth(request, reply, config, storage)
    if (!user) return
    const status = storage.getPhotoStatus(request.params.id)
    if (!status) {
      return reply.status(404).send({ error: 'Photo not found' })
    }
    return { id: request.params.id, status }
  })

  // GET /api/photos — list all photos (across all albums)
  app.get<{ Querystring: { limit?: string; offset?: string; type?: string; order?: string; sort?: string } }>(
    '/api/photos',
    async (request, reply) => {
      const user = requireAuth(request, reply, config, storage)
      if (!user) return
      const limit = Math.min(parseInt(request.query.limit || '200', 10) || 200, 1000)
      const offset = parseInt(request.query.offset || '0', 10) || 0
      const mediaType =
        request.query.type === 'video' || request.query.type === 'photo'
          ? request.query.type
          : undefined
      const order = request.query.order === 'asc' ? 'asc' : 'desc'
      const sortBy = request.query.sort === 'uploaded' ? 'uploaded' : 'taken'
      const scope = librarySelector(user)
      return storage.listAllPhotos({ limit, offset, mediaType, order, sortBy, ...scope })
    },
  )

  // PUT /api/photos/:id — update photo (notes, etc.)
  app.put<{ Params: { id: string }; Body: { notes?: string } }>(
    '/api/photos/:id',
    async (request, reply) => {
      const user = requireAuth(request, reply, config, storage)
      if (!user) return
      const entry = storage.find(request.params.id)
      if (!entry || !canAccessEntry(user, entry)) {
        return reply.status(404).send({ error: 'Photo not found' })
      }

      const updates: Record<string, unknown> = {}
      if (request.body?.notes !== undefined) {
        const trimmed = (request.body.notes || '').trim()
        updates.notes = trimmed || null
      }
      if (Object.keys(updates).length === 0) {
        return reply.status(400).send({ error: 'No updates provided' })
      }
      storage.updatePhotoNotes(request.params.id, updates.notes as string | null)
      return { ok: true }
    },
  )

  // PUT /api/photos/bulk-move — move multiple photos to an album
  app.put<{ Body: { photo_ids: string[]; album_id: string } }>(
    '/api/photos/bulk-move',
    async (request, reply) => {
      const user = requireAuth(request, reply, config, storage)
      if (!user) return
      const { photo_ids, album_id } = request.body || {}
      if (!Array.isArray(photo_ids) || photo_ids.length === 0) {
        return reply.status(400).send({ error: 'photo_ids array is required' })
      }
      if (!album_id || typeof album_id !== 'string') {
        return reply.status(400).send({ error: 'album_id is required' })
      }
      const album = storage.getAlbum(album_id)
      if (!album || !canAccessAlbum(user, album)) {
        return reply.status(404).send({ error: 'Album not found' })
      }
      // Non-admin callers can only move photos they own (enforced in SQL).
      const result = storage.bulkMoveToAlbum(
        photo_ids,
        album_id,
        user.isAdmin ? {} : { userId: user.userId },
      )
      return { ok: true, moved: result.changes }
    },
  )

  // POST /api/photos/bulk-trash — 多選批次移入垃圾桶(可還原)
  app.post<{ Body: { photo_ids: string[] } }>(
    '/api/photos/bulk-trash',
    async (request, reply) => {
      const user = requireAuth(request, reply, config, storage)
      if (!user) return
      const ids = Array.isArray(request.body?.photo_ids) ? request.body!.photo_ids.slice(0, 1000) : []
      if (ids.length === 0) return reply.status(400).send({ error: 'photo_ids array is required' })
      let trashed = 0
      for (const id of ids) {
        const entry = storage.find(id)
        if (!entry || !canAccessEntry(user, entry)) continue
        if (storage.softDelete(id)) trashed++
      }
      return { ok: true, trashed }
    },
  )

  // PUT /api/photos/:id/album — move photo to album
  app.put<{ Params: { id: string }; Body: { album_id: string | null } }>(
    '/api/photos/:id/album',
    async (request, reply) => {
      const user = requireAuth(request, reply, config, storage)
      if (!user) return
      const entry = storage.find(request.params.id)
      if (!entry || !canAccessEntry(user, entry)) {
        return reply.status(404).send({ error: 'Photo not found' })
      }
      const albumId = request.body?.album_id ?? null
      if (albumId) {
        const album = storage.getAlbum(albumId)
        if (!album || !canAccessAlbum(user, album)) {
          return reply.status(404).send({ error: 'Album not found' })
        }
      }
      storage.moveToAlbum(request.params.id, albumId)
      return { ok: true }
    },
  )
}
