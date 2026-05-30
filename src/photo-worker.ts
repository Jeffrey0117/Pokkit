import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const WORKER_PATH = join(__dirname, 'workers', 'photo-processor.cjs')

const POOL_SIZE = 4
let workers: Worker[] = []
let nextWorker = 0
let dataDir: string = ''

function spawnOne(index: number): Worker {
  const w = new Worker(WORKER_PATH, {
    workerData: { dataDir },
  })

  w.on('message', (msg) => {
    if (msg.type === 'ready') {
      console.log(`[PhotoWorker#${index}] Worker ready`)
    } else if (msg.type === 'done') {
      console.log(`[PhotoWorker#${index}] Processed ${msg.id}`)
    } else if (msg.type === 'error') {
      console.error(`[PhotoWorker#${index}] Failed ${msg.id}: ${msg.error}`)
    }
  })

  w.on('error', (err) => {
    console.error(`[PhotoWorker#${index}] Worker error:`, err.message)
  })

  w.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[PhotoWorker#${index}] Worker exited with code ${code}, respawning...`)
      workers[index] = spawnOne(index)
    }
  })

  return w
}

function spawnPool(): void {
  for (let i = 0; i < POOL_SIZE; i++) {
    workers[i] = spawnOne(i)
  }
}

export function initPhotoWorker(dir: string): void {
  dataDir = dir
  spawnPool()
  recoverStuckPhotos()
}

function recoverStuckPhotos(): void {
  const PokkitStore = require('../core/index.js')
  const store = new PokkitStore({
    dataDir,
    buckets: { default: { mode: 'uuid-dir' } },
  })
  const stuck = store.listStuckProcessing()
  // Only recover photos (videos are handled by video-worker)
  const stuckPhotos = stuck.filter((e: { media_type?: string }) => e.media_type !== 'video')
  if (stuckPhotos.length === 0) return

  console.log(`[PhotoWorker] Recovering ${stuckPhotos.length} stuck photo(s)...`)
  for (const entry of stuckPhotos) {
    const entryDir = join(dataDir, 'default', entry.id)
    if (!existsSync(entryDir)) {
      store.failPhoto(entry.id, 'Raw file directory missing after crash')
      continue
    }
    const fs = require('node:fs')
    const files: string[] = fs.readdirSync(entryDir)
    const rawFile = files.find((f: string) => f.startsWith('_raw.'))
    if (rawFile) {
      const rawPath = join(entryDir, rawFile)
      console.log(`[PhotoWorker] Reprocessing ${entry.id}`)
      processPhoto(entry.id, rawPath)
    } else {
      store.failPhoto(entry.id, 'Raw file missing after crash')
    }
  }
}

export function processPhoto(id: string, rawPath: string): void {
  if (workers.length === 0) {
    throw new Error('Photo worker pool not initialized. Call initPhotoWorker() first.')
  }
  const w = workers[nextWorker % workers.length]
  nextWorker++
  w.postMessage({ id, rawPath })
}

export async function shutdownWorker(): Promise<void> {
  const terminations = workers.map((w) => w.terminate())
  await Promise.all(terminations)
  workers = []
  nextWorker = 0
  console.log(`[PhotoWorker] All ${POOL_SIZE} workers terminated`)
}
