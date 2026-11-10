import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// 下載憑證:登入的人按下載時才拿到,只對一個檔案有效,一分鐘就過期。
// 金鑰每次開機重新產生,重啟頂多讓剛拿到的憑證失效,重按一次就好。
const SECRET = randomBytes(32)
const DEFAULT_TTL_MS = 60_000

function sign(id: string, exp: number): string {
  return createHmac('sha256', SECRET).update(`${id}.${exp}`).digest('base64url')
}

export function issueTicket(id: string, ttlMs = DEFAULT_TTL_MS, now = Date.now()): string {
  const exp = now + ttlMs
  return `${exp}.${sign(id, exp)}`
}

export function verifyTicket(id: string, ticket: unknown, now = Date.now()): boolean {
  if (typeof ticket !== 'string') return false
  const dot = ticket.indexOf('.')
  if (dot <= 0) return false
  const exp = Number(ticket.slice(0, dot))
  if (!Number.isFinite(exp) || exp < now) return false
  const given = Buffer.from(ticket.slice(dot + 1))
  const expected = Buffer.from(sign(id, exp))
  return given.length === expected.length && timingSafeEqual(given, expected)
}
