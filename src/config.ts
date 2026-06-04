import { resolve } from 'node:path'

export interface StorageTier {
  name: string
  maxPhotos: number
}

export const STORAGE_TIERS: Record<string, StorageTier> = {
  free: { name: 'Free', maxPhotos: 50000 },
  premium: { name: 'Premium', maxPhotos: 500000 },
}

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
  }
}
