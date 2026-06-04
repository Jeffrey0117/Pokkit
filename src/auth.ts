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

export function decodeLetMeUseToken(token: string): AuthUser | null {
  try {
    const [, payloadPart] = token.split('.')
    if (!payloadPart) return null
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf-8'))
    if (payload.exp && payload.exp * 1000 < Date.now()) return null
    const userId = payload.sub || payload.userId
    if (!userId) return null
    return {
      userId,
      email: payload.email || '',
      name: payload.name,
    }
  } catch {
    return null
  }
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

  // Global API key → admin (unchanged, back-compat)
  if (config.apiKey && config.apiKey.length > 0 && token === config.apiKey) {
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

  // LetMeUse JWT (a human)
  const user = decodeLetMeUseToken(token)
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
