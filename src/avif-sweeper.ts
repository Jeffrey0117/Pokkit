import { execFile } from 'node:child_process'
import { existsSync, statSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { Storage } from './storage.js'

// ── AVIF 閒時歸檔 sweeper(Immich 式) ─────────────────────────────
// 上傳當下壓 AVIF 是記憶體怪獸(2026-10-25 OOM 連環實案),已永久移出熱路徑。
// 這裡把省空間的福利撿回來:伺服器「閒」的時候(距上次上傳 ≥ IDLE_MS 且無
// processing 中的照片),每 tick 挑一張最舊的未歸檔照片,丟「子程序」編碼
// (記憶體完全隔離,主程序 RSS 不動),成功就原子換檔 + DB 跟上。
// 一次一張、編碼期間偵測到新上傳就讓路 — 永不打擾使用者。

const IDLE_MS = Number(process.env.POKKIT_SWEEPER_IDLE_MS) || 10 * 60 * 1000
const TICK_MS = Number(process.env.POKKIT_SWEEPER_TICK_MS) || 60 * 1000
const ENABLED = process.env.POKKIT_ARCHIVE_SWEEPER !== 'off'

let lastIngestAt = Date.now() // 開機先當作剛忙完,冷卻一輪再開工
let timer: ReturnType<typeof setInterval> | null = null
let running = false
let swept = 0
let savedBytes = 0

export function markIngest(): void {
  lastIngestAt = Date.now()
}

export function getSweeperState() {
  return { enabled: ENABLED, running, swept, savedMB: Math.round(savedBytes / 1048576), idleForMs: Date.now() - lastIngestAt }
}

function encodeInChild(rawPath: string, tmpOut: string): Promise<{ ok: boolean; error?: string; width?: number; height?: number; inBytes?: number; outBytes?: number }> {
  return new Promise((resolve) => {
    const script = join(process.cwd(), 'scripts', 'avif-encode-one.cjs')
    execFile(process.execPath, [script, rawPath, tmpOut], { timeout: 180000, windowsHide: true }, (err, stdout) => {
      if (err) { resolve({ ok: false, error: String(err.message) }); return }
      try { resolve(JSON.parse(String(stdout).trim().split('\n').pop() || '{}')) }
      catch { resolve({ ok: false, error: 'bad child output' }) }
    })
  })
}

const RAW_EXTS = ['_raw.jpg', '_raw.jpeg', '_raw.png', '_raw.webp']

export async function sweepOnce(storage: Storage, dataDir: string): Promise<{ action: string; id?: string; detail?: string }> {
  // raw 檔是磁碟慣例(<id>/_raw.<ext>),DB 的 stored_name 指向展示版 photo.webp
  // — 歸檔是純磁碟換檔,DB 零寫入。候選 = 全 ready 照片 id 逐一磁碟探測。
  const store = storage as unknown as { store: { listArchiveCandidates(): Array<{ id: string }> } }
  const candidates = store.store.listArchiveCandidates()
  for (const c of candidates) {
    const dir = join(dataDir, 'default', c.id)
    const skipMarker = join(dir, '.avif-skip')
    const avifPath = join(dir, '_raw.avif')
    if (existsSync(skipMarker) || existsSync(avifPath)) continue
    const rawExt = RAW_EXTS.find((e) => existsSync(join(dir, e)))
    if (!rawExt) continue // HEIC/無 raw 等 — 跳過(不寫 marker,成本只是一次探測)
    const rawPath = join(dir, rawExt)

    const inBytes = statSync(rawPath).size
    const tmpOut = avifPath + '.tmp'
    const ingestBefore = lastIngestAt
    const r = await encodeInChild(rawPath, tmpOut)
    // 讓路判斷 = 「編碼期間有沒有新上傳進來」(比絕對閒置時長會誤殺手動觸發)
    if (lastIngestAt !== ingestBefore) {
      try { unlinkSync(tmpOut) } catch { /* */ }
      return { action: 'yielded' }
    }
    if (!r.ok || !r.outBytes || r.outBytes >= inBytes * 0.95) {
      try { unlinkSync(tmpOut) } catch { /* */ }
      try { writeFileSync(skipMarker, r.error || 'not smaller') } catch { /* */ }
      continue
    }
    renameSync(tmpOut, avifPath)
    try { unlinkSync(rawPath) } catch { /* */ }
    swept++
    savedBytes += inBytes - r.outBytes
    return { action: 'archived', id: c.id, detail: `${(inBytes / 1048576).toFixed(2)}MB -> ${(r.outBytes / 1048576).toFixed(2)}MB` }
  }
  return { action: 'nothing-to-do' }
}

export function startAvifSweeper(storage: Storage, dataDir: string): void {
  if (!ENABLED) { console.error('[avif-sweeper] disabled (POKKIT_ARCHIVE_SWEEPER=off)'); return }
  timer = setInterval(async () => {
    if (running) return
    if (Date.now() - lastIngestAt < IDLE_MS) return
    const processing = (storage as unknown as { store: { _db: { prepare(q: string): { get(): { c: number } } } } })
      .store._db.prepare("SELECT COUNT(*) c FROM files WHERE status = 'processing'").get().c
    if (processing > 0) return
    running = true
    try {
      const r = await sweepOnce(storage, dataDir)
      if (r.action === 'archived') console.log(`[avif-sweeper] ${r.id}: ${r.detail} (累計 ${swept} 張 / 省 ${Math.round(savedBytes / 1048576)}MB)`)
      else if (r.action === 'db-fixed') console.log(`[avif-sweeper] ${r.id}: 歷史歸檔的 DB 記錄已修復`)
    } catch (e) {
      console.error('[avif-sweeper] tick error:', (e as Error).message)
    } finally {
      running = false
    }
  }, TICK_MS)
  console.error(`[avif-sweeper] armed (idle ${IDLE_MS / 60000}min, tick ${TICK_MS / 1000}s)`)
}

export function stopAvifSweeper(): void {
  if (timer) { clearInterval(timer); timer = null }
}
