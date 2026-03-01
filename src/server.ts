import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import cors from '@fastify/cors'
import type { PokkitConfig } from './config.js'
import { Storage } from './storage.js'
import { uploadRoute } from './routes/upload.js'
import { filesRoute } from './routes/files.js'
import { statusRoute } from './routes/status.js'

export async function createServer(config: PokkitConfig) {
  const app = Fastify({ logger: true })

  await app.register(multipart, { limits: { fileSize: config.maxFileSize } })
  await app.register(cors, { origin: true })

  const storage = new Storage(config.dataDir)
  await storage.init()

  uploadRoute(app, storage, config)
  filesRoute(app, storage, config)
  statusRoute(app, storage, config)

  return app
}
