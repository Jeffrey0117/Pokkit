import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Storage, FileEntry } from '../storage.js'
import type { PokkitConfig } from '../config.js'

function escapeHtml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }
  return text.replace(/[&<>"']/g, (c) => map[c])
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i]
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => n < 10 ? '0' + n : '' + n
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function timeRemaining(expiresAt: number): string {
  const diff = expiresAt - Date.now()
  if (diff <= 0) return 'Expired'
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ${hours % 24}h remaining`
  if (hours > 0) return `${hours}h remaining`
  const mins = Math.floor(diff / (1000 * 60))
  return `${mins}m remaining`
}

function renderDownloadPage(entry: FileEntry, baseUrl: string, error?: string): string {
  const isImage = entry.mime.startsWith('image/')
  const isVideo = entry.mime.startsWith('video/')
  const isAudio = entry.mime.startsWith('audio/')
  const isExpired = entry.expires_at ? Date.now() > entry.expires_at : false
  const hasPassword = !!entry.password_hash
  const rawUrl = `${baseUrl}/f/${entry.id}?raw=1`
  const previewUrl = `/files/${entry.id}/${encodeURIComponent(entry.filename)}`

  const expiryInfo = entry.expires_at
    ? `<span class="meta-badge ${isExpired ? 'expired' : ''}">${isExpired ? 'Expired' : timeRemaining(entry.expires_at)}</span>`
    : ''

  const previewBlock = isExpired ? '' : !hasPassword ? (
    isImage ? `<div class="preview"><img src="${previewUrl}" alt="${escapeHtml(entry.filename)}" loading="lazy"></div>` :
    isVideo ? `<div class="preview"><video src="${previewUrl}" controls preload="metadata"></video></div>` :
    isAudio ? `<div class="preview"><audio src="${previewUrl}" controls preload="metadata"></audio></div>` :
    ''
  ) : ''

  const errorBlock = error
    ? `<div class="error-msg">${escapeHtml(error)}</div>`
    : ''

  const actionBlock = isExpired
    ? '<div class="expired-msg">This file has expired and is no longer available.</div>'
    : hasPassword
    ? `<form method="POST" action="/f/${entry.id}/verify" class="password-form">
        ${errorBlock}
        <input type="password" name="password" placeholder="Enter password" class="password-input" autofocus required>
        <button type="submit" class="btn btn-primary btn-large">Unlock &amp; Download</button>
      </form>`
    : `<a href="${rawUrl}" class="btn btn-primary btn-large">Download</a>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(entry.filename)} — Pokkit</title>
  <meta property="og:title" content="${escapeHtml(entry.filename)}">
  <meta property="og:description" content="${formatBytes(entry.size)} ${escapeHtml(entry.mime)}">
  <meta property="og:type" content="${isImage ? 'image' : 'website'}">
  ${isImage ? `<meta property="og:image" content="${baseUrl}${previewUrl}">` : ''}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/download.css">
</head>
<body>
  <div class="container">
    <nav class="nav">
      <a href="/" class="nav-logo">Pokkit</a>
    </nav>
    <main class="download-card">
      ${previewBlock}
      <div class="file-details">
        <h1 class="file-title">${escapeHtml(entry.filename)}</h1>
        <div class="file-meta-row">
          <span class="meta-badge">${formatBytes(entry.size)}</span>
          <span class="meta-badge">${escapeHtml(entry.mime)}</span>
          <span class="meta-badge">${formatDate(entry.uploaded_at)}</span>
          ${expiryInfo}
          ${entry.download_count > 0 ? `<span class="meta-badge">${entry.download_count} downloads</span>` : ''}
          ${hasPassword ? '<span class="meta-badge locked">Password protected</span>' : ''}
        </div>
      </div>
      <div class="action-area">
        ${actionBlock}
      </div>
      <div class="ad-space" id="ad-top"></div>
    </main>
    <footer class="footer">
      <a href="/">Upload your files</a>
    </footer>
  </div>
</body>
</html>`
}

async function serveRawFile(
  reply: FastifyReply,
  entry: FileEntry,
  storage: Storage,
) {
  storage.incrementDownloads(entry.id)
  const stream = storage.getStream(entry.id)
  if (!stream) return reply.status(404).send({ error: 'File not found on disk' })

  return reply
    .header('Content-Type', entry.mime)
    .header('Content-Length', entry.size)
    .header('Content-Disposition', `inline; filename="${encodeURIComponent(entry.filename)}"`)
    .send(stream)
}

export function filesRoute(app: FastifyInstance, storage: Storage, config: PokkitConfig) {
  // GET /files — list all files (auth required)
  app.get('/files', async (request, reply) => {
    if (config.apiKey) {
      const auth = request.headers.authorization
      if (auth !== `Bearer ${config.apiKey}`) {
        return reply.status(401).send({ error: 'Unauthorized' })
      }
    }
    return storage.list()
  })

  // GET /files/:id/:filename — direct file download (no auth, for streaming/embedding)
  app.get<{ Params: { id: string; filename: string } }>(
    '/files/:id/:filename',
    async (request, reply) => {
      const { id } = request.params
      const entry = storage.find(id)
      if (!entry) {
        return reply.status(404).send({ error: 'File not found' })
      }

      // Check expiry
      if (storage.isExpired(entry)) {
        return reply.status(410).send({ error: 'File expired' })
      }

      // Check password via cookie
      if (entry.password_hash) {
        const cookieName = `pokkit_pass_${id}`
        const cookies = (request as FastifyRequest & { cookies: Record<string, string> }).cookies || {}
        if (cookies[cookieName] !== '1') {
          return reply.redirect(`/f/${id}`)
        }
      }

      const stream = storage.getStream(id)
      if (!stream) {
        return reply.status(404).send({ error: 'File not found on disk' })
      }

      return reply
        .header('Content-Type', entry.mime)
        .header('Content-Length', entry.size)
        .send(stream)
    },
  )

  // GET /f/:id — smart routing: download page (browser) or raw file (API)
  app.get<{ Params: { id: string }; Querystring: { raw?: string } }>(
    '/f/:id',
    async (request, reply) => {
      const entry = storage.find(request.params.id)
      if (!entry) {
        return reply.status(404).send({ error: 'File not found' })
      }

      const acceptHeader = request.headers.accept || ''
      const isRaw = request.query.raw === '1'
      const isBrowser = acceptHeader.includes('text/html')

      // Raw file serving (API clients, curl, ?raw=1)
      if (isRaw || !isBrowser) {
        // Check expiry
        if (storage.isExpired(entry)) {
          return reply.status(410).send({ error: 'File expired' })
        }

        // Check password via cookie for raw
        if (entry.password_hash) {
          const cookieName = `pokkit_pass_${entry.id}`
          const cookies = (request as FastifyRequest & { cookies: Record<string, string> }).cookies || {}
          if (cookies[cookieName] !== '1') {
            return reply.status(401).send({ error: 'Password required' })
          }
        }

        return serveRawFile(reply, entry, storage)
      }

      // HTML download page (browsers)
      let baseUrl: string
      if (config.publicUrl) {
        baseUrl = config.publicUrl
      } else {
        const host = request.headers.host ?? `${request.hostname}:${config.port}`
        const proto = (request.headers['x-forwarded-proto'] as string) ?? 'http'
        baseUrl = `${proto}://${host}`
      }

      return reply
        .header('Content-Type', 'text/html; charset=utf-8')
        .send(renderDownloadPage(entry, baseUrl))
    },
  )

  // POST /f/:id/verify — password verification
  app.post<{ Params: { id: string } }>(
    '/f/:id/verify',
    async (request, reply) => {
      const entry = storage.find(request.params.id)
      if (!entry) {
        return reply.status(404).send({ error: 'File not found' })
      }

      if (!entry.password_hash) {
        return reply.redirect(`/f/${entry.id}?raw=1`)
      }

      // Parse URL-encoded body
      const body = request.body as Record<string, string> | undefined
      const password = body?.password || ''

      if (!storage.verifyPassword(entry, password)) {
        let baseUrl: string
        if (config.publicUrl) {
          baseUrl = config.publicUrl
        } else {
          const host = request.headers.host ?? `${request.hostname}:${config.port}`
          const proto = (request.headers['x-forwarded-proto'] as string) ?? 'http'
          baseUrl = `${proto}://${host}`
        }
        return reply
          .status(401)
          .header('Content-Type', 'text/html; charset=utf-8')
          .send(renderDownloadPage(entry, baseUrl, 'Wrong password'))
      }

      // Set cookie and redirect to raw download
      const cookieName = `pokkit_pass_${entry.id}`
      return reply
        .setCookie(cookieName, '1', {
          path: '/',
          maxAge: 3600,
          httpOnly: true,
          sameSite: 'lax',
        })
        .redirect(`/f/${entry.id}?raw=1`)
    },
  )

  // DELETE /files/:id — remove file (auth required)
  app.delete<{ Params: { id: string } }>(
    '/files/:id',
    async (request, reply) => {
      if (config.apiKey) {
        const auth = request.headers.authorization
        if (auth !== `Bearer ${config.apiKey}`) {
          return reply.status(401).send({ error: 'Unauthorized' })
        }
      }

      const removed = await storage.remove(request.params.id)
      if (!removed) {
        return reply.status(404).send({ error: 'File not found' })
      }
      return { ok: true }
    },
  )
}
