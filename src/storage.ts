import { mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import type { Readable } from 'node:stream'

export interface FileEntry {
  id: string
  filename: string
  mime: string
  size: number
  uploadedAt: number
}

export interface StorageStats {
  totalFiles: number
  totalBytes: number
  dataDir: string
}

interface Index {
  files: FileEntry[]
}

export class Storage {
  private indexPath: string
  private index: Index = { files: [] }

  constructor(private dataDir: string) {
    this.indexPath = join(dataDir, 'index.json')
  }

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
    if (existsSync(this.indexPath)) {
      const raw = await readFile(this.indexPath, 'utf-8')
      this.index = JSON.parse(raw)
    } else {
      await this.persist()
    }
  }

  async save(filename: string, mime: string, buffer: Buffer): Promise<FileEntry> {
    const id = randomUUID()
    const dir = join(this.dataDir, id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, filename), buffer)

    const entry: FileEntry = {
      id,
      filename,
      mime,
      size: buffer.length,
      uploadedAt: Date.now(),
    }
    this.index = { files: [...this.index.files, entry] }
    await this.persist()
    return entry
  }

  getStream(id: string, filename: string): Readable | null {
    const filePath = join(this.dataDir, id, filename)
    if (!existsSync(filePath)) return null
    return createReadStream(filePath)
  }

  async getSize(id: string, filename: string): Promise<number | null> {
    const filePath = join(this.dataDir, id, filename)
    try {
      const s = await stat(filePath)
      return s.size
    } catch {
      return null
    }
  }

  find(id: string): FileEntry | undefined {
    return this.index.files.find(f => f.id === id)
  }

  list(): FileEntry[] {
    return this.index.files
  }

  async remove(id: string): Promise<boolean> {
    const entry = this.find(id)
    if (!entry) return false

    const dir = join(this.dataDir, id)
    await rm(dir, { recursive: true, force: true })

    this.index = { files: this.index.files.filter(f => f.id !== id) }
    await this.persist()
    return true
  }

  stats(): StorageStats {
    return {
      totalFiles: this.index.files.length,
      totalBytes: this.index.files.reduce((sum, f) => sum + f.size, 0),
      dataDir: this.dataDir,
    }
  }

  private async persist(): Promise<void> {
    await writeFile(this.indexPath, JSON.stringify(this.index, null, 2))
  }
}
