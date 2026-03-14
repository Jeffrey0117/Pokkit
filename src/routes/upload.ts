import type { FastifyInstance } from 'fastify'
import type { Storage } from '../storage.js'
import type { PokkitConfig } from '../config.js'
import { processPhoto } from '../photo-worker.js'

export function uploadRoute(app: FastifyInstance, storage: Storage, config: PokkitConfig) {
  app.post('/upload', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
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

    // Read optional fields from multipart
    let password: string | undefined
    let expiresIn: string | undefined
    let albumId: string | undefined

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
    if (fields.album_id?.value) {
      const album = storage.getAlbum(fields.album_id.value)
      if (!album) {
        return reply.status(400).send({ error: 'Album not found' })
      }
      albumId = fields.album_id.value
    }

    const buffer = await file.toBuffer()

    let baseUrl: string
    if (config.publicUrl) {
      baseUrl = config.publicUrl
    } else {
      const host = request.headers.host ?? `${request.hostname}:${config.port}`
      const proto = (request.headers['x-forwarded-proto'] as string) ?? 'http'
      baseUrl = `${proto}://${host}`
    }

    // Photo branch: images get deferred processing
    if (storage.isImage(file.mimetype)) {
      const entry = storage.savePhoto(file.filename, file.mimetype, buffer, {
        album_id: albumId,
      })

      // If deduplicated, skip processing (already ready)
      if (!entry.deduplicated && entry.rawPath) {
        processPhoto(entry.id, entry.rawPath)
      }

      return {
        id: entry.id,
        filename: entry.filename,
        mime: entry.mime,
        size: entry.size,
        status: entry.status,
        deduplicated: !!entry.deduplicated,
        photoUrl: `${baseUrl}/photos/${entry.id}/photo.webp`,
        thumbUrl: `${baseUrl}/photos/${entry.id}/thumb.webp`,
        statusUrl: `${baseUrl}/api/photos/${entry.id}/status`,
      }
    }

    // Normal file branch
    const entry = await storage.save(
      file.filename,
      file.mimetype,
      buffer,
      { password, expiresIn },
    )

    const shortPath = `/f/${entry.id}`
    const fullPath = `/files/${entry.id}/${encodeURIComponent(entry.filename)}`

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
