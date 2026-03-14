import type { FastifyRequest, FastifyReply } from 'fastify'
import type { PokkitConfig } from './config.js'

export interface AuthUser {
  userId: string
  email: string
  name?: string
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

export function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  config: PokkitConfig,
): AuthUser | null {
  const auth = request.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Unauthorized' })
    return null
  }

  const token = auth.slice(7)

  // Try API key first (for CLI/curl — only if apiKey is actually set)
  if (config.apiKey && config.apiKey.length > 0 && token === config.apiKey) {
    return { userId: 'admin', email: 'admin' }
  }

  // Try LetMeUse JWT
  const user = decodeLetMeUseToken(token)
  if (!user) {
    reply.status(401).send({ error: 'Invalid or expired token' })
    return null
  }

  return user
}
