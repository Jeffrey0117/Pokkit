import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const WORKER_PATH = join(__dirname, 'workers', 'photo-processor.js')

let worker: Worker | null = null
let dataDir: string = ''

function spawn(): Worker {
  const w = new Worker(WORKER_PATH, {
    workerData: { dataDir },
  })

  w.on('message', (msg) => {
    if (msg.type === 'ready') {
      console.log('[PhotoWorker] Worker ready')
    } else if (msg.type === 'done') {
      console.log(`[PhotoWorker] Processed ${msg.id}`)
    } else if (msg.type === 'error') {
      console.error(`[PhotoWorker] Failed ${msg.id}: ${msg.error}`)
    }
  })

  w.on('error', (err) => {
    console.error('[PhotoWorker] Worker error:', err.message)
  })

  w.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[PhotoWorker] Worker exited with code ${code}, respawning...`)
      worker = spawn()
    }
  })

  return w
}

export function initPhotoWorker(dir: string): void {
  dataDir = dir
  worker = spawn()
  recoverStuckPhotos()
}

function recoverStuckPhotos(): void {
  const PokkitStore = require('../core/index.js')
  const store = new PokkitStore({
    dataDir,
    buckets: { default: { mode: 'uuid-dir' } },
  })
  const stuck = store.listStuckProcessing()
  if (stuck.length === 0) return

  console.log(`[PhotoWorker] Recovering ${stuck.length} stuck photo(s)...`)
  for (const entry of stuck) {
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
  if (!worker) {
    throw new Error('Photo worker not initialized. Call initPhotoWorker() first.')
  }
  worker.postMessage({ id, rawPath })
}

export async function shutdownWorker(): Promise<void> {
  if (worker) {
    await worker.terminate()
    worker = null
    console.log('[PhotoWorker] Worker terminated')
  }
}
