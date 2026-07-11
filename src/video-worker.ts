import { Worker } from 'node:worker_threads'
import { execFile, execSync } from 'node:child_process'
import { join, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const WORKER_PATH = join(__dirname, 'workers', 'video-processor.cjs')

let worker: Worker | null = null
let dataDir: string = ''
let ffmpegAvailable: boolean | null = null

export function hasFfmpeg(): boolean {
  return ffmpegAvailable === true
}

// PM2 daemon 的 PATH 是啟動時快照,常缺 winget 的 user PATH(升版還會換版本化資料夾名)。
// 偵測不到 ffmpeg 就把 FFMPEG_DIR 或 winget 的 bin 補進 process.env.PATH(worker thread 繼承)。
// 2026-07-11 實案:ffmpeg 缺席 → 影片轉檔靜默停用,27 支影片卡 failed、縮圖 404。
function ensureFfmpegInPath(): void {
  try { execSync('ffmpeg -version', { stdio: 'ignore', windowsHide: true, timeout: 10000 }); return } catch {}
  const candidates: string[] = []
  if (process.env.FFMPEG_DIR) candidates.push(process.env.FFMPEG_DIR)
  try {
    const base = join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages')
    for (const pkg of readdirSync(base).filter((d) => d.startsWith('Gyan.FFmpeg'))) {
      for (const inner of readdirSync(join(base, pkg)).filter((d) => d.startsWith('ffmpeg-'))) {
        candidates.push(join(base, pkg, inner, 'bin'))
      }
    }
  } catch {}
  for (const bin of candidates) {
    if (existsSync(join(bin, 'ffmpeg.exe')) || existsSync(join(bin, 'ffmpeg'))) {
      process.env.PATH = `${bin}${delimiter}${process.env.PATH || ''}`
      console.log(`[VideoWorker] ffmpeg 不在 PATH,已自動補上: ${bin}`)
      return
    }
  }
  console.warn('[VideoWorker] ⚠️ 找不到 ffmpeg(PATH/FFMPEG_DIR/winget 都沒有)')
}

function checkFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-version'], { timeout: 5000, windowsHide: true }, (err) => {
      resolve(!err)
    })
  })
}

function spawn(): Worker {
  const w = new Worker(WORKER_PATH, {
    workerData: { dataDir },
  })

  w.on('message', (msg) => {
    if (msg.type === 'ready') {
      console.log('[VideoWorker] Worker ready')
    } else if (msg.type === 'done') {
      console.log(`[VideoWorker] Processed ${msg.id}`)
    } else if (msg.type === 'error') {
      console.error(`[VideoWorker] Failed ${msg.id}: ${msg.error}`)
    }
  })

  w.on('error', (err) => {
    console.error('[VideoWorker] Worker error:', err.message)
  })

  w.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[VideoWorker] Worker exited with code ${code}, respawning...`)
      worker = spawn()
    }
  })

  return w
}

function waitForReady(w: Worker): Promise<void> {
  return new Promise((resolve) => {
    const handler = (msg: { type: string }) => {
      if (msg.type === 'ready') {
        w.off('message', handler)
        resolve()
      }
    }
    w.on('message', handler)
    // Timeout fallback — don't wait forever
    setTimeout(() => { w.off('message', handler); resolve() }, 5000)
  })
}

export async function initVideoWorker(dir: string): Promise<void> {
  dataDir = dir
  ensureFfmpegInPath()
  ffmpegAvailable = await checkFfmpeg()
  if (!ffmpegAvailable) {
    console.warn('[VideoWorker] ffmpeg not found — video upload disabled')
    return
  }
  console.log('[VideoWorker] ffmpeg detected')
  worker = spawn()
  await waitForReady(worker)
  recoverStuckVideos()
}

function recoverStuckVideos(): void {
  const PokkitStore = require('../core/index.js')
  const store = new PokkitStore({
    dataDir,
    buckets: { default: { mode: 'uuid-dir' } },
  })
  // processing = 上次處理到一半被殺;failed = 轉檔失敗(常見:ffmpeg 缺席時期)。
  // 兩者只要 _raw 還在都重跑 — failed 不重撿的話縮圖/壓縮檔永遠缺(2026-07-11 27 支實案)。
  const stuck = store.listStuckProcessing()
    .filter((e: { media_type?: string }) => e.media_type === 'video')
  const failed = store.listFailedVideos()
  const seen = new Set<string>()
  const targets = [...stuck, ...failed].filter((e: { id: string }) => {
    if (seen.has(e.id)) return false
    seen.add(e.id)
    return true
  })
  if (targets.length === 0) return

  console.log(`[VideoWorker] Recovering ${targets.length} video(s) (${stuck.length} stuck, ${failed.length} failed)...`)
  for (const entry of targets) {
    const entryDir = join(dataDir, 'default', entry.id)
    if (!existsSync(entryDir)) {
      store.failPhoto(entry.id, 'Raw file directory missing after crash')
      continue
    }
    const files: string[] = readdirSync(entryDir)
    const rawFile = files.find((f: string) => f.startsWith('_raw.'))
    if (rawFile) {
      const rawPath = join(entryDir, rawFile)
      console.log(`[VideoWorker] Reprocessing ${entry.id}`)
      processVideo(entry.id, rawPath)
    } else {
      store.failPhoto(entry.id, 'Raw file missing after crash')
    }
  }
}

export function processVideo(id: string, rawPath: string): void {
  if (!worker) {
    throw new Error('Video worker not initialized. Call initVideoWorker() first.')
  }
  worker.postMessage({ id, rawPath })
}

export async function shutdownVideoWorker(): Promise<void> {
  if (worker) {
    await worker.terminate()
    worker = null
    console.log('[VideoWorker] Worker terminated')
  }
}
