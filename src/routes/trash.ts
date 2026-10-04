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
    // LetMeUse admins see everything; everyone else only their own trash
    return storage.listTrash(user.isAdmin ? {} : { userId: user.userId })
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
    const items = storage.listTrash(user.isAdmin ? {} : { userId: user.userId })
    let n = 0
    for (const item of items) {
      try { if (await storage.remove(item.id)) n++ } catch { /* keep going */ }
    }
    return { ok: true, purged: n }
  })
}
