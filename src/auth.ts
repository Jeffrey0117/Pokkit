import crypto from 'node:crypto'
import { getJwksPublicKey } from './jwks-cache.js'
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { PokkitConfig } from './config.js'
import type { Storage } from './storage.js'

export interface AuthUser {
  userId: string
  email: string
  name?: string
  isProject?: boolean
  isAdmin?: boolean
}

/**
 * 🔒 驗 LetMeUse token 的 HS256 簽章 (取代舊的「只 decode」)。
 * 舊版只 base64 解 payload → 任何人自編 payload (sub/email 隨便填) 就能闖進來,
 * 還能把 email 填成 admin 拿全權限。這版用 app secret 驗簽 → 偽造直接擋。
 * 偽造 / 過期 / 別 app / 沒設 secret → null (fail-closed)。
 */
export function verifyLetMeUseToken(token: string, secret: string, appId: string): AuthUser | null {
  try {
    const [headerB64, payloadB64, sigB64] = token.split('.')
    if (!headerB64 || !payloadB64 || !sigB64) return null
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf-8'))

    // 1. 只收 ES256 (JWKS 公鑰驗)。
    // ⚠️ 2026-10-25 資安事件:HS256 過渡路徑是入侵面 — 攻擊者取得 app secret 後
    // 用 HS256 自簽任意 sub (usr_3kxvW3qwFYqe) 闖進來當免費圖床。LetMeUse 早已全面
    // ES256,真實用戶的 token 都走 JWKS 公鑰(無法偽造,除非 LetMeUse 私鑰外洩),
    // 故直接廢掉 HS256 — 就算 secret 已洩,偽造 token 也一律被擋。
    if (header.alg === 'ES256') {
      const pub = getJwksPublicKey(header.kid)
      if (!pub) return null
      const ok = crypto.verify(
        'sha256',
        Buffer.from(`${headerB64}.${payloadB64}`),
        { key: pub, dsaEncoding: 'ieee-p1363' },
        Buffer.from(sigB64, 'base64url'),
      )
      if (!ok) return null
    } else {
      return null // HS256 / none / 其他 → 一律擋
    }
    void secret // 保留簽名相容;HS256 已廢除後不再使用

    // 2. payload 檢查
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'))
    if (payload.exp && payload.exp * 1000 < Date.now()) return null
    if (appId && payload.app !== appId) return null // 別 app 的 token 不準借用
    const userId = payload.sub || payload.userId
    if (!userId) return null
    return { userId, email: payload.email || '', name: payload.name }
  } catch {
    return null
  }
}

/** Constant-time string compare (length-safe): false fast on length mismatch. */
function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

/** True when the request carries ANY credential. Used by the guest-upload path:
 *  no credential at all → guest; a PRESENT credential must still pass requireAuth
 *  (an invalid/expired token must 401 loudly, never silently demote to guest —
 *  otherwise someone who thinks they're uploading to their account gets their
 *  file stored as an anonymous 7-day-expiry guest file). */
export function hasAuthToken(request: FastifyRequest): boolean {
  return extractToken(request) !== null
}

/** Extract the bearer/X-Pokkit-Key token from a request, if any. */
function extractToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7)
  const headerKey = request.headers['x-pokkit-key']
  if (typeof headerKey === 'string' && headerKey.length > 0) return headerKey
  return null
}

/**
 * Resolve the caller. Order: global API key (admin) → project account key →
 * LetMeUse JWT. `storage` is optional so existing call sites keep working; pass
 * it to enable per-project key auth.
 */
export function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  config: PokkitConfig,
  storage?: Storage,
): AuthUser | null {
  const token = extractToken(request)
  if (!token) {
    reply.status(401).send({ error: 'Unauthorized' })
    return null
  }

  // Global API key → admin (constant-time compare so response timing can't be
  // used to recover the key byte-by-byte).
  if (config.apiKey && config.apiKey.length > 0 && timingSafeEqualStr(token, config.apiKey)) {
    return { userId: 'admin', email: 'admin', isAdmin: true }
  }

  // Per-project account key (pk_…)
  if (storage && token.startsWith('pk_')) {
    const account = storage.resolveAccountByKey(token)
    if (account) {
      return {
        userId: account.id,
        email: account.name,
        name: account.name,
        isProject: true,
        isAdmin: !!account.is_admin,
      }
    }
    reply.status(401).send({ error: 'Invalid project key' })
    return null
  }

  // LetMeUse JWT (a human) — 🔒 驗簽章, 不是只 decode
  const user = verifyLetMeUseToken(token, config.letmeuseAppSecret, config.letmeuseAppId)
  if (!user) {
    reply.status(401).send({ error: 'Invalid or expired token' })
    return null
  }
  const isAdmin =
    config.adminUsers.includes(user.userId) ||
    (user.email ? config.adminUsers.includes(user.email) : false)
  return { ...user, isAdmin }
}

/**
 * Whether a caller may act on a specific file. Admins (owner / global key) can
 * touch anything; everyone else is limited to files they own (user_id match).
 */
export function canAccessEntry(user: AuthUser, entry: { user_id?: string | null }): boolean {
  if (user.isAdmin) return true
  return !!entry.user_id && entry.user_id === user.userId
}

/**
 * Whether a caller may act on a specific album. Admins/owner touch anything;
 * a tenant is limited to albums it owns. Legacy NULL-owner albums belong to the
 * owner, so a non-admin caller can never reach them.
 */
export function canAccessAlbum(user: AuthUser, album: { user_id?: string | null }): boolean {
  if (user.isAdmin) return true
  return !!album.user_id && album.user_id === user.userId
}

/** Like requireAuth, but 403s non-admin callers. Returns null if not admin. */
export function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  config: PokkitConfig,
  storage?: Storage,
): AuthUser | null {
  const user = requireAuth(request, reply, config, storage)
  if (!user) return null
  if (!user.isAdmin) {
    reply.status(403).send({ error: 'Admin only' })
    return null
  }
  return user
}
