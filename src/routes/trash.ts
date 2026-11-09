import { isMachineAdmin } from '../auth.js'
import type { FastifyInstance } from 'fastify'
import type { Storage } from '../storage.js'
import type { PokkitConfig } from '../config.js'
import { requireAuth, canAccessEntry } from '../auth.js'

// Trash (soft-deleted files): list / restore / purge. Human users only in
// practice — project accounts hard-delete and never land here.
export function trashRoute(app: FastifyInstance, storage: Storage, config: PokkitConfig) {
  app.get('/api/trash', async (request, reply) => {
    const user = requireAuth(request, reply, config, storage)
    if (!user) return
    // 每個人只看自己的垃圾桶;管理員下架或清空的檔案在會員管理後台處理
    return storage.listTrash(isMachineAdmin(user) ? {} : { userId: user.userId })
  })

  app.post<{ Params: { id: string } }>('/api/trash/:id/restore', async (request, reply) => {
    const user = requireAuth(request, reply, config, storage)
    if (!user) return
    const entry = storage.findAny(request.params.id)
    if (!entry || !(entry as { deleted_at?: number | null }).deleted_at) {
      return reply.status(404).send({ error: 'Not in trash' })
    }
    if (!canAccessEntry(user, entry)) {
      return reply.status(403).send({ error: 'Not your file' })
    }
    storage.restore(request.params.id)
    return { ok: true }
  })

  // Purge one item immediately (permanent — disk + DB)
  app.delete<{ Params: { id: string } }>('/api/trash/:id', async (request, reply) => {
    const user = requireAuth(request, reply, config, storage)
    if (!user) return
    const entry = storage.findAny(request.params.id)
    if (!entry || !(entry as { deleted_at?: number | null }).deleted_at) {
      return reply.status(404).send({ error: 'Not in trash' })
    }
    if (!canAccessEntry(user, entry)) {
      return reply.status(403).send({ error: 'Not your file' })
    }
    await storage.remove(request.params.id)
    return { ok: true }
  })

  // Empty the caller's whole trash (permanent)
  app.delete('/api/trash', async (request, reply) => {
    const user = requireAuth(request, reply, config, storage)
    if (!user) return
    // 永久刪除,誰都只能清自己的,否則管理員按一下會清掉全站會員的垃圾桶
    const items = storage.listTrash({ userId: user.userId })
    let n = 0
    for (const item of items) {
      try { if (await storage.remove(item.id)) n++ } catch { /* keep going */ }
    }
    return { ok: true, purged: n }
  })
}
