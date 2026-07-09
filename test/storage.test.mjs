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
