// 訪客快傳:每天 10 部、最多留 24 小時、不能選永久;登入帳號完全不受影響。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

process.env.POKKIT_LOG = 'silent'
const { createServer } = await import('../src/server.ts')
const { clampGuestExpiry } = await import('../src/upload-finalize.ts')
const { GB, GUEST_DAILY_UPLOADS } = await import('../src/config.ts')
const { guestKey } = await import('../src/guest-limit.ts')

const API_KEY = 'test-admin-key'
const HOUR = 60 * 60 * 1000
let app

before(async () => {
  app = await createServer({
    port: 0,
    host: '127.0.0.1',
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pk-guest-')),
    apiKey: API_KEY,
    maxFileSize: 500 * 1024 * 1024,
    publicUrl: '',
    premiumUserIds: [],
    adminUserIds: [],
    letmeuseAppSecret: '',
    letmeuseAppId: '',
    globalCapacityBytes: 500 * GB,
  })
  await app.ready()
})

after(async () => {
  if (app) await app.close()
})

function upload({ ip, expiresIn, name = 'a.mp4', mime = 'video/mp4', size = 1024, headers = {} }) {
  const b = '----guest' + Math.random().toString(16).slice(2)
  const field = expiresIn ? `--${b}\r\nContent-Disposition: form-data; name="expiresIn"\r\n\r\n${expiresIn}\r\n` : ''
  const head = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`
  const content = Buffer.alloc(size, Math.floor(Math.random() * 255))
  return app.inject({
    method: 'POST',
    url: '/upload',
    payload: Buffer.concat([Buffer.from(field + head), content, Buffer.from(`\r\n--${b}--\r\n`)]),
    headers: {
      'content-type': `multipart/form-data; boundary=${b}`,
      ...(ip ? { 'cf-connecting-ip': ip } : {}),
      ...headers,
    },
  })
}

test('the daily limit is ten', () => {
  assert.equal(GUEST_DAILY_UPLOADS, 10)
})

test('a guest gets ten uploads, the eleventh is refused with a clear code', async () => {
  const ip = '198.51.100.1'
  for (let i = 0; i < 10; i += 1) {
    const res = await upload({ ip })
    assert.equal(res.statusCode, 200, `upload ${i + 1}`)
  }
  const blocked = await upload({ ip })
  assert.equal(blocked.statusCode, 429)
  assert.equal(blocked.json().code, 'guest_daily_limit')
})

test('one guest hitting the limit does not block another', async () => {
  assert.equal((await upload({ ip: '198.51.100.2' })).statusCode, 200)
})

test('a rejected upload does not use up an allowance', async () => {
  const ip = '198.51.100.3'
  const big = await upload({ ip, size: 65 * 1024 * 1024 })
  assert.equal(big.statusCode, 413)
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await upload({ ip })).statusCode, 200, `upload ${i + 1}`)
  }
})

test('parallel uploads cannot slip past the limit', async () => {
  const ip = '198.51.100.4'
  const results = await Promise.all(Array.from({ length: 15 }, () => upload({ ip })))
  assert.equal(results.filter((r) => r.statusCode === 200).length, 10)
})

test('a guest can pick hours and the link really expires then', async () => {
  const res = await upload({ ip: '198.51.100.5', expiresIn: '3h' })
  const left = res.json().expires_at - Date.now()
  assert.ok(left > 2.9 * HOUR && left <= 3 * HOUR + 1000, `left ${left}`)
})

test('choosing forever, 7 days or 30 days as a guest is capped at 24 hours', async () => {
  for (const expiresIn of ['forever', '7d', '30d']) {
    const res = await upload({ ip: '198.51.100.6', expiresIn })
    const left = res.json().expires_at - Date.now()
    assert.ok(left > 23.9 * HOUR && left <= 24 * HOUR + 1000, `${expiresIn} left ${left}`)
  }
})

test('no choice at all still expires within 24 hours', async () => {
  const res = await upload({ ip: '198.51.100.7' })
  assert.ok(res.json().expires_at <= Date.now() + 24 * HOUR + 1000)
})

test('clampGuestExpiry only passes guest options', () => {
  for (const v of ['1h', '3h', '6h', '12h', '1d']) assert.equal(clampGuestExpiry(v), v)
  for (const v of ['forever', '7d', '30d', undefined, 'junk']) assert.equal(clampGuestExpiry(v), '1d')
})

test('the admin account is not limited and its files never expire', async () => {
  const headers = { 'x-pokkit-key': API_KEY }
  for (let i = 0; i < 12; i += 1) {
    const res = await upload({ ip: '198.51.100.8', name: 'a.zip', mime: 'application/zip', headers })
    assert.equal(res.statusCode, 200, `upload ${i + 1}`)
    assert.equal(res.json().expires_at ?? null, null)
  }
})

test('guest key separates addresses, hides the raw IP, and groups an IPv6 /64', () => {
  const key = (ip) => guestKey({ headers: { 'cf-connecting-ip': ip }, ip: '127.0.0.1' })
  assert.notEqual(key('198.51.100.1'), key('198.51.100.2'))
  assert.ok(!key('198.51.100.1').includes('198.51'))
  assert.equal(key('2001:db8:1:2:aaaa::1'), key('2001:db8:1:2:bbbb::2'))
  assert.notEqual(key('2001:db8:1:2::1'), key('2001:db8:1:3::1'))
})

test('the public tier info describes the guest rules', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/tiers' })
  const { guest } = res.json()
  assert.equal(guest.expiryHours, 24)
  assert.equal(guest.dailyUploads, 10)
})
