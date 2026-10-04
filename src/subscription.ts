import { STORAGE_TIERS } from './config.js'

const PAYGATE_BASE = process.env.PAYGATE_URL || 'https://paygate.isnowfriend.com'
const PRODUCT = 'pokkit'
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

interface CacheEntry {
  isPremium: boolean
  tier: string
  maxPhotos: number
  maxBytes: number
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

interface PayGateSubscription {
  has_subscription: boolean
  tier?: string
  quotas?: { maxPhotos?: number }
  end_date?: string
}

async function fetchSubscription(email: string): Promise<PayGateSubscription> {
  const url = `${PAYGATE_BASE}/api/subscription/check?email=${encodeURIComponent(email)}&product=${encodeURIComponent(PRODUCT)}`
  const res = await fetch(url)
  if (!res.ok) return { has_subscription: false }
  return res.json() as Promise<PayGateSubscription>
}

export async function checkPremium(
  email: string,
  userId: string,
  premiumUserIds: string[],
): Promise<{ isPremium: boolean; tier: string; maxPhotos: number; maxBytes: number }> {
  // Admin override — always premium
  if (userId === 'admin') {
    return { isPremium: true, tier: STORAGE_TIERS.premium.name, maxPhotos: STORAGE_TIERS.premium.maxPhotos, maxBytes: STORAGE_TIERS.premium.maxBytes }
  }

  // Manual override via env — always premium
  if (premiumUserIds.includes(userId)) {
    return { isPremium: true, tier: STORAGE_TIERS.premium.name, maxPhotos: STORAGE_TIERS.premium.maxPhotos, maxBytes: STORAGE_TIERS.premium.maxBytes }
  }

  // No email = can't check PayGate
  if (!email) {
    return { isPremium: false, tier: 'Free', maxPhotos: STORAGE_TIERS.free.maxPhotos, maxBytes: STORAGE_TIERS.free.maxBytes }
  }

  // Check cache
  const cached = cache.get(email)
  if (cached && cached.expiresAt > Date.now()) {
    return { isPremium: cached.isPremium, tier: cached.tier, maxPhotos: cached.maxPhotos, maxBytes: cached.maxBytes }
  }

  // Query PayGate
  try {
    const sub = await fetchSubscription(email)
    const isPremium = sub.has_subscription === true
    const tier = isPremium ? STORAGE_TIERS.premium.name : 'Free'
    const maxPhotos = isPremium
      ? (sub.quotas?.maxPhotos ?? STORAGE_TIERS.premium.maxPhotos)
      : STORAGE_TIERS.free.maxPhotos
    const maxBytes = isPremium ? STORAGE_TIERS.premium.maxBytes : STORAGE_TIERS.free.maxBytes

    const entry: CacheEntry = {
      isPremium,
      tier,
      maxPhotos,
      maxBytes,
      expiresAt: Date.now() + CACHE_TTL,
    }
    cache.set(email, entry)

    return { isPremium, tier, maxPhotos, maxBytes }
  } catch {
    // PayGate down — fallback to free
    return { isPremium: false, tier: 'Free', maxPhotos: STORAGE_TIERS.free.maxPhotos, maxBytes: STORAGE_TIERS.free.maxBytes }
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
