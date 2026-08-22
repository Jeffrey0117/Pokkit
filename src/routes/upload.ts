import type { FastifyInstance } from 'fastify'
import type { Storage } from '../storage.js'
import type { PokkitConfig } from '../config.js'
import { requireAuth } from '../auth.js'
import { finalizeUpload, normalizeFields } from '../upload-finalize.js'

// Single-request multipart upload. Fine for small/medium files; anything that
// might exceed an edge proxy's body cap (Cloudflare: 100MB) should use the
// chunked route instead — both end in finalizeUpload() and return the same JSON.
export function uploadRoute(app: FastifyInstance, storage: Storage, config: PokkitConfig) {
  app.post('/upload', {
    config: { rateLimit: { max: 200, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = requireAuth(request, reply, config, storage)
    if (!user) return

    const file = await request.file()
    if (!file) {
      return reply.status(400).send({ error: 'No file provided. Use multipart field "file".' })
    }

    // Fastify multipart: fields are available on the file object
    const rawFields = file.fields as Record<string, { value?: unknown } | undefined>
    const fields = normalizeFields({
      password: rawFields.password?.value,
      expiresIn: rawFields.expiresIn?.value,
      album_id: rawFields.album_id?.value,
    })

    const buffer = await file.toBuffer()
    const result = await finalizeUpload(
      { filename: file.filename, mime: file.mimetype, buffer, fields },
      user,
      request,
      storage,
      config,
    )
    return reply.status(result.status).send(result.body)
  })
}
