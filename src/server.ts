import { join } from 'node:path'
import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import cors from '@fastify/cors'
import staticPlugin from '@fastify/static'
import rateLimit from '@fastify/rate-limit'
import cookie from '@fastify/cookie'
import formbody from '@fastify/formbody'
import type { PokkitConfig } from './config.js'
import { Storage } from './storage.js'
import { uploadRoute } from './routes/upload.js'
import { filesRoute } from './routes/files.js'
import { statusRoute } from './routes/status.js'
import { photosRoute } from './routes/photos.js'
import { initPhotoWorker, shutdownWorker } from './photo-worker.js'
import { initVideoWorker, shutdownVideoWorker } from './video-worker.js'

function fileHash(filePath: string): string {
  return createHash('md5').update(readFileSync(filePath)).digest('hex').substring(0, 8)
}

export async function createServer(config: PokkitConfig) {
  const app = Fastify({ logger: true })

  // gzip/brotli for text responses (JSON API, JS, CSS, HTML). Already-compressed
  // media (webp thumbnails, mp4 video) is flagged non-compressible in mime-db and
  // skipped automatically, so this never wastes CPU re-compressing binaries.
  // Loaded optionally so a missing/failed install never blocks server startup
  // (the deploy host can have a stale node_modules without @fastify/compress).
  try {
    const compress = (await import('@fastify/compress')).default
    await app.register(compress, { global: true, threshold: 1024 })
  } catch {
    app.log.warn('@fastify/compress unavailable — responses will not be compressed')
  }
  await app.register(multipart, { limits: { fileSize: config.maxFileSize } })
  await app.register(cors, { origin: true })
  await app.register(cookie)
  await app.register(formbody)
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' })

  const storage = new Storage(config.dataDir)
  await storage.init()

  // Init processing workers
  initPhotoWorker(config.dataDir)
  await initVideoWorker(config.dataDir)

  // ── Auto cache-bust for index.html ──
  // Rebuild the HTML (and the ?v= asset hashes) only when one of the source
  // files actually changes on disk, keyed on mtime. Production stays fast (no
  // work unless a deploy touches the files) while local front-end edits show up
  // on a plain browser refresh — no server restart needed. The HTML itself is
  // sent no-store so the browser always receives the current asset hashes.
  const publicDir = join(import.meta.dirname, '..', 'public')
  const indexPath = join(publicDir, 'index.html')
  const cssPath = join(publicDir, 'style.css')
  const jsPath = join(publicDir, 'app.js')

  let cachedHtml = ''
  let cachedSig = ''

  function buildIndexHtml(): string {
    const sig = [indexPath, cssPath, jsPath].map((p) => statSync(p).mtimeMs).join(':')
    if (sig !== cachedSig) {
      cachedHtml = readFileSync(indexPath, 'utf-8')
        .replace('__CSS_HASH__', fileHash(cssPath))
        .replace('__JS_HASH__', fileHash(jsPath))
      cachedSig = sig
    }
    return cachedHtml
  }

  // Serve the SPA shell (used for / and all client-routed pages).
  function serveApp(reply: import('fastify').FastifyReply) {
    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .send(buildIndexHtml())
  }

  app.get('/', async (_request, reply) => {
    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .send(buildIndexHtml())
  })

  // Which commit is actually running — read once at boot. Lets you instantly
  // confirm what's live (`curl /api/version`) instead of probing routes to guess.
  let buildCommit = 'unknown'
  try {
    buildCommit = execSync('git rev-parse --short HEAD', {
      cwd: join(import.meta.dirname, '..'),
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
  } catch {
    /* not a git checkout — leave 'unknown' */
  }
  const startedAt = new Date().toISOString()

  // API routes
  app.get('/api/health', async () => ({ ok: true }))
  app.get('/api/version', async () => ({ commit: buildCommit, startedAt, pid: process.pid }))
  uploadRoute(app, storage, config)
  filesRoute(app, storage, config, serveApp)
  statusRoute(app, storage, config)
  photosRoute(app, storage, config)

  // SPA fallback: client-routed pages (/folders, /photos, /videos, /account, …)
  // aren't real routes — when a browser navigates straight to one, serve the app
  // shell so client-side routing can render it. Only for GET html navigations;
  // API/XHR/asset 404s still return JSON.
  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && (request.headers.accept || '').includes('text/html')) {
      return serveApp(reply)
    }
    return reply.status(404).send({ error: 'Not found' })
  })

  // Graceful shutdown: terminate workers
  app.addHook('onClose', async () => {
    await shutdownWorker()
    await shutdownVideoWorker()
    storage.close()
  })

  // Static frontend (fallback, index: false so our route handles /)
  await app.register(staticPlugin, {
    root: publicDir,
    prefix: '/',
    index: false,
  })

  return app
}
