import { join } from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { createChunkStore, registerChunkedUpload, ChunkError } from 'chunked-upload-kit'
import type { CompletedUpload, InitInput } from 'chunked-upload-kit'
import type { Storage } from '../storage.js'
import type { PokkitConfig } from '../config.js'
import { requireAuth, canAccessAlbum, type AuthUser } from '../auth.js'
import { finalizeUpload, normalizeFields, checkQuota, uploadFieldProblem, isShareLink, albumShareConflict } from '../upload-finalize.js'

export const CHUNKED_UPLOAD_PREFIX = '/api/upload/chunked'

// How many chunked uploads may be finalized at once. Every branch is zero-copy
// now (the assembled file is hashed as a stream and moved on disk, nothing is
// buffered — plain files included since 2026-11-11). Kept at 1 anyway: hashing a
// 2GB file is still disk- and CPU-heavy, and two concurrent 135MB .mov
// readFile()s OOM-killed the process twice on 2026-10-25.
const FINALIZE_SLOTS = 1

// Chunked upload: POST init → PUT chunks → POST complete. Every request stays
// small, so large videos get past Cloudflare's 100MB per-request cap.
// See chunked-upload-kit/SKILL.md for the protocol.
export function chunkedUploadRoute(app: FastifyInstance, storage: Storage, config: PokkitConfig) {
  const store = createChunkStore({
    dir: join(config.dataDir, 'chunks'),
    maxFileSize: config.maxFileSize,
    log: (msg: string) => app.log.info(`[chunked-upload] ${msg}`),
  })
  const stopSweeper = store.startSweeper()
  app.addHook('onClose', async () => stopSweeper())

  // requireAuth sends the 401 itself; stash the resolved user on the request so
  // the hooks can reuse it without a second lookup.
  const users = new WeakMap<FastifyRequest, AuthUser>()

  // Tiny semaphore around finalize (memory-bound work).
  let active = 0
  const waiters: Array<() => void> = []
  const acquire = () => new Promise<void>((resolve) => {
    if (active < FINALIZE_SLOTS) { active++; resolve(); return }
    waiters.push(() => { active++; resolve() })
  })
  const release = () => {
    active--
    const next = waiters.shift()
    if (next) next()
  }

  registerChunkedUpload(app, {
    prefix: CHUNKED_UPLOAD_PREFIX,
    store,
    auth: (request: FastifyRequest, reply: FastifyReply) => {
      const user = requireAuth(request, reply, config, storage)
      if (!user) return false // requireAuth already replied 401
      users.set(request, user)
      return user.userId
    },
    // Refuse before a single byte is stored: quota and album ownership are
    // known up front, so don't let the user upload 500MB just to get a 413.
    onInit: async (body: InitInput, _owner: string, request: FastifyRequest) => {
      const user = users.get(request)
      if (!user) throw new ChunkError(401, 'unauthorized', 'Unauthorized')
      const quota = await checkQuota(user, storage, config, body.size ?? 0)
      if (quota) throw new ChunkError(quota.status, 'quota', String(quota.body.error), quota.body)
      const refuse = (problem: Record<string, unknown>) =>
        new ChunkError(400, String(problem.code), String(problem.error), problem)
      const problem = uploadFieldProblem(body.meta as Record<string, unknown> | undefined)
      if (problem) throw refuse(problem)
      const fields = normalizeFields(body.meta)
      if (fields.album_id) {
        const album = storage.getAlbum(fields.album_id)
        if (!album || !canAccessAlbum(user, album)) throw new ChunkError(400, 'album_not_found', 'Album not found')
        // 期限在這裡就知道了:別讓人傳完 2GB 才被告知相簿不收 (密碼要到收尾才看得到)
        const mime = body.mime ?? ''
        if (isShareLink(fields) && (storage.isImage(mime) || storage.isVideo(mime))) throw refuse(albumShareConflict())
      }
    },
    onComplete: async (file: CompletedUpload, request: FastifyRequest & { completeBody?: Record<string, unknown> }, reply: FastifyReply) => {
      const user = users.get(request)
      if (!user) {
        reply.status(401)
        return { error: 'Unauthorized' }
      }
      // Secrets (password) ride on the final request only; everything else came
      // with init and is in file.meta.
      const merged = { ...(file.meta ?? {}), ...(request.completeBody ?? {}) }
      // init 已經擋過一次;收尾的請求還能再帶欄位,所以這裡也要看
      const problem = uploadFieldProblem(merged)
      if (problem) {
        reply.status(400)
        return problem
      }
      const fields = normalizeFields(merged)
      await acquire()
      try {
        // Hand over the assembled file by path — photo/video branches move it
        // into storage without ever loading it into memory.
        const result = await finalizeUpload(
          { filename: file.filename, mime: file.mime, filePath: file.path, fields },
          user,
          request,
          storage,
          config,
        )
        // Set the code but let the adapter send: it releases the chunk session
        // first, so the temp files are gone by the time the client sees the reply.
        reply.status(result.status)
        return result.body
      } finally {
        release()
      }
    },
  })

  return store
}
