// Core storage-engine tests (CommonJS core loaded via createRequire).
// Locks in the security + data-safety fixes: path-traversal, atomic writes,
// tenant isolation, expired sweep, dedup.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const PokkitStore = require('../core/store.js')

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-test-'))
  return { store: new PokkitStore({ dataDir: dir }), dir }
}

test('S1: caller filename is stripped to a basename (no traversal in stored_name)', () => {
  const { store } = tmpStore()
  const sn = store._resolveStoredName('default', 'abc', '../../../../public/app.js')
  assert.ok(!sn.includes('..'), 'no .. in stored name')
  assert.ok(sn.endsWith('app.js'), 'keeps the basename')
})

test('S1: _resolveFilePath rejects a stored_name that escapes the bucket', () => {
  const { store } = tmpStore()
  assert.throws(() => store._resolveFilePath('default', '../../escape.txt'))
  assert.throws(() => store._resolveFilePath('default', '../escape.txt'))
})

test('S1: a legitimate uuid-dir path resolves inside the bucket', () => {
  const { store, dir } = tmpStore()
  const p = store._resolveFilePath('default', 'abc123/_raw.webp')
  assert.ok(p.startsWith(path.join(dir, 'default') + path.sep))
})

test('S1: save() with a traversal filename writes inside the data dir only', () => {
  const { store, dir } = tmpStore()
  const entry = store.save('../../../evil.txt', 'text/plain', Buffer.from('x'), {})
  const onDisk = store._resolveFilePath(entry.bucket, entry.stored_name)
  assert.ok(onDisk.startsWith(dir), 'stays under data dir')
  assert.ok(fs.existsSync(onDisk), 'file was written')
  assert.ok(!fs.existsSync(path.resolve(dir, '..', 'evil.txt')), 'nothing escaped one level up')
  assert.ok(!fs.existsSync(path.resolve(dir, '..', '..', 'evil.txt')), 'nothing escaped two levels up')
})

test('St3: atomic write leaves no .tmp sibling and content is intact', () => {
  const { store } = tmpStore()
  const entry = store.save('a.txt', 'text/plain', Buffer.from('hello'), {})
  const p = store._resolveFilePath(entry.bucket, entry.stored_name)
  assert.equal(fs.readFileSync(p, 'utf8'), 'hello')
  const siblings = fs.readdirSync(path.dirname(p))
  assert.ok(!siblings.some((f) => f.includes('.tmp-')), 'no leftover temp file')
})

test('St5: sweepExpired removes only files past their expiry', () => {
  const { store } = tmpStore()
  const past = store.save('old.txt', 'text/plain', Buffer.from('x'), { expires_at: Date.now() - 1000 })
  const future = store.save('new.txt', 'text/plain', Buffer.from('y'), { expires_at: Date.now() + 3_600_000 })
  const removed = store.sweepExpired()
  assert.equal(removed, 1)
  assert.equal(store.find(past.id), null, 'expired gone')
  assert.ok(store.find(future.id), 'future kept')
  const onDisk = store._resolveFilePath('default', `${past.id}/old.txt`)
  assert.ok(!fs.existsSync(onDisk), 'expired file removed from disk too')
})

test('S2: albums are scoped per tenant; admin sees all; legacy is owner-only', () => {
  const { store } = tmpStore()
  store.createAlbum('A-album', 'tenantA')
  store.createAlbum('B-album', 'tenantB')
  store.createAlbum('legacy', null)
  assert.deepEqual(store.listAlbums({ userId: 'tenantA' }).map((x) => x.name).sort(), ['A-album'])
  assert.deepEqual(store.listAlbums({ userId: 'tenantB' }).map((x) => x.name).sort(), ['B-album'])
  assert.equal(store.listAlbums({}).length, 3, 'admin (no scope) sees all')
})

test('S2: bulkMoveToAlbum only moves photos the caller owns', () => {
  const { store } = tmpStore()
  const album = store.createAlbum('A', 'tenantA')
  const fileB = store.save('b.txt', 'text/plain', Buffer.from('x'), { user_id: 'tenantB' })
  assert.equal(store.bulkMoveToAlbum([fileB.id], album.id, { userId: 'tenantA' }).changes, 0, 'blocked cross-tenant')
  assert.equal(store.bulkMoveToAlbum([fileB.id], album.id, { userId: 'tenantB' }).changes, 1, 'owner allowed')
  assert.equal(store.bulkMoveToAlbum([fileB.id], album.id, {}).changes, 1, 'admin (no scope) allowed')
})

test('dedup: identical content is stored once (same id returned)', () => {
  const { store } = tmpStore()
  const a = store.save('a.txt', 'text/plain', Buffer.from('same-bytes'), {})
  const b = store.save('b.txt', 'text/plain', Buffer.from('same-bytes'), {})
  assert.equal(a.id, b.id, 'second identical upload dedupes to the first')
})

test('dedup is skipped when a password or expiry is set', () => {
  const { store } = tmpStore()
  const a = store.save('a.txt', 'text/plain', Buffer.from('dup'), {})
  const b = store.save('b.txt', 'text/plain', Buffer.from('dup'), { expires_at: Date.now() + 1000 })
  assert.notEqual(a.id, b.id, 'expiring copy stays independent')
})

// ── getOriginalPath (plottr 匯入拿原檔) ──
test('O1: getOriginalPath finds <id>/_raw.<ext> next to the transcoded video.mp4', () => {
  const { store, dir } = tmpStore()
  const entry = store.saveRawPhoto('clip.mov', 'video/quicktime', Buffer.from('fake-mov-bytes'), {
    media_type: 'video', user_id: 'usr_a',
  })
  const rawPath = store.getOriginalPath(entry.id)
  assert.ok(rawPath, 'raw path resolved')
  assert.ok(rawPath.endsWith(path.join(entry.id, '_raw.mov')), rawPath)
  assert.ok(rawPath.startsWith(dir), 'stays inside data dir')
  assert.equal(fs.readFileSync(rawPath, 'utf8'), 'fake-mov-bytes')
})

test('O2: getOriginalPath returns null when the raw file is gone or the entry is flat/unknown', () => {
  const { store } = tmpStore()
  const entry = store.saveRawPhoto('clip.mp4', 'video/mp4', Buffer.from('x'), { media_type: 'video', user_id: 'usr_a' })
  fs.unlinkSync(store.getOriginalPath(entry.id))
  assert.equal(store.getOriginalPath(entry.id), null)
  assert.equal(store.getOriginalPath('nope-such-id'), null)
  const flat = store.save('note.txt', 'text/plain', Buffer.from('hi'), { user_id: 'usr_a' })
  assert.equal(store.getOriginalPath(flat.id), null)
})

test('D1: keep_duplicate metadata → 感知去重不把它丟垃圾桶; 沒標的同圖照樣進垃圾桶', () => {
  const { store } = tmpStore()
  const mk = (name, metadata) => {
    const e = store.saveRawPhoto(name, 'video/mp4', Buffer.from(name), { user_id: 'u1', media_type: 'video', metadata })
    store._db.prepare("UPDATE files SET width = 1080, height = 1920, duration = 5, status = 'ready' WHERE id = ?").run(e.id)
    return e.id
  }
  const orig = mk('orig.mp4')
  const kept = mk('orig・完成.mp4', { keep_duplicate: true })
  const plain = mk('orig-again.mp4')
  const bits = '0101'.repeat(16)
  assert.deepEqual(store.setDhashAndAutoDedup(orig, bits), { duplicate: false })
  const r2 = store.setDhashAndAutoDedup(kept, bits)
  assert.equal(r2.duplicate, false, '標了 keep_duplicate 不算重複')
  assert.equal(store.findAny(kept).deleted_at ?? null, null, '不可進垃圾桶')
  assert.equal(store.findAny(kept).metadata.keep_duplicate, true, 'metadata 要落庫')
  const r3 = store.setDhashAndAutoDedup(plain, bits)
  assert.equal(r3.duplicate, true, '沒標的同圖照樣去重')
  assert.ok(store.findAny(plain).deleted_at, '進垃圾桶')
})
