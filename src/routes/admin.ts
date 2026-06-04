import type { FastifyInstance } from 'fastify'
import type { Storage } from '../storage.js'
import type { PokkitConfig } from '../config.js'
import { requireAuth, requireAdmin } from '../auth.js'

/**
 * Multi-tenant admin API. All /api/admin/* routes are admin-only (the owner's
 * LetMeUse login per POKKIT_ADMIN_USERS, the global API key, or an is_admin
 * account). Project accounts authenticate with their own pk_ key elsewhere and
 * can never reach these routes.
 */
export function adminRoute(app: FastifyInstance, storage: Storage, config: PokkitConfig) {
  // Lightweight identity probe so the client can decide whether to show the
  // admin-only "Projects" UI. Any authenticated caller may ask.
  app.get('/api/me', async (request, reply) => {
    const user = requireAuth(request, reply, config, storage)
    if (!user) return
    return {
      userId: user.userId,
      email: user.email,
      isAdmin: !!user.isAdmin,
      isProject: !!user.isProject,
    }
  })

  // List all project accounts with usage.
  app.get('/api/admin/accounts', async (request, reply) => {
    const user = requireAdmin(request, reply, config, storage)
    if (!user) return
    return { accounts: storage.listAccounts() }
  })

  // Create a project account. Returns the plaintext key ONCE.
  app.post<{ Body: { name?: string } }>('/api/admin/accounts', async (request, reply) => {
    const user = requireAdmin(request, reply, config, storage)
    if (!user) return
    const name = (request.body?.name || '').trim()
    if (!name) {
      return reply.status(400).send({ error: 'Project name required' })
    }
    const { account, key } = storage.createAccount(name)
    return reply.status(201).send({ account, key })
  })

  // Rotate an account's key (invalidates the old one). Returns the new key once.
  app.post<{ Params: { id: string } }>('/api/admin/accounts/:id/rotate', async (request, reply) => {
    const user = requireAdmin(request, reply, config, storage)
    if (!user) return
    const result = storage.rotateAccountKey(request.params.id)
    if (!result) {
      return reply.status(404).send({ error: 'Account not found' })
    }
    return { key: result.key }
  })

  // Delete an account. Refuses if it still owns files unless ?force=1 (which
  // also wipes those files from disk + DB).
  app.delete<{ Params: { id: string }; Querystring: { force?: string } }>(
    '/api/admin/accounts/:id',
    async (request, reply) => {
      const user = requireAdmin(request, reply, config, storage)
      if (!user) return
      const account = storage.getAccount(request.params.id)
      if (!account) {
        return reply.status(404).send({ error: 'Account not found' })
      }
      const fileCount = storage.countFilesByUser(account.id)
      const force = request.query.force === '1'
      if (fileCount > 0 && !force) {
        return reply.status(409).send({
          error: `Account has ${fileCount} files. Pass force=1 to delete them too.`,
          fileCount,
        })
      }
      storage.deleteAccount(account.id, { wipeFiles: force })
      return { ok: true, wiped: force ? fileCount : 0 }
    },
  )

  // Browse one account's files (admin cross-account view).
  app.get<{ Querystring: { account?: string; limit?: string; offset?: string; order?: string } }>(
    '/api/admin/files',
    async (request, reply) => {
      const user = requireAdmin(request, reply, config, storage)
      if (!user) return
      const accountId = (request.query.account || '').trim()
      if (!accountId) {
        return reply.status(400).send({ error: 'account query param required' })
      }
      const limit = Math.min(parseInt(request.query.limit || '200', 10) || 200, 1000)
      const offset = parseInt(request.query.offset || '0', 10) || 0
      const order = request.query.order === 'asc' ? 'asc' : 'desc'
      return storage.listFilesByUser(accountId, { limit, offset, order })
    },
  )
}
