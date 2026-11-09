// 額度要算硬碟上真正佔的空間:展示版 + 保留的原檔。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

process.env.POKKIT_LOG = 'silent'
const require = createRequire(import.meta.url)
const PokkitStore = require('../core/index.js')
const Database = require('better-sqlite3')
const { checkQuota } = await import('../src/upload-finalize.ts')
const { GB } = await import('../src/config.ts')

const USER = 'usr_quota'
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pk-quota-'))
const newStore = (dataDir) => new PokkitStore({ dataDir })

function savePhoto(store, rawBytes, displayBytes) {
  const entry = store.saveRawPhoto('a.jpg', 'image/jpeg', Buffer.alloc(rawBytes, Math.random() * 255), {
    user_id: USER
  })
  store.finalizePhoto(entry.id, {
    webpBuffer: Buffer.alloc(displayBytes, 1),
    thumbBuffer: Buffer.alloc(10, 2),
    width: 1,
    height: 1,
    takenAt: null
  })
  return entry
}

test('a finished photo counts both the display copy and the kept original', () => {
  const store = newStore(tempDir())
  savePhoto(store, 1000, 200)
  assert.equal(store.userStats(USER).totalBytes, 1200)
  assert.equal(store.stats('default').totalBytes, 1200)
})

test('a photo still processing counts its original only once', () => {
  const store = newStore(tempDir())
  store.saveRawPhoto('a.jpg', 'image/jpeg', Buffer.alloc(1000, 7), { user_id: USER })
  assert.equal(store.userStats(USER).totalBytes, 1000)
})

test('per-media totals include originals', () => {
  const store = newStore(tempDir())
  savePhoto(store, 1000, 200)
  const row = store.userMediaCounts(USER).find((r) => r.media_type === 'photo')
  assert.equal(row.b, 1200)
})

test('existing rows are backfilled from disk when the store opens', () => {
  const dataDir = tempDir()
  const store = newStore(dataDir)
  const { id } = savePhoto(store, 1000, 200)
  store.close()

  const raw = new Database(path.join(dataDir, 'pokkit.db'))
  raw.prepare('UPDATE files SET raw_size = NULL WHERE id = ?').run(id)
  assert.equal(raw.prepare('SELECT raw_size FROM files WHERE id = ?').get(id).raw_size, null)
  raw.close()

  const reopened = newStore(dataDir)
  assert.equal(reopened.userStats(USER).totalBytes, 1200)
  reopened.close()
})

test('setRawSize keeps usage correct after an original is recompressed', () => {
  const store = newStore(tempDir())
  const { id } = savePhoto(store, 1000, 200)
  store.setRawSize(id, 300)
  assert.equal(store.userStats(USER).totalBytes, 500)
})

function quotaConfig(dataDir, overrides = {}) {
  return { dataDir, globalCapacityBytes: 500 * GB, premiumUserIds: [], minFreeDiskBytes: 1, ...overrides }
}

const fakeStorage = { stats: () => ({ totalBytes: 0 }), userStats: () => ({ totalFiles: 0, totalBytes: 0 }) }
const uploader = { userId: USER, email: 'a@b.c', isAdmin: false }

test('uploads pause with 507 when the real disk is nearly full', async () => {
  const result = await checkQuota(
    uploader,
    { ...fakeStorage },
    quotaConfig(tempDir(), { minFreeDiskBytes: Number.MAX_SAFE_INTEGER }),
    10
  )
  assert.equal(result.status, 507)
})

test('the disk fuse reserves room for the transcoded copy as well as the original', async () => {
  const dataDir = tempDir()
  const free = Number(fs.statfsSync(dataDir).bavail) * Number(fs.statfsSync(dataDir).bsize)
  const result = await checkQuota(uploader, { ...fakeStorage }, quotaConfig(dataDir), Math.ceil(free * 0.75))
  assert.equal(result.status, 507)
})

test('the admin is never stopped by the disk fuse', async () => {
  const result = await checkQuota(
    { ...uploader, isAdmin: true },
    { ...fakeStorage },
    quotaConfig(tempDir(), { minFreeDiskBytes: Number.MAX_SAFE_INTEGER }),
    10
  )
  assert.equal(result, null)
})
