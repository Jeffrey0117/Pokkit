import { Worker } from 'node:worker_threads'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
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

function checkFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-version'], { timeout: 5000 }, (err) => {
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
  const stuck = store.listStuckProcessing()
  const stuckVideos = stuck.filter((e: { media_type?: string }) => e.media_type === 'video')
  if (stuckVideos.length === 0) return

  console.log(`[VideoWorker] Recovering ${stuckVideos.length} stuck video(s)...`)
  for (const entry of stuckVideos) {
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
