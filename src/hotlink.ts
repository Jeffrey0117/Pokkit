import type { PokkitConfig } from './config.js'

interface RequestLike {
  headers: Record<string, string | string[] | undefined>
}

function first(value: string | string[] | undefined): string {
  return String((Array.isArray(value) ? value[0] : value) ?? '').split(',')[0].trim().toLowerCase()
}

// 防盜連:別的網站拿我們的圖片影片嵌在自己頁面上就擋掉。
// 直接打開網址、App 內、分享頁(同站)都沒有外站 Referer,照常放行。
export function isHotlinked(request: RequestLike, config: Pick<PokkitConfig, 'publicUrl'> & { publicHosts?: string[] }): boolean {
  const referer = first(request.headers.referer)
  if (!referer) return false
  let host: string
  try {
    host = new URL(referer).host.toLowerCase()
  } catch {
    return true
  }
  const allowed = new Set<string>(config.publicHosts ?? [])
  const self = first(request.headers['x-forwarded-host']) || first(request.headers.host)
  if (self) allowed.add(self)
  if (config.publicUrl) {
    try {
      allowed.add(new URL(config.publicUrl).host.toLowerCase())
    } catch {
      /* 設定有誤就只看其他來源 */
    }
  }
  return !allowed.has(host)
}
