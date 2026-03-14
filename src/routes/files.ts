import { createReadStream, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Storage, FileEntry } from '../storage.js'
import type { PokkitConfig } from '../config.js'
import { requireAuth } from '../auth.js'

// Cache-bust: compute hash at startup so download.css changes are picked up on restart
const cssHash = createHash('md5')
  .update(readFileSync(join(import.meta.dirname, '../../public/download.css')))
  .digest('hex')
  .substring(0, 8)

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

  const countdownScript = entry.expires_at && !isExpired
    ? `<script>
(function(){
  var exp = ${entry.expires_at};
  var el = document.getElementById('countdown');
  if (!el) return;
  function tick() {
    var d = exp - Date.now();
    if (d <= 0) { el.textContent = 'Expired'; location.reload(); return; }
    var s = Math.floor(d/1000), m = Math.floor(s/60), h = Math.floor(m/60), dy = Math.floor(h/24);
    s %= 60; m %= 60; h %= 24;
    var t = '';
    if (dy > 0) t += dy + 'd ';
    if (h > 0) t += h + 'h ';
    t += m + 'm ' + s + 's';
    el.textContent = t;
    setTimeout(tick, 1000);
  }
  tick();
})();
</script>`
    : ''

  const countdownBlock = entry.expires_at && !isExpired
    ? `<div class="countdown-bar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>Expires in <strong id="countdown">${timeRemaining(entry.expires_at)}</strong></span>
      </div>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(entry.filename)} — Pokkit</title>
  <meta property="og:title" content="${escapeHtml(entry.filename)}">
  <meta property="og:description" content="${formatBytes(entry.size)} · ${escapeHtml(entry.mime)}${entry.expires_at && !isExpired ? ' · Limited time' : ''}">
  <meta property="og:type" content="${isImage ? 'image' : 'website'}">
  <meta property="og:site_name" content="Pokkit">
  ${isImage ? `<meta property="og:image" content="${baseUrl}${previewUrl}">` : ''}
  <meta name="twitter:card" content="${isImage ? 'summary_large_image' : 'summary'}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/download.css?v=${cssHash}">
</head>
<body>
  <div class="container">
    <nav class="nav">
      <a href="/" class="nav-logo">Pokkit</a>
    </nav>
    ${countdownBlock}
    <main class="download-card">
      ${previewBlock}
      <div class="file-details">
        <h1 class="file-title">${escapeHtml(entry.filename)}</h1>
        <div class="file-meta-row">
          <span class="meta-badge">${formatBytes(entry.size)}</span>
          <span class="meta-badge">${escapeHtml(entry.mime)}</span>
          <span class="meta-badge">${formatDate(entry.uploaded_at)}</span>
          ${entry.download_count > 0 ? `<span class="meta-badge">${entry.download_count} downloads</span>` : ''}
          ${hasPassword ? '<span class="meta-badge locked">Password protected</span>' : ''}
        </div>
      </div>
      <div class="action-area">
        ${actionBlock}
      </div>
      <div class="ad-space" id="ad-top">
        <div data-adman-id="ad_xIof6RgB"></div>
      </div>
    </main>
    <div class="ad-space" id="ad-bottom">
      <div data-adman-id="ad_cT4SnybN"></div>
    </div>
    <footer class="footer">
      <span class="footer-brand">Powered by <a href="/">Pokkit</a> &mdash; free file hosting</span>
    </footer>
  </div>
  <script src="https://adman.isnowfriend.com/embed/adman.js" data-base-url="https://adman.isnowfriend.com" defer></script>
  ${countdownScript}
</body>
</html>`
}

async function serveFile(
  request: FastifyRequest,
  reply: FastifyReply,
  entry: FileEntry,
  storage: Storage,
  opts?: { incrementDownloads?: boolean },
) {
  const filePath = storage.getPath(entry.id)
  if (!filePath) return reply.status(404).send({ error: 'File not found on disk' })

  if (opts?.incrementDownloads) {
    storage.incrementDownloads(entry.id)
  }

  const total = entry.size
  const rangeHeader = request.headers.range

  if (rangeHeader) {
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
    if (!match) {
      return reply.status(416)
        .header('Content-Range', `bytes */${total}`)
        .send({ error: 'Invalid range' })
    }

    const start = match[1] ? parseInt(match[1], 10) : 0
    const end = match[2] ? parseInt(match[2], 10) : total - 1

    if (start >= total || end >= total || start > end) {
      return reply.status(416)
        .header('Content-Range', `bytes */${total}`)
        .send({ error: 'Range not satisfiable' })
    }

    const chunkSize = end - start + 1
    const stream = createReadStream(filePath, { start, end })

    return reply
      .status(206)
      .header('Content-Type', entry.mime)
      .header('Content-Length', chunkSize)
      .header('Content-Range', `bytes ${start}-${end}/${total}`)
      .header('Accept-Ranges', 'bytes')
      .send(stream)
  }

  // No range — full file
  const stream = createReadStream(filePath)
  return reply
    .header('Content-Type', entry.mime)
    .header('Content-Length', total)
    .header('Accept-Ranges', 'bytes')
    .header('Content-Disposition', `inline; filename="${encodeURIComponent(entry.filename)}"`)
    .send(stream)
}

export function filesRoute(app: FastifyInstance, storage: Storage, config: PokkitConfig) {
  // GET /files — list all files (auth required)
  app.get('/files', async (request, reply) => {
    const user = requireAuth(request, reply, config)
    if (!user) return
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

      return serveFile(request, reply, entry, storage)
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

        return serveFile(request, reply, entry, storage, { incrementDownloads: true })
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
      const user = requireAuth(request, reply, config)
      if (!user) return

      const removed = await storage.remove(request.params.id)
      if (!removed) {
        return reply.status(404).send({ error: 'File not found' })
      }
      return { ok: true }
    },
  )
}
