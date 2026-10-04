import type { FastifyInstance } from 'fastify'
import type { Storage } from '../storage.js'
import type { PokkitConfig } from '../config.js'
import { requireAuth } from '../auth.js'
import { onProcessed } from '../events.js'

// SSE stream of media-processing completions for the calling user. Replaces
// the SPA's 2-second status polling (which stays as fallback for browsers
// where EventSource errors out).
export function eventsRoute(app: FastifyInstance, storage: Storage, config: PokkitConfig) {
  app.get('/api/events', async (request, reply) => {
    // EventSource can't set an Authorization header → accept the token as a
    // query param and run it through the exact same validation path.
    const q = request.query as { token?: string }
    if (typeof q.token === 'string' && q.token.length > 0) {
      request.headers.authorization = `Bearer ${q.token}`
    }
    const user = requireAuth(request, reply, config, storage)
    if (!user) return

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // Tell buffering proxies (and our CF tunnel path) to stream as-is
      'X-Accel-Buffering': 'no',
    })
    reply.raw.write(':connected\n\n')

    const unsubscribe = onProcessed((ev) => {
      // Only forward events for files the caller owns (admins see all)
      try {
        const entry = storage.find(ev.id) as ({ user_id?: string | null } | undefined)
        if (!entry) return
        if (!user.isAdmin && entry.user_id !== user.userId) return
        reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`)
      } catch {
        // a broken write just means the client went away; close handler cleans up
      }
    })

    // Heartbeat keeps the connection alive through proxies that reap idle streams
    const heartbeat = setInterval(() => {
      try { reply.raw.write(':hb\n\n') } catch { /* close handler cleans up */ }
    }, 25000)

    request.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })

    // Keep the reply open — Fastify must not try to serialize a return value
    return reply
  })
}
