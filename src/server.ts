import { join } from 'node:path'
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

export async function createServer(config: PokkitConfig) {
  const app = Fastify({ logger: true })

  await app.register(multipart, { limits: { fileSize: config.maxFileSize } })
  await app.register(cors, { origin: true })
  await app.register(cookie)
  await app.register(formbody)
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' })

  const storage = new Storage(config.dataDir)
  await storage.init()

  // API routes first (take priority over static)
  app.get('/api/health', async () => ({ ok: true }))
  uploadRoute(app, storage, config)
  filesRoute(app, storage, config)
  statusRoute(app, storage, config)

  // Static frontend (fallback)
  await app.register(staticPlugin, {
    root: join(import.meta.dirname, '..', 'public'),
    prefix: '/',
  })

  return app
}
