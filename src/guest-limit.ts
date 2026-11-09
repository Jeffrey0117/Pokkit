import { createHash } from 'node:crypto'

interface RequestLike {
  headers: Record<string, string | string[] | undefined>
  ip: string
}

// 一個 IPv6 用戶通常握有整段 /64,只看完整位址等於沒限制
function normalizeIp(ip: string): string {
  if (!ip.includes(':') || ip.startsWith('::ffff:')) return ip.replace('::ffff:', '')
  const [head] = ip.split('::')
  const groups = head.split(':')
  const full = ip.includes('::') ? [...groups, '0', '0', '0', '0'] : ip.split(':')
  return full.slice(0, 4).join(':').toLowerCase()
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

// 流量都從本機 tunnel 進來,真實來源在 Cloudflare 的標頭裡。
// 直接連區網 port 的人可以自己填這個標頭,所以只有本機來的才相信。
export function clientAddress(request: RequestLike): string {
  if (!LOOPBACK.has(request.ip)) return request.ip
  const header = request.headers['cf-connecting-ip']
  const value = Array.isArray(header) ? header[0] : header
  return value || request.ip
}

// 訪客沒有帳號,每日額度只能看來源 IP。Cloudflare 會覆寫這個標頭,外部偽造不了。
// 只存雜湊,計數兩天後就清掉。
export function guestKey(request: RequestLike): string {
  const ip = clientAddress(request)
  return createHash('sha256').update(`pokkit-guest:${normalizeIp(String(ip))}`).digest('hex')
}
