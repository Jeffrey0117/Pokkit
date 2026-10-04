import { resolve } from 'node:path'

export const GB = 1024 * 1024 * 1024

export interface StorageTier {
  name: string
  /** Total storage cap — the REAL quota axis. Items are a sanity ceiling only. */
  maxBytes: number
  maxPhotos: number
}

// 容量制 (2026-10-04 商業化改版): 賣的量尺是 bytes, 不是件數 —
// 一張照片 2MB 和一支 4K 影片 2GB 都算「1 件」的舊制會把家機硬碟灌爆。
// maxPhotos 留著當防灌爆的件數天花板 (正常使用碰不到)。
// 這份定義是 tier 的單一來源: /api/tiers 餵前端方案頁, checkQuota 拿它執法。
export const STORAGE_TIERS: Record<string, StorageTier> = {
  free: { name: 'Free', maxBytes: 2 * GB, maxPhotos: 50000 },
  premium: { name: 'Pro', maxBytes: 100 * GB, maxPhotos: 500000 },
}

// Guest 快傳 (試用入口): 免登入、單檔上限、強制短壽命。
// GUEST_USER_ID 是這類檔案共同的 user_id — 無帳號可管理, 7 天內清掃掉。
export const GUEST_USER_ID = 'guest'
export const GUEST_MAX_FILE_BYTES = 64 * 1024 * 1024
// 方案頁顯示用的佔位月費 (NTD) — 金流接上前純展示, 不是扣款依據。
export const PRO_PRICE_NTD = 149

export interface PokkitConfig {
  port: number
  host: string
  dataDir: string
  apiKey: string
  maxFileSize: number
  publicUrl: string
  premiumUserIds: string[]
  // LetMeUse users (userId or email) allowed to use the cross-account admin
  // view. Empty = no human is admin (only the global API key / is_admin accounts).
  adminUsers: string[]
  // 🔒 LetMeUse HS256 signing secret — 用來「驗」token 簽章 (不是只 decode)。
  // 缺它 = 拒絕所有 LetMeUse token (fail-closed), 別讓偽造 token 闖進來。
  letmeuseAppSecret: string
  letmeuseAppId: string
  // 全站總容量保險絲 (bytes): 家機硬碟有限, 超線後非 admin 上傳一律 507。
  globalCapacityBytes: number
}

function parseArgs(args: string[]): Partial<PokkitConfig> {
  const result: Partial<PokkitConfig> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const next = args[i + 1]
    if (arg === '--port' && next) { result.port = Number(next); i++ }
    if (arg === '--host' && next) { result.host = next; i++ }
    if (arg === '--data-dir' && next) { result.dataDir = next; i++ }
    if (arg === '--api-key' && next) { result.apiKey = next; i++ }
    if (arg === '--max-file-size' && next) { result.maxFileSize = Number(next); i++ }
    if (arg === '--public-url' && next) { result.publicUrl = next; i++ }
  }
  return result
}

export function loadConfig(): PokkitConfig {
  const cliArgs = parseArgs(process.argv.slice(2))
  return {
    port: cliArgs.port ?? (Number(process.env.PORT) || Number(process.env.POKKIT_PORT) || 8877),
    host: cliArgs.host ?? process.env.POKKIT_HOST ?? '0.0.0.0',
    dataDir: resolve(cliArgs.dataDir ?? process.env.POKKIT_DATA_DIR ?? './data'),
    apiKey: cliArgs.apiKey ?? process.env.POKKIT_API_KEY ?? '',
    maxFileSize: cliArgs.maxFileSize ?? (Number(process.env.POKKIT_MAX_FILE_SIZE) || 500 * 1024 * 1024),
    publicUrl: (cliArgs.publicUrl ?? process.env.POKKIT_PUBLIC_URL ?? '').replace(/\/$/, ''),
    premiumUserIds: (process.env.POKKIT_PREMIUM_USERS ?? '').split(',').filter(Boolean),
    adminUsers: (process.env.POKKIT_ADMIN_USERS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    letmeuseAppSecret: process.env.LETMEUSE_APP_SECRET ?? '',
    letmeuseAppId: process.env.LETMEUSE_APP_ID ?? '',
    globalCapacityBytes: (Number(process.env.GLOBAL_CAPACITY_GB) || 500) * GB,
  }
}
