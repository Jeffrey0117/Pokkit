import { createReadStream, statSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import type { Storage } from '../storage.js'
import type { PokkitConfig } from '../config.js'
import { requireAuth, canAccessAlbum, canAccessEntry } from '../auth.js'

export function photosRoute(app: FastifyInstance, storage: Storage, config: PokkitConfig) {
  // ── Albums ──

  // POST /api/albums — create album
  app.post<{ Body: { name: string } }>('/api/albums', async (request, reply) => {
    const user = requireAuth(request, reply, config, storage)
    if (!user) return
    const { name } = request.body || {}
    if (!name || typeof name !== 'string') {
      return reply.status(400).send({ error: 'name is required' })
    }
    const album = storage.createAlbum(name.trim(), user.userId)
    return reply.status(201).send(album)
  })

  // GET /api/albums — list albums (tenant sees only its own; admin sees all)
  app.get('/api/albums', async (request, reply) => {
    const user = requireAuth(request, reply, config, storage)
    if (!user) return
    return storage.listAlbums(user.isAdmin ? {} : { userId: user.userId })
  })

  // GET /api/albums/:id — album detail + photo list
  app.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string; order?: string } }>(
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
      const photos = storage.listPhotosByAlbum(album.id, { limit, offset, order })
      return { ...album, photos }
    },
  )

  // PUT /api/albums/:id — update album
  app.put<{ Params: { id: string }; Body: { name?: string; cover_file_id?: string } }>(
    '/api/albums/:id',
    async (request, reply) => {
      const user = requireAuth(request, reply, config, storage)
      if (!user) return
      const album = storage.getAlbum(request.params.id)
      if (!album || !canAccessAlbum(user, album)) {
        return reply.status(404).send({ error: 'Album not found' })
      }
      const updates: { name?: string; cover_file_id?: string } = {}
      if (request.body?.name) updates.name = request.body.name.trim()
      if (request.body?.cover_file_id) updates.cover_file_id = request.body.cover_file_id
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
  app.get<{ Params: { id: string } }>('/photos/:id/photo.webp', async (request, reply) => {
    const entry = storage.find(request.params.id)
    if (!entry) {
      return reply.status(404).send({ error: 'Photo not found' })
    }
    const filePath = storage.getPath(entry.id)
    if (!filePath) {
      return reply.status(404).send({ error: 'File not found on disk' })
    }
    const reply2 = reply
      .header('Content-Type', 'image/webp')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
    try { reply2.header('Content-Length', statSync(filePath).size) } catch { /* streamed */ }
    return reply2.send(createReadStream(filePath))
  })

  // GET /photos/:id/thumb.webp — serve thumbnail (highest-frequency response)
  app.get<{ Params: { id: string } }>('/photos/:id/thumb.webp', async (request, reply) => {
    const thumbPath = storage.getThumbPath(request.params.id)
    if (!thumbPath) {
      return reply.status(404).send({ error: 'Thumbnail not found' })
    }
    const reply2 = reply
      .header('Content-Type', 'image/webp')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
    try { reply2.header('Content-Length', statSync(thumbPath).size) } catch { /* streamed */ }
    return reply2.send(createReadStream(thumbPath))
  })

  // GET /photos/:id/video.mp4 — serve video with Range support
  app.get<{ Params: { id: string } }>('/photos/:id/video.mp4', async (request, reply) => {
    const entry = storage.find(request.params.id)
    if (!entry || entry.media_type !== 'video') {
      return reply.status(404).send({ error: 'Video not found' })
    }
    const filePath = storage.getPath(entry.id)
    if (!filePath) {
      return reply.status(404).send({ error: 'Video file not found on disk' })
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
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(createReadStream(filePath, { start, end }))
    }

    return reply
      .header('Content-Length', fileSize)
      .header('Content-Type', 'video/mp4')
      .header('Accept-Ranges', 'bytes')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
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
      const mine = storage.findByHash(h).find((m) => m.user_id === user.userId)
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
  app.get<{ Querystring: { limit?: string; offset?: string; type?: string; order?: string } }>(
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
      // Admin/owner sees the personal library (project files excluded); a project
      // account sees only its own media.
      const scope = user.isAdmin ? { excludeAccounts: true } : { userId: user.userId }
      return storage.listAllPhotos({ limit, offset, mediaType, order, ...scope })
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
