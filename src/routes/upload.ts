import type { FastifyInstance } from 'fastify'
import type { Storage } from '../storage.js'
import type { PokkitConfig } from '../config.js'
import { requireAuth, hasAuthToken, type AuthUser } from '../auth.js'
import { GUEST_DAILY_UPLOADS, GUEST_USER_ID } from '../config.js'
import { guestKey } from '../guest-limit.js'
import { finalizeUpload, normalizeFields } from '../upload-finalize.js'

// Single-request multipart upload. Fine for small/medium files; anything that
// might exceed an edge proxy's body cap (Cloudflare: 100MB) should use the
// chunked route instead — both end in finalizeUpload() and return the same JSON.
export function uploadRoute(app: FastifyInstance, storage: Storage, config: PokkitConfig) {
  app.post('/upload', {
    config: { rateLimit: { max: 200, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    // Guest 快傳: 完全沒帶憑證 → guest (強制 ≤7 天過期, 單檔 64MB, 純檔案分支)。
    // 有帶憑證就必須驗過 — 壞 token 要 401, 不准靜默降級成 guest。
    let user: AuthUser
    if (hasAuthToken(request)) {
      const authed = requireAuth(request, reply, config, storage)
      if (!authed) return
      user = authed
    } else {
      user = { userId: GUEST_USER_ID, email: '' }
    }

    const reservedFor = user.userId === GUEST_USER_ID ? guestKey(request) : null
    if (reservedFor && storage.moderation.isGuestBlocked(reservedFor)) {
      return reply.status(403).send({ error: 'Uploads from here have been suspended.', code: 'account_blocked' })
    }
    if (reservedFor && !storage.reserveGuestUpload(reservedFor, GUEST_DAILY_UPLOADS)) {
      return reply.status(429).send({
        error: `You've used today's ${GUEST_DAILY_UPLOADS} uploads. Log in to keep going.`,
        code: 'guest_daily_limit',
      })
    }
    const refund = () => {
      if (reservedFor) storage.releaseGuestUpload(reservedFor)
    }

    const file = await request.file()
    if (!file) {
      refund()
      return reply.status(400).send({ error: 'No file provided. Use multipart field "file".' })
    }

    // Fastify multipart: fields are available on the file object
    const rawFields = file.fields as Record<string, { value?: unknown } | undefined>
    const fields = normalizeFields({
      password: rawFields.password?.value,
      expiresIn: rawFields.expiresIn?.value,
      album_id: rawFields.album_id?.value,
      keep_duplicate: rawFields.keep_duplicate?.value,
    })

    try {
      const buffer = await file.toBuffer()
      const result = await finalizeUpload(
        { filename: file.filename, mime: file.mimetype, buffer, fields },
        user,
        request,
        storage,
        config,
      )
      if (result.status >= 400) refund()
      const fileId = (result.body as { id?: unknown }).id
      if (reservedFor && result.status < 400 && typeof fileId === 'string') {
        storage.moderation.rememberGuestFile(fileId, reservedFor)
      }
      return reply.status(result.status).send(result.body)
    } catch (err) {
      refund()
      throw err
    }
  })
}
