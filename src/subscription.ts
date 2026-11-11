import { STORAGE_TIERS } from './config.js'

const PAYGATE_BASE = process.env.PAYGATE_URL || 'https://paygate.isnowfriend.com'
const PRODUCT = 'pokkit'
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
// 免費的結果記短一點,剛付完錢的人才不用等五分鐘
const FREE_CACHE_TTL = 15 * 1000
// PayGate 查不到時,隔一下再問,不要每個請求都去敲它
const FAIL_CACHE_TTL = 30 * 1000
const TIMEOUT_MS = 6000
const MAX_ENTRIES = 5000

interface Tier {
  isPremium: boolean
  tier: string
  maxPhotos: number
  maxBytes: number
}

interface CacheEntry extends Tier {
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
// PayGate 最後一次「真的回答」的結果。它掛掉、限流或回了看不懂的東西時用這個,
// 付了錢的人不該因為我們自己的服務出狀況被降成免費。
const lastKnown = new Map<string, Tier>()

// PayGate 的 GET /api/subscription/check 回 { active, tier, plan_id, quotas, end_date }
interface PayGateSubscription {
  active: boolean
  tier?: string
  quotas?: { maxPhotos?: number }
  end_date?: string
}

const premiumTier = (maxPhotos?: number): Tier => ({
  isPremium: true,
  tier: STORAGE_TIERS.premium.name,
  maxPhotos: maxPhotos ?? STORAGE_TIERS.premium.maxPhotos,
  maxBytes: STORAGE_TIERS.premium.maxBytes,
})

const freeTier = (): Tier => ({
  isPremium: false,
  tier: 'Free',
  maxPhotos: STORAGE_TIERS.free.maxPhotos,
  maxBytes: STORAGE_TIERS.free.maxBytes,
})

function remember<T>(map: Map<string, T>, key: string, value: T): void {
  map.delete(key)
  if (map.size >= MAX_ENTRIES) map.delete(map.keys().next().value as string)
  map.set(key, value)
}

export function clearSubscriptionCache(): void {
  cache.clear()
  lastKnown.clear()
}

// 查不到 (連不上、非 200、回應沒有 active 欄位) 一律丟錯 —— 那不代表「沒訂閱」。
async function fetchSubscription(email: string): Promise<PayGateSubscription> {
  const url = `${PAYGATE_BASE}/api/subscription/check?email=${encodeURIComponent(email)}&product=${encodeURIComponent(PRODUCT)}`
  // 帶 token 的呼叫 PayGate 不限流;不帶的話,經通道過去時所有用戶會被算成同一個訪客
  const token = process.env.PAYGATE_TOKEN
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`PayGate answered ${res.status}`)
  const data = await res.json().catch(() => null) as PayGateSubscription | null
  if (!data || typeof data.active !== 'boolean') throw new Error('PayGate answer has no "active" field')
  return data
}

export async function checkPremium(
  email: string,
  userId: string,
  premiumUserIds: string[],
): Promise<Tier> {
  // Admin override, or manual override via env — always premium
  if (userId === 'admin' || premiumUserIds.includes(userId)) return premiumTier()

  // No email = can't check PayGate
  const key = (email || '').trim().toLowerCase()
  if (!key) return freeTier()

  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    const { expiresAt: _expiresAt, ...tier } = cached
    return tier
  }

  try {
    const sub = await fetchSubscription(key)
    const tier = sub.active ? premiumTier(sub.quotas?.maxPhotos) : freeTier()
    remember(lastKnown, key, tier)
    remember(cache, key, { ...tier, expiresAt: Date.now() + (sub.active ? CACHE_TTL : FREE_CACHE_TTL) })
    return tier
  } catch (err) {
    const tier = lastKnown.get(key) ?? freeTier()
    remember(cache, key, { ...tier, expiresAt: Date.now() + FAIL_CACHE_TTL })
    if (process.env.POKKIT_LOG !== 'silent') {
      console.error(`[subscription] PayGate check failed (${(err as Error).message}); keeping ${tier.tier}`)
    }
    return tier
  }
}

interface PayGatePlan {
  id: string
  tier: string
  display_name: string
  billing_cycle: string
  price: number
  currency: string
  quotas: Record<string, unknown>
  checkout_url: string | null
}

let plansCache: { plans: PayGatePlan[]; expiresAt: number } | null = null

export async function fetchPlans(): Promise<{ plans: PayGatePlan[] }> {
  if (plansCache && plansCache.expiresAt > Date.now()) {
    return { plans: plansCache.plans }
  }

  try {
    const url = `${PAYGATE_BASE}/api/plans?product=${encodeURIComponent(PRODUCT)}`
    const res = await fetch(url)
    if (!res.ok) return { plans: [] }
    const data = await res.json() as { plans: PayGatePlan[] }
    plansCache = { plans: data.plans || [], expiresAt: Date.now() + CACHE_TTL }
    return { plans: plansCache.plans }
  } catch {
    return { plans: [] }
  }
}
