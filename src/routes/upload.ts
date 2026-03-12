import type { FastifyInstance } from 'fastify'
import type { Storage } from '../storage.js'
import type { PokkitConfig } from '../config.js'

export function uploadRoute(app: FastifyInstance, storage: Storage, config: PokkitConfig) {
  app.post('/upload', async (request, reply) => {
    if (config.apiKey) {
      const auth = request.headers.authorization
      if (auth !== `Bearer ${config.apiKey}`) {
        return reply.status(401).send({ error: 'Unauthorized' })
      }
    }

    const file = await request.file()
    if (!file) {
      return reply.status(400).send({ error: 'No file provided. Use multipart field "file".' })
    }

    const buffer = await file.toBuffer()
    const entry = await storage.save(
      file.filename,
      file.mimetype,
      buffer,
    )

    const shortPath = `/f/${entry.id}`
    const fullPath = `/files/${entry.id}/${encodeURIComponent(entry.filename)}`
    let baseUrl: string
    if (config.publicUrl) {
      baseUrl = config.publicUrl
    } else {
      const host = request.headers.host ?? `${request.hostname}:${config.port}`
      const proto = (request.headers['x-forwarded-proto'] as string) ?? 'http'
      baseUrl = `${proto}://${host}`
    }
    return {
      url: `${baseUrl}${shortPath}`,
      directUrl: `${baseUrl}${fullPath}`,
      ...entry,
    }
  })
}
