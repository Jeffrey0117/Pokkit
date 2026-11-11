import crypto from 'node:crypto'
import { verifyJwt, bearerToken, type Claims } from 'jwks-verify-kit'
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
 * 🔒 驗 LetMeUse token — **只收 ES256**, 公鑰從 JWKS 拿。
 *
 * 2026-11-08: 驗章實作搬進 `jwks-verify-kit`(生態系原本有十份各自獨立的拷貝,
 * 每份踩到不同的一半坑)。這份原本中的兩個 fail-open:
 *
 *   1. `if (payload.exp && payload.exp * 1000 < Date.now())` —— **沒有 exp 的
 *      token 等於永不過期**(字串型 exp 也躲過: `"abc" * 1000` 是 NaN, NaN 的
 *      比較恆為 false)。4h 的 exp 是這套設計唯一的撤銷機制: 登出、停用帳號、
 *      資安事件後強制登出, 全靠它。
 *   2. `if (appId && payload.app !== appId)` —— 自己忘了設 LETMEUSE_APP_ID 就
 *      等於接受任何 LetMeUse app 的任何使用者。LetMeUse 用同一把 ES256 金鑰簽發
 *      所有 app 的 token, 所以 `app` claim 是唯一的租戶邊界。現在 appId 缺了會
 *      在啟動時 throw(或注入 getKey 時 fail-closed), 不是靜默放行。
 *
 * 另外撿到的: nbf 沒檢查、簽章段的非正規化寫法(同一個簽章 16 種等價編碼)、
 * claims 走原型鏈(prototype pollution ＋ 無 exp token = 永久通行證)、`crit`
 * header 沒擋、金鑰曲線沒對照。
 *
 * ⚠️ 2026-10-25 資安事件: HS256 過渡路徑是入侵面 —— 攻擊者取得 app secret 後
 * 用 HS256 自簽任意 sub 闖進來當免費圖床。HS256 的根本問題是「驗證方必須握著
 * 簽發金鑰」; 改成只收 ES256 之後驗證只需要公鑰, **這台機器完全不需要 app
 * secret**(所以 2026-11-08 一併把 `letmeuseAppSecret` 從 config 與 .env 移除,
 * 少一個外洩點 —— 而上次洩的就是它)。
 *
 * 偽造 / 過期 / 尚未生效 / 別 app / 沒帶 app → null (fail-closed, 從不丟例外)。
 *
 * getKey 可注入(測試用), 預設走行程共用的 JWKS 快取。
 */
export function verifyLetMeUseToken(
  token: string,
  appId: string,
  getKey: (kid: string) => crypto.KeyObject | null = getJwksPublicKey,
): AuthUser | null {
  // 🔒 appId 必填, 而且要壞得大聲。LetMeUse 用同一把 ES256 金鑰簽發**所有** app
  // 的 token, 所以 `app` claim 是唯一的租戶邊界 —— 沒有它不是「少一道檢查」,
  // 而是「生態系任何 app 的任何使用者都進得來」。kit 的 requiredClaims 本身就會
  // fail-closed, 但那會變成「全部 401 且零線索」, 所以這裡自己講一句。
  if (!appId) {
    console.error('[auth] 401: 沒設 LETMEUSE_APP_ID, 一律拒絕 (JWKS 全 app 共用金鑰)')
    return null
  }

  const claims: Claims | null = verifyJwt(token, {
    getKey,
    algorithms: ['ES256'],
    requiredClaims: { app: appId },
    // 逐顆 token 的拒絕原因。只進 stderr —— info 裡的值多半是呼叫端送來的,
    // 原樣回給對方等於反射式資訊外洩。
    onReject: (info) => {
      if (process.env.POKKIT_LOG !== 'silent') console.error(`[auth] 401: ${info.reason}`)
    },
  })
  if (!claims) return null

  // kit 已保證 sub 是非空字串; userId 是歷史相容的別名
  const userId = typeof claims.sub === 'string' && claims.sub
    ? claims.sub
    : (claims as Record<string, unknown>).userId
  if (typeof userId !== 'string' || !userId) return null
  return {
    userId,
    email: typeof claims.email === 'string' ? claims.email : '',
    name: typeof claims.name === 'string' ? claims.name : undefined,
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
  // scheme 比對用 kit 的（RFC 7235 §2.1: auth-scheme 不分大小寫）。自己寫
  // `startsWith('Bearer ')` 的話,送 `bearer xxx` 的 client 在這個服務會 401 而在
  // 生態系其他服務正常 —— 那種不一致會害人查很久。
  const bearer = bearerToken(request.headers.authorization)
  if (bearer) return bearer
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

  // 自架 (沒設會員系統):只認金鑰,不去碰會員系統的驗證
  if (!config.letmeuseAppId) {
    reply.status(401).send({ error: 'Invalid key' })
    return null
  }

  // LetMeUse JWT (a human) — 🔒 驗簽章, 不是只 decode
  const user = verifyLetMeUseToken(token, config.letmeuseAppId, config.getJwtKey as never)
  if (!user) {
    reply.status(401).send({ error: 'Invalid or expired token' })
    return null
  }
  const isAdmin =
    config.adminUsers.includes(user.userId) ||
    (user.email ? config.adminUsers.includes(user.email) : false)
  if (!isAdmin && storage?.moderation?.isBlocked(user.userId)) {
    reply.status(403).send({ error: 'This account has been suspended.', code: 'account_blocked' })
    return null
  }
  return { ...user, isAdmin }
}

/**
 * Whether a caller may act on a specific file. Admins (owner / global key) can
 * touch anything; everyone else is limited to files they own (user_id match).
 */
export function isMachineAdmin(user: AuthUser): boolean {
  return !!user.isAdmin && (user.isProject === true || user.userId === 'admin')
}

// 登入的人只看自己的檔案庫,管理員也一樣;看別人的檔案走會員管理後台。
// 只有 API key 這種機器身分維持看整個服務。
export function librarySelector(user: AuthUser): { userId?: string; excludeAccounts?: boolean } {
  return isMachineAdmin(user) ? { excludeAccounts: true } : { userId: user.userId }
}

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
