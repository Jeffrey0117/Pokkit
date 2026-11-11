import { isSelfHosted } from '../self-host.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Storage } from '../storage.js'
import type { PokkitConfig } from '../config.js'
import { GUEST_USER_ID } from '../config.js'
import { requireAdmin } from '../auth.js'
import { publicBaseUrl } from '../public-url.js'

const MAX_PAGE = 200

function pageOf(query: { limit?: string; offset?: string }) {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), MAX_PAGE)
  const offset = Math.max(Number(query.offset) || 0, 0)
  return { limit, offset }
}

const reasonOf = (body: unknown): string | null => {
  const reason = (body as { reason?: unknown } | undefined)?.reason
  return typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : null
}

// 會員管理後台:看用量、查檔案、下架、封鎖。全部限管理員,全部留紀錄。
export function moderationRoute(app: FastifyInstance, storage: Storage, config: PokkitConfig) {
  const mod = storage.moderation

  const isOwner = (userId: string, email: string | null) =>
    userId === 'admin' ||
    config.adminUsers.includes(userId) ||
    (!!email && config.adminUsers.includes(email))

  // 管理員自己、專案帳號、訪客這個共用桶都不能被封鎖或清空
  function protectedReason(userId: string): string | null {
    if (userId === GUEST_USER_ID) return '訪客是共用來源,請從單一檔案封鎖上傳者'
    if (mod.isProjectAccount(userId)) return '專案帳號不能在這裡處理'
    if (isOwner(userId, mod.profileEmail(userId))) return '不能處理管理員帳號'
    return null
  }

  function guard(request: FastifyRequest, reply: FastifyReply) {
    return requireAdmin(request, reply, config, storage)
  }

  // 自架的站沒有會員可管,這一頁 (含它載入的登入元件) 不提供
  app.get('/admin.html', async (_request, reply) => reply.status(404).send({ error: 'Not found' }))
  app.get('/admin', async (_request, reply) => {
    if (isSelfHosted(config)) return reply.status(404).send({ error: 'Not found' })
    const html = readFileSync(join(import.meta.dirname, '..', '..', 'public', 'admin.html'), 'utf8')
    return reply.header('Content-Type', 'text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html)
  })

  app.get<{ Querystring: { limit?: string; offset?: string } }>('/api/admin/members', async (request, reply) => {
    if (!guard(request, reply)) return
    const { limit, offset } = pageOf(request.query)
    return mod.listMembers(limit, offset, isOwner)
  })

  app.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string } }>(
    '/api/admin/members/:id/files',
    async (request, reply) => {
      if (!guard(request, reply)) return
      const { limit, offset } = pageOf(request.query)
      const base = publicBaseUrl(request, config)
      const files = mod.listMemberFiles(request.params.id, limit, offset).map((f) => ({
        ...f,
        hasPassword: !!f.hasPassword,
        shareUrl: `${base}/f/${f.id}`,
        thumbUrl: f.thumb ? `/photos/${f.id}/thumb.webp` : String(f.mime).startsWith('image/') ? `/files/${f.id}/preview` : null,
      }))
      return { files }
    },
  )

  app.post<{ Params: { id: string } }>('/api/admin/members/:id/block', async (request, reply) => {
    const admin = guard(request, reply)
    if (!admin) return
    const { id } = request.params
    const refused = protectedReason(id)
    if (refused) return reply.status(400).send({ error: refused })
    const reason = reasonOf(request.body)
    mod.block(id, reason, admin.email || admin.userId)
    mod.log(admin.email || admin.userId, 'block', { user: id, detail: reason })
    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/api/admin/members/:id/unblock', async (request, reply) => {
    const admin = guard(request, reply)
    if (!admin) return
    const { id } = request.params
    mod.unblock(id)
    mod.log(admin.email || admin.userId, 'unblock', { user: id })
    return { ok: true }
  })

  // 清空走垃圾桶:連結立刻失效,30 天內救得回來,之後才從硬碟刪除
  app.post<{ Params: { id: string } }>('/api/admin/members/:id/purge', async (request, reply) => {
    const admin = guard(request, reply)
    if (!admin) return
    const { id } = request.params
    const refused = protectedReason(id)
    if (refused) return reply.status(400).send({ error: refused })
    if ((request.body as { confirm?: unknown } | undefined)?.confirm !== id) {
      return reply.status(400).send({ error: '請輸入會員 ID 確認' })
    }
    const ids = mod.liveFileIds(id)
    let removed = 0
    for (let i = 0; i < ids.length; i += 1) {
      mod.markTakenDown(ids[i])
      if (storage.softDelete(ids[i])) removed += 1
      if (i % 200 === 199) await new Promise((resolve) => setImmediate(resolve))
    }
    const reason = reasonOf(request.body)
    mod.block(id, reason, admin.email || admin.userId)
    mod.log(admin.email || admin.userId, 'purge', { user: id, detail: `${removed} files${reason ? `: ${reason}` : ''}` })
    return { ok: true, removed }
  })

  app.delete<{ Params: { id: string } }>('/api/admin/files/:id', async (request, reply) => {
    const admin = guard(request, reply)
    if (!admin) return
    const entry = storage.find(request.params.id)
    if (!entry) return reply.status(404).send({ error: 'File not found' })
    mod.markTakenDown(entry.id)
    storage.softDelete(entry.id)
    mod.log(admin.email || admin.userId, 'takedown', {
      user: (entry as { user_id?: string | null }).user_id ?? null,
      file: entry.id,
      detail: reasonOf(request.body),
    })
    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/api/admin/files/:id/block-uploader', async (request, reply) => {
    const admin = guard(request, reply)
    if (!admin) return
    const entry = storage.find(request.params.id)
    if (!entry) return reply.status(404).send({ error: 'File not found' })
    const owner = (entry as { user_id?: string | null }).user_id ?? null
    const reason = reasonOf(request.body)
    const by = admin.email || admin.userId
    if (owner === GUEST_USER_ID) {
      const key = mod.guestKeyOf(entry.id)
      if (!key) return reply.status(409).send({ error: '這個檔案沒有來源紀錄,無法封鎖' })
      mod.blockGuest(key, reason, by)
      mod.log(by, 'block-guest', { user: GUEST_USER_ID, file: entry.id, detail: reason })
      return { ok: true }
    }
    if (!owner) return reply.status(409).send({ error: '這個檔案沒有擁有者' })
    const refused = protectedReason(owner)
    if (refused) return reply.status(400).send({ error: refused })
    mod.block(owner, reason, by)
    mod.log(by, 'block', { user: owner, file: entry.id, detail: reason })
    return { ok: true }
  })

  app.get<{ Querystring: { limit?: string; offset?: string } }>('/api/admin/moderation-log', async (request, reply) => {
    if (!guard(request, reply)) return
    const { limit, offset } = pageOf(request.query)
    return { log: mod.readLog(limit, offset) }
  })
}
