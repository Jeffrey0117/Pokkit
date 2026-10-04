// 容量制 + Guest 快傳 + 方案頁 API (2026-10-04 個人雲端改版) 的行為測試。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

process.env.POKKIT_LOG = 'silent'
const { createServer } = await import('../src/server.ts')
const { checkQuota, clampGuestExpiry } = await import('../src/upload-finalize.ts')
const { GB, GUEST_USER_ID } = await import('../src/config.ts')

const API_KEY = 'test-admin-key'
let app
let dataDir

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-tiers-'))
  app = await createServer({
    port: 0,
    host: '127.0.0.1',
    dataDir,
    apiKey: API_KEY,
    maxFileSize: 500 * 1024 * 1024,
    publicUrl: '',
    premiumUserIds: [],
    adminUsers: [],
    letmeuseAppSecret: '',
    letmeuseAppId: '',
    globalCapacityBytes: 500 * GB,
  })
  await app.ready()
})

after(async () => {
  if (app) await app.close()
})

function multipart(fields) {
  const boundary = '----pktest' + Math.random().toString(16).slice(2)
  const chunks = []
  for (const f of fields) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"`
    if (f.filename !== undefined) head += `; filename="${f.filename}"`
    head += '\r\n'
    if (f.contentType) head += `Content-Type: ${f.contentType}\r\n`
    head += '\r\n'
    chunks.push(Buffer.from(head), Buffer.isBuffer(f.value) ? f.value : Buffer.from(String(f.value)), Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

async function guestUpload(fields) {
  const mp = multipart(fields)
  return app.inject({
    method: 'POST',
    url: '/upload',
    headers: { 'content-type': mp.contentType }, // ← NO authorization at all
    payload: mp.body,
  })
}

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

test('guest upload (no credential) succeeds and is force-expired within 7 days', async () => {
  const res = await guestUpload([{ name: 'file', filename: 'hi.txt', contentType: 'text/plain', value: 'hello' }])
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.ok(body.expires_at, 'guest file must have an expiry')
  assert.ok(body.expires_at <= Date.now() + SEVEN_DAYS + 60_000, 'expiry is at most ~7 days out')
})

test('guest cannot opt out of expiry — forever/30d are clamped to 7d', async () => {
  const res = await guestUpload([
    { name: 'expiresIn', value: 'forever' },
    { name: 'file', filename: 'sneaky.txt', contentType: 'text/plain', value: 'x' },
  ])
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.ok(body.expires_at, 'forever must be clamped, not honored')
  assert.ok(body.expires_at <= Date.now() + SEVEN_DAYS + 60_000)
})

test('guest image upload takes the plain-file branch (no worker processing)', async () => {
  // 1x1 PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const res = await guestUpload([{ name: 'file', filename: 'p.png', contentType: 'image/png', value: png }])
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.ok(body.url, 'plain-file share url present')
  assert.equal(body.photoUrl, undefined, 'guest images must NOT enter the photo pipeline')
})

test('a PRESENT but invalid token 401s — never silently demotes to guest', async () => {
  const mp = multipart([{ name: 'file', filename: 'a.txt', contentType: 'text/plain', value: 'x' }])
  const res = await app.inject({
    method: 'POST',
    url: '/upload',
    headers: { authorization: 'Bearer not-a-real-token', 'content-type': mp.contentType },
    payload: mp.body,
  })
  assert.equal(res.statusCode, 401)
})

test('clampGuestExpiry: short options pass, long/empty clamp to 7d', () => {
  assert.equal(clampGuestExpiry('1h'), '1h')
  assert.equal(clampGuestExpiry('1d'), '1d')
  assert.equal(clampGuestExpiry('7d'), '7d')
  assert.equal(clampGuestExpiry('30d'), '7d')
  assert.equal(clampGuestExpiry('forever'), '7d')
  assert.equal(clampGuestExpiry(undefined), '7d')
})

// ── checkQuota unit tests (fake storage, no HTTP) ──
const fakeStorage = (userBytes, userFiles, totalBytes = 0) => ({
  userStats: () => ({ totalFiles: userFiles, totalBytes: userBytes }),
  stats: () => ({ totalBytes }),
})
const cfg = (globalCapacityBytes) => ({ premiumUserIds: [], globalCapacityBytes })

test('checkQuota: free user over 2GB gets 413 with bytes fields', async () => {
  const user = { userId: 'u1', email: '' } // no email → Free, no PayGate call
  const r = await checkQuota(user, fakeStorage(2 * GB - 10, 3), cfg(500 * GB), 100)
  assert.equal(r.status, 413)
  assert.equal(r.body.maxBytes, 2 * GB)
  assert.ok(String(r.body.error).includes('Upgrade'))
})

test('checkQuota: free user under 2GB passes', async () => {
  const user = { userId: 'u1', email: '' }
  const r = await checkQuota(user, fakeStorage(1 * GB, 3), cfg(500 * GB), 100)
  assert.equal(r, null)
})

test('checkQuota: global fuse 507s for non-admin, admin exempt', async () => {
  const user = { userId: 'u1', email: '' }
  const r = await checkQuota(user, fakeStorage(0, 0, 499 * GB), cfg(400 * GB), 100)
  assert.equal(r.status, 507)
  const admin = { userId: 'admin', email: 'admin', isAdmin: true }
  const r2 = await checkQuota(admin, fakeStorage(0, 0, 499 * GB), cfg(400 * GB), 100)
  assert.equal(r2, null)
})

test('checkQuota: guest per-file cap only', async () => {
  const guest = { userId: GUEST_USER_ID, email: '' }
  const over = await checkQuota(guest, fakeStorage(0, 0), cfg(500 * GB), 65 * 1024 * 1024)
  assert.equal(over.status, 413)
  const ok = await checkQuota(guest, fakeStorage(0, 0), cfg(500 * GB), 10 * 1024 * 1024)
  assert.equal(ok, null)
})

// ── pricing APIs ──
test('/api/tiers is public and mirrors STORAGE_TIERS', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/tiers' })
  assert.equal(res.statusCode, 200)
  const t = res.json()
  assert.equal(t.free.maxGB, 2)
  assert.equal(t.pro.maxGB, 100)
  assert.equal(t.pro.available, false)
  assert.ok(t.guest.maxFileBytes > 0)
})

test('/api/pro-interest stores, dedupes, and rejects junk', async () => {
  const post = (email) => app.inject({
    method: 'POST', url: '/api/pro-interest',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ email }),
  })
  assert.equal((await post('a@test.local')).statusCode, 200)
  assert.equal((await post('a@test.local')).statusCode, 200) // dupe ok, no double row
  assert.equal((await post('garbage')).statusCode, 400)

  const list = await app.inject({
    method: 'GET', url: '/api/admin/pro-interest',
    headers: { authorization: `Bearer ${API_KEY}` },
  })
  assert.equal(list.statusCode, 200)
  const data = list.json()
  assert.equal(data.rows.filter((r) => r.email === 'a@test.local').length, 1)
})

test('/api/admin/pro-interest requires admin', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/admin/pro-interest' })
  assert.equal(res.statusCode, 401)
})
