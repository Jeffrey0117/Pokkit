import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { createChunkStore, registerChunkedUpload } from 'chunked-upload-kit'
import type { CompletedUpload } from 'chunked-upload-kit'
import type { Storage } from '../storage.js'
import type { PokkitConfig } from '../config.js'
import { requireAuth, type AuthUser } from '../auth.js'
import { finalizeUpload, normalizeFields } from '../upload-finalize.js'

export const CHUNKED_UPLOAD_PREFIX = '/api/upload/chunked'

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
  // onComplete can reuse it without a second lookup.
  const users = new WeakMap<FastifyRequest, AuthUser>()

  registerChunkedUpload(app, {
    prefix: CHUNKED_UPLOAD_PREFIX,
    store,
    auth: (request: FastifyRequest, reply: FastifyReply) => {
      const user = requireAuth(request, reply, config, storage)
      if (!user) return null
      users.set(request, user)
      return user.userId
    },
    onComplete: async (file: CompletedUpload, request: FastifyRequest, reply: FastifyReply) => {
      const user = users.get(request)
      if (!user) {
        reply.status(401)
        return { error: 'Unauthorized' }
      }
      // Same memory profile as /upload (which buffers via file.toBuffer()).
      const buffer = await readFile(file.path)
      const result = await finalizeUpload(
        { filename: file.filename, mime: file.mime, buffer, fields: normalizeFields(file.meta) },
        user,
        request,
        storage,
        config,
      )
      // Set the code but let the adapter send: it releases the chunk session
      // first, so the temp files are gone by the time the client sees the reply.
      reply.status(result.status)
      return result.body
    },
  })

  return store
}
