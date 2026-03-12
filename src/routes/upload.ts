import type { FastifyInstance } from 'fastify'
import type { Storage } from '../storage.js'
import type { PokkitConfig } from '../config.js'

export function uploadRoute(app: FastifyInstance, storage: Storage, config: PokkitConfig) {
  app.post('/upload', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const file = await request.file()
    if (!file) {
      return reply.status(400).send({ error: 'No file provided. Use multipart field "file".' })
    }

    // Read optional fields from multipart
    let password: string | undefined
    let expiresIn: string | undefined

    // Fastify multipart: fields are available on the file object
    const fields = file.fields as Record<string, { value?: string } | undefined>
    if (fields.password?.value) {
      password = fields.password.value
    }
    if (fields.expiresIn?.value) {
      const valid = ['1h', '1d', '7d', '30d', 'forever']
      if (valid.includes(fields.expiresIn.value)) {
        expiresIn = fields.expiresIn.value
      }
    }

    const buffer = await file.toBuffer()
    const entry = await storage.save(
      file.filename,
      file.mimetype,
      buffer,
      { password, expiresIn },
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
      id: entry.id,
      filename: entry.filename,
      mime: entry.mime,
      size: entry.size,
      uploaded_at: entry.uploaded_at,
      has_password: !!entry.password_hash,
      expires_at: entry.expires_at,
    }
  })
}
