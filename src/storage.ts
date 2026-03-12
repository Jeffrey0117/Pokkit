import { createRequire } from 'node:module'
import { existsSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { Readable } from 'node:stream'

const require = createRequire(import.meta.url)
const PokkitStore = require('../core/index.js')

export interface FileEntry {
  id: string
  bucket: string
  filename: string
  stored_name: string
  mime: string
  size: number
  hash: string | null
  is_directory: boolean
  uploaded_at: number
  metadata: object | null
}

export interface StorageStats {
  totalFiles: number
  totalBytes: number
  dataDir: string
  buckets?: Record<string, { totalFiles: number; totalBytes: number }>
}

export class Storage {
  private store: InstanceType<typeof PokkitStore>

  constructor(private dataDir: string) {
    this.store = new PokkitStore({
      dataDir,
      buckets: {
        default: { mode: 'uuid-dir' },
      },
    })
  }

  async init(): Promise<void> {
    // Migrate from JSON index if it exists and DB is empty
    const indexPath = join(this.dataDir, 'index.json')
    if (existsSync(indexPath)) {
      const stats = this.store.stats()
      if (stats.totalFiles === 0) {
        this.migrateFromJson(indexPath)
      }
    }
  }

  async save(filename: string, mime: string, buffer: Buffer): Promise<FileEntry> {
    return this.store.save(filename, mime, buffer, { bucket: 'default' })
  }

  getStream(id: string, _filename?: string): Readable | null {
    return this.store.getStream(id)
  }

  async getSize(id: string, _filename?: string): Promise<number | null> {
    const entry = this.store.find(id)
    return entry ? entry.size : null
  }

  find(id: string): FileEntry | undefined {
    const entry = this.store.find(id)
    return entry ?? undefined
  }

  list(): FileEntry[] {
    return this.store.list({ bucket: 'default', limit: 100000 })
  }

  async remove(id: string): Promise<boolean> {
    return this.store.remove(id)
  }

  stats(): StorageStats {
    const s = this.store.stats('default')
    return {
      totalFiles: s.totalFiles,
      totalBytes: s.totalBytes,
      dataDir: this.dataDir,
    }
  }

  close(): void {
    this.store.close()
  }

  private migrateFromJson(indexPath: string): void {
    try {
      const raw = readFileSync(indexPath, 'utf-8')
      const data = JSON.parse(raw) as { files: Array<{ id: string; filename: string; mime: string; size: number; uploadedAt: number }> }

      if (!data.files || data.files.length === 0) {
        // Empty index — just rename and move on
        renameSync(indexPath, indexPath + '.bak')
        return
      }

      console.log(`[Pokkit] Migrating ${data.files.length} files from index.json to SQLite...`)

      for (const f of data.files) {
        try {
          this.store.adopt('default', f.filename, f.mime, {
            id: f.id,
            metadata: { migratedFrom: 'index.json', originalUploadedAt: f.uploadedAt },
          })
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          console.warn(`[Pokkit] Skip migrate ${f.id}: ${msg}`)
        }
      }

      renameSync(indexPath, indexPath + '.bak')
      console.log(`[Pokkit] Migration complete. index.json renamed to index.json.bak`)
    } catch (err) {
      console.error('[Pokkit] Migration error:', err)
    }
  }
}
