import crypto from 'node:crypto'

/**
 * 🔑 JWKS 公鑰快取 — 從 LetMeUse /api/jwks 抓 ES256 公鑰, 同步取用 + 背景刷新。
 * 為什麼自己做不用 jose: 這個 app 的 requireAuth 是「同步」的, jose 的 jwtVerify 是 async,
 * 改 async 要動整票 route。所以背景非同步抓 → cache 起來 → verify 同步讀 (crypto.verify 也同步)。
 */
const JWKS_URL = process.env.LETMEUSE_JWKS_URL || 'http://localhost:4006/api/jwks'

let keysByKid = new Map<string, crypto.KeyObject>()
let lastFetch = 0
let fetching = false

async function refresh(): Promise<void> {
  if (fetching) return
  fetching = true
  try {
    const res = await fetch(JWKS_URL)
    if (!res.ok) return
    const data = (await res.json()) as { keys?: Array<Record<string, unknown>> }
    const m = new Map<string, crypto.KeyObject>()
    for (const jwk of data.keys ?? []) {
      const kid = jwk.kid as string | undefined
      try {
        if (kid) m.set(kid, crypto.createPublicKey({ key: jwk as crypto.JsonWebKeyInput['key'], format: 'jwk' }))
      } catch {
        /* 壞 JWK 跳過 */
      }
    }
    if (m.size) {
      keysByKid = m
      lastFetch = Date.now()
    }
  } catch {
    /* 網路問題 → 保留舊 cache */
  } finally {
    fetching = false
  }
}

void refresh() // 啟動先抓一次
setInterval(() => void refresh(), 60 * 60 * 1000).unref?.() // 每小時刷新

/** 同步取公鑰; kid 不在 (可能輪換) → 背景重抓 (60s cooldown), 這次先回 null */
export function getJwksPublicKey(kid: string): crypto.KeyObject | null {
  const k = keysByKid.get(kid)
  if (!k && Date.now() - lastFetch > 60_000) void refresh()
  return k ?? null
}
