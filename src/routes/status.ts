import type { FastifyInstance } from 'fastify'
import type { Storage } from '../storage.js'
import type { PokkitConfig } from '../config.js'
import { requireAuth } from '../auth.js'
import { checkPremium, fetchPlans } from '../subscription.js'

// Users whose orphaned files have already been backfilled this server session.
// New uploads always carry a user_id, so orphans only come from legacy data —
// there's no need to re-run the UPDATE scan on every storage request.
const backfilledUsers = new Set<string>()

export function statusRoute(app: FastifyInstance, storage: Storage, config: PokkitConfig) {
  app.get('/status', async (request, reply) => {
    const user = requireAuth(request, reply, config)
    if (!user) return
    return storage.stats()
  })

  // Public: list available upgrade plans
  app.get('/api/plans', async () => {
    return fetchPlans()
  })

  app.get('/api/user/storage', async (request, reply) => {
    const user = requireAuth(request, reply, config)
    if (!user) return

    // Auto-backfill: assign orphaned files (user_id IS NULL) to current user.
    // Runs at most once per user per server session (see backfilledUsers above).
    if (!backfilledUsers.has(user.userId)) {
      backfilledUsers.add(user.userId)
      const backfilled = storage.backfillUserId(user.userId)
      if (backfilled > 0) {
        console.log(`[Pokkit] Auto-backfilled ${backfilled} files to user ${user.userId}`)
      }
    }

    const userStats = storage.userStats(user.userId)
    const sub = await checkPremium(user.email, user.userId, config.premiumUserIds)

    return {
      userId: user.userId,
      tier: sub.tier,
      isPremium: sub.isPremium,
      photoCount: userStats.totalFiles,
      maxPhotos: sub.maxPhotos,
      usedBytes: userStats.totalBytes,
      usedPercent: sub.maxPhotos > 0 ? Math.round((userStats.totalFiles / sub.maxPhotos) * 10000) / 100 : 0,
    }
  })
}
