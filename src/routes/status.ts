import type { FastifyInstance } from 'fastify'
import type { Storage } from '../storage.js'
import type { PokkitConfig } from '../config.js'
import { requireAuth } from '../auth.js'
import { checkPremium, fetchPlans } from '../subscription.js'
import { GB, GUEST_MAX_FILE_BYTES, PRO_PRICE_NTD, STORAGE_TIERS } from '../config.js'
import { appendFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

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

  // Public: tier table for the pricing page — single source is STORAGE_TIERS
  // (config.ts); the front-end renders what the back-end enforces, so the two
  // can never drift.
  app.get('/api/tiers', async () => {
    return {
      guest: { name: 'Guest', maxFileBytes: GUEST_MAX_FILE_BYTES, expiryDays: 7 },
      free: { name: STORAGE_TIERS.free.name, maxBytes: STORAGE_TIERS.free.maxBytes, maxGB: STORAGE_TIERS.free.maxBytes / GB },
      pro: { name: STORAGE_TIERS.premium.name, maxBytes: STORAGE_TIERS.premium.maxBytes, maxGB: STORAGE_TIERS.premium.maxBytes / GB, priceNTD: PRO_PRICE_NTD, available: false },
    }
  })

  // Pro 搶先體驗登記 — 金流接上前先收名單 (之後這批就是第一波轉化對象)。
  // 存 data/pro-interest.jsonl (data/ 不隨 deploy 清掉); email 去重。
  const interestPath = () => join(config.dataDir, 'pro-interest.jsonl')
  const readInterest = (): { email: string; at: string }[] => {
    if (!existsSync(interestPath())) return []
    return readFileSync(interestPath(), 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean) as { email: string; at: string }[]
  }
  app.post('/api/pro-interest', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = (request.body ?? {}) as { email?: string }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.status(400).send({ error: 'Invalid email' })
    }
    const existing = readInterest()
    if (!existing.some((r) => r.email === email)) {
      appendFileSync(interestPath(), JSON.stringify({ email, at: new Date().toISOString() }) + '\n')
      // Best-effort 確認信 (本機 mailer, 同一台機器; 掛了就算了, 名單已落地)。
      // production gate: 測試/本機開發不准真的寄信 (Resend 額度全生態共用)。
      if (process.env.NODE_ENV === 'production') fetch('http://localhost:4018/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: email,
          subject: 'Pokkit Pro 搶先體驗 — 已收到你的登記',
          text: 'Pokkit Pro (100GB、4K 影片原畫質) 上線時會第一時間通知你。\n\n— Pokkit',
        }),
      }).catch(() => {})
    }
    return { ok: true }
  })

  app.get('/api/admin/pro-interest', async (request, reply) => {
    const user = requireAuth(request, reply, config, storage)
    if (!user) return
    if (!user.isAdmin) return reply.status(403).send({ error: 'Forbidden' })
    const rows = readInterest()
    return { count: rows.length, rows }
  })

  // 客戶端黑盒子:SPA 把選檔/上傳啟動/JS 錯誤打回來進 server log,
  // 讓「手機上傳完全沒反應」這種純前端死亡可以遠端定位(2026-09-10 影片實案)。
  // 無敏感資料、無需登入;內容截斷防灌爆。
  app.post('/api/client-log', async (request) => {
    try {
      const raw = typeof request.body === 'string' ? request.body : JSON.stringify(request.body)
      console.error('[ClientLog]', raw.slice(0, 2000))
    } catch { /* 格式再爛也不能影響主服務 */ }
    return { ok: true }
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
    if (user.isAdmin) {
      // Owner/admin: unlimited — mirror checkQuota, never show an Upgrade nag
      return {
        userId: user.userId,
        tier: 'Admin',
        isPremium: true,
        unlimited: true,
        usedBytes: userStats.totalBytes,
        maxBytes: 0,
        usedPercent: 0,
        photoCount: userStats.totalFiles,
        maxPhotos: 0,
      }
    }
    const sub = await checkPremium(user.email, user.userId, config.premiumUserIds)

    return {
      userId: user.userId,
      tier: sub.tier,
      isPremium: sub.isPremium,
      // 容量制: bytes 是主量尺; photoCount/maxPhotos 留一版相容舊前端快取
      usedBytes: userStats.totalBytes,
      maxBytes: sub.maxBytes,
      usedPercent: sub.maxBytes > 0 ? Math.round((userStats.totalBytes / sub.maxBytes) * 10000) / 100 : 0,
      photoCount: userStats.totalFiles,
      maxPhotos: sub.maxPhotos,
    }
  })
}
