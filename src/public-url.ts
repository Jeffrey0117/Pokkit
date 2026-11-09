import type { PokkitConfig } from './config.js'

interface RequestLike {
  headers: Record<string, string | string[] | undefined>
  hostname?: string
}

function headerValue(value: string | string[] | undefined): string {
  return String((Array.isArray(value) ? value[0] : value) ?? '').split(',')[0].trim()
}

// 同一個服務掛多個網域:從哪個網域打開,產生的連結就用哪個。
// Host 標頭可以偽造,所以只接受名單內的網域,其他一律退回主網址。
export function publicBaseUrl(
  request: RequestLike,
  config: Pick<PokkitConfig, 'publicUrl' | 'port'> & { publicHosts?: string[] },
): string {
  const host = headerValue(request.headers['x-forwarded-host']) || headerValue(request.headers.host)
  const allowed = config.publicHosts ?? []
  if (allowed.includes(host.toLowerCase())) return `https://${host.toLowerCase()}`
  if (config.publicUrl) return config.publicUrl
  const proto = headerValue(request.headers['x-forwarded-proto']) || 'http'
  return `${proto}://${host || `${request.hostname}:${config.port}`}`
}
