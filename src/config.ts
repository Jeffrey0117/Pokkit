import { resolve } from 'node:path'

export interface StorageTier {
  name: string
  maxPhotos: number
}

export const STORAGE_TIERS: Record<string, StorageTier> = {
  free: { name: 'Free', maxPhotos: 500 },
  premium: { name: 'Premium', maxPhotos: 50000 },
}

export interface PokkitConfig {
  port: number
  host: string
  dataDir: string
  apiKey: string
  maxFileSize: number
  publicUrl: string
  premiumUserIds: string[]
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
  }
}
