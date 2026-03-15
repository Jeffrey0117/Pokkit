import type { FastifyInstance } from 'fastify'
import type { Storage } from '../storage.js'
import type { PokkitConfig } from '../config.js'
import { STORAGE_TIERS } from '../config.js'
import { requireAuth } from '../auth.js'

export function statusRoute(app: FastifyInstance, storage: Storage, config: PokkitConfig) {
  app.get('/status', async (request, reply) => {
    const user = requireAuth(request, reply, config)
    if (!user) return
    return storage.stats()
  })

  app.get('/api/user/storage', async (request, reply) => {
    const user = requireAuth(request, reply, config)
    if (!user) return

    const userStats = storage.userStats(user.userId)
    const isPremium = user.userId === 'admin' || config.premiumUserIds.includes(user.userId)
    const tier = isPremium ? STORAGE_TIERS.premium : STORAGE_TIERS.free

    return {
      userId: user.userId,
      tier: tier.name,
      isPremium,
      used: userStats.totalBytes,
      fileCount: userStats.totalFiles,
      quota: tier.quotaBytes,
      usedPercent: tier.quotaBytes > 0 ? Math.round((userStats.totalBytes / tier.quotaBytes) * 10000) / 100 : 0,
    }
  })

  app.post<{ Body: { userId?: string } }>('/api/admin/backfill-user', async (request, reply) => {
    const user = requireAuth(request, reply, config)
    if (!user) return

    if (user.userId !== 'admin') {
      return reply.status(403).send({ error: 'Admin only' })
    }

    const targetUserId = request.body?.userId
    if (!targetUserId) {
      return reply.status(400).send({ error: 'userId is required' })
    }

    const changes = storage.backfillUserId(targetUserId)
    return { ok: true, backfilled: changes }
  })
}
