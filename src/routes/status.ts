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
    const user = requireAuth(request, reply, config, storage)
    if (!user) return
    return storage.stats()
  })

  // Public: list available upgrade plans
  app.get('/api/plans', async () => {
    return fetchPlans()
  })

  // Per-media-type counts for the account page
  app.get('/api/user/stats', async (request, reply) => {
    const user = requireAuth(request, reply, config, storage)
    if (!user) return
    const rows = storage.userMediaCounts(user.userId)
    let photos = 0
    let videos = 0
    let files = 0
    let totalBytes = 0
    for (const r of rows) {
      totalBytes += r.b
      if (r.media_type === 'photo') photos = r.c
      else if (r.media_type === 'video') videos = r.c
      else files += r.c
    }
    return { photos, videos, files, totalBytes }
  })

  app.get('/api/user/storage', async (request, reply) => {
    const user = requireAuth(request, reply, config, storage)
    if (!user) return

    // Auto-backfill legacy orphan files (user_id IS NULL) to the OWNER only.
    // 🔒 Never let a project account (pk_) or arbitrary JWT user vacuum every
    // unowned file into itself — orphans are pre-multi-tenant owner data.
    // Runs at most once per admin per server session (see backfilledUsers).
    if (user.isAdmin && !backfilledUsers.has(user.userId)) {
      backfilledUsers.add(user.userId)
      const backfilled = storage.backfillUserId(user.userId)
      if (backfilled > 0) {
        console.log(`[Pokkit] Auto-backfilled ${backfilled} files to owner ${user.userId}`)
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
