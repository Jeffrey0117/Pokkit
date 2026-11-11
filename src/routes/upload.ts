import type { FastifyInstance } from 'fastify'
import type { Storage } from '../storage.js'
import type { PokkitConfig } from '../config.js'
import { requireAuth, hasAuthToken, type AuthUser } from '../auth.js'
import { GUEST_DAILY_UPLOADS, GUEST_MAX_FILE_BYTES, GUEST_USER_ID } from '../config.js'
import { guestKey } from '../guest-limit.js'
import { finalizeUpload, normalizeFields, uploadFieldProblem } from '../upload-finalize.js'
import { readUpload, ONE_FILE, type AnyPart } from '../upload-read.js'

// Single-request multipart upload. Fine for small/medium files; anything that
// might exceed an edge proxy's body cap (Cloudflare: 100MB) should use the
// chunked route instead — both end in finalizeUpload() and return the same JSON.
export function uploadRoute(app: FastifyInstance, storage: Storage, config: PokkitConfig) {
  app.post('/upload', {
    config: { rateLimit: { max: 200, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    // Guest 快傳: 完全沒帶憑證 → guest (強制 ≤24 小時過期, 單檔 64MB, 純檔案分支)。
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

    const sizeLimit = reservedFor ? GUEST_MAX_FILE_BYTES : config.maxFileSize

    try {
      // 把整個表單走完:欄位排在檔案前面或後面都要收到 (見 upload-read.ts)。
      // 前面的欄位已經確定期限不合法時,檔案就不讀進記憶體了。
      const limits = reservedFor ? { ...ONE_FILE, fileSize: GUEST_MAX_FILE_BYTES } : ONE_FILE
      const parts = request.parts({ limits })
      const upload = await readUpload(parts as AsyncIterable<AnyPart>, (seen) => uploadFieldProblem(seen) !== null)

      if (!upload.file) {
        refund()
        return reply.status(400).send({ error: 'No file provided. Use multipart field "file".' })
      }
      const problem = uploadFieldProblem(upload.fields)
      if (problem) {
        refund()
        return reply.status(400).send(problem)
      }
      if (upload.tooLarge || !upload.buffer) {
        refund()
        return reply.status(413).send(tooLarge(sizeLimit, Boolean(reservedFor)))
      }

      const fields = normalizeFields({
        password: upload.fields.password,
        expiresIn: upload.fields.expiresIn,
        album_id: upload.fields.album_id,
        keep_duplicate: upload.fields.keep_duplicate,
      })
      const result = await finalizeUpload(
        { filename: upload.file.filename, mime: upload.file.mimetype, buffer: upload.buffer, fields },
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
      // 包含讀不出 multipart (例如 content-type 不對):訪客的額度一樣要還回去
      refund()
      throw err
    }
  })
}

const MB = 1024 * 1024

// 超過大小上限時回給使用者的內容。兩條路(套件丟錯、自己發現被切斷)都用這一份,
// 前端只看 error 顯示,code / maxBytes 給程式判斷用。
function tooLarge(limitBytes: number, guest: boolean) {
  const limitMB = Math.floor(limitBytes / MB)
  return {
    error: guest
      ? `Guest uploads are limited to ${limitMB} MB per file. Log in to send bigger files.`
      : `This file is over the ${limitMB} MB limit.`,
    code: 'file_too_large',
    maxBytes: limitBytes,
    ...(guest ? { guest: true } : {}),
  }
}
