import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
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

  // ── ver2: auto cache-bust for index.html ──
  const publicDir = join(import.meta.dirname, '..', 'public')
  const indexHtml = readFileSync(join(publicDir, 'index.html'), 'utf-8')
    .replace('__CSS_HASH__', fileHash(join(publicDir, 'style.css')))
    .replace('__JS_HASH__', fileHash(join(publicDir, 'app.js')))

  app.get('/', async (_request, reply) => {
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(indexHtml)
  })

  // API routes
  app.get('/api/health', async () => ({ ok: true }))
  uploadRoute(app, storage, config)
  filesRoute(app, storage, config)
  statusRoute(app, storage, config)
  photosRoute(app, storage, config)

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
