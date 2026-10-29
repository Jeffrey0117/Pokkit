import type { FastifyInstance } from 'fastify'
import type { Storage } from '../storage.js'
import type { PokkitConfig } from '../config.js'
import { requireAuth } from '../auth.js'

/**
 * Pro 訂閱結帳 — 走 PayGate 的藍新(NewebPay)定期定額。
 * pokkit 只負責「帶著使用者 email 去 PayGate 換 checkout_url」;
 * 建單/notify/展延/退訂全在 PayGate,開通靠既有 subscription.ts 的
 * PayGate check(等 notify 進來,/api/user/storage 自動變 Pro)。
 */
const PAYGATE_BASE = process.env.PAYGATE_URL || 'https://paygate.isnowfriend.com'
const PRO_PLAN_ID = process.env.POKKIT_PRO_PLAN_ID || 'pokkit-pro-monthly'

export function billingEnabled(): boolean {
  return Boolean(process.env.PAYGATE_TOKEN)
}

export function billingRoute(app: FastifyInstance, storage: Storage, config: PokkitConfig) {
  const paygateHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.PAYGATE_TOKEN}`,
  })

  // 建立 Pro 訂閱結帳 → 回 checkout_url,前端整頁導過去
  app.post('/api/billing/checkout', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = requireAuth(request, reply, config, storage)
    if (!user) return
    if (!billingEnabled()) return reply.status(503).send({ error: 'Billing not configured' })
    if (!user.email) return reply.status(400).send({ error: 'Account has no email — please log in with LetMeUse' })

    try {
      const res = await fetch(`${PAYGATE_BASE}/api/newebpay/subscribe`, {
        method: 'POST',
        headers: paygateHeaders(),
        body: JSON.stringify({
          email: user.email,
          product: 'pokkit',
          plan_id: PRO_PLAN_ID,
          return_url: `${config.publicUrl || 'https://pokkit.isnowfriend.com'}/pricing?upgraded=1`,
        }),
      })
      const data = (await res.json()) as { success?: boolean; checkout_url?: string; error?: string }
      if (!res.ok || !data.checkout_url) {
        console.error('[Pokkit] billing checkout failed:', res.status, data.error || '')
        return reply.status(502).send({ error: 'Checkout service unavailable, please try again later' })
      }
      return { checkout_url: data.checkout_url }
    } catch (err) {
      console.error('[Pokkit] billing checkout error:', (err as Error).message)
      return reply.status(502).send({ error: 'Checkout service unavailable, please try again later' })
    }
  })

  // 退訂:終止藍新委託;已付期數用到 end_date(PayGate 管),期滿自動回 Free
  app.post('/api/billing/cancel', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = requireAuth(request, reply, config, storage)
    if (!user) return
    if (!billingEnabled()) return reply.status(503).send({ error: 'Billing not configured' })
    if (!user.email) return reply.status(400).send({ error: 'Account has no email' })

    try {
      const res = await fetch(`${PAYGATE_BASE}/api/newebpay/cancel`, {
        method: 'POST',
        headers: paygateHeaders(),
        body: JSON.stringify({ email: user.email, product: 'pokkit' }),
      })
      const data = (await res.json()) as { success?: boolean; active_until?: string; error?: string }
      if (!res.ok) {
        return reply.status(res.status === 404 ? 404 : 502).send({ error: data.error || 'Cancel failed' })
      }
      return { ok: true, active_until: data.active_until || null }
    } catch (err) {
      console.error('[Pokkit] billing cancel error:', (err as Error).message)
      return reply.status(502).send({ error: 'Cancel service unavailable, please try again later' })
    }
  })
}
