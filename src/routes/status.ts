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

    // Auto-backfill: assign orphaned files (user_id IS NULL) to current user
    const backfilled = storage.backfillUserId(user.userId)
    if (backfilled > 0) {
      console.log(`[Pokkit] Auto-backfilled ${backfilled} files to user ${user.userId}`)
    }

    const userStats = storage.userStats(user.userId)
    const isPremium = user.userId === 'admin' || config.premiumUserIds.includes(user.userId)
    const tier = isPremium ? STORAGE_TIERS.premium : STORAGE_TIERS.free

    return {
      userId: user.userId,
      tier: tier.name,
      isPremium,
      photoCount: userStats.totalFiles,
      maxPhotos: tier.maxPhotos,
      usedBytes: userStats.totalBytes,
      usedPercent: tier.maxPhotos > 0 ? Math.round((userStats.totalFiles / tier.maxPhotos) * 10000) / 100 : 0,
    }
  })
}
