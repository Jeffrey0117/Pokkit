// 期限欄位:給了不認得的值要明確拒絕,不能默默當成「永久」。
//
// 2026-11-11 稽核實案:上傳時帶 expiresIn=5m,伺服器回 200、檔案沒有期限 ——
// 呼叫端以為設了五分鐘,其實連結永久有效。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

process.env.POKKIT_LOG = 'silent'
const { createServer } = await import('../src/server.ts')
const { GB } = await import('../src/config.ts')
const { invalidExpiry, uploadFieldProblem, EXPIRY_OPTIONS } = await import('../src/upload-finalize.ts')

const API_KEY = 'test-admin-key'
const ADMIN = { authorization: `Bearer ${API_KEY}` }
const HOUR = 60 * 60 * 1000
let app
let dataDir

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-expiry-'))
  app = await createServer({
    port: 0,
    host: '127.0.0.1',
    dataDir,
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
  if (dataDir) try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) } catch { /* Windows can still be holding the database file; a leftover temp folder must not fail the run */ }
})

function upload({ expiresIn, headers = ADMIN, name = 'a.bin' } = {}) {
  const b = '----expiry' + Math.random().toString(16).slice(2)
  const field = expiresIn === undefined ? '' : `--${b}\r\nContent-Disposition: form-data; name="expiresIn"\r\n\r\n${expiresIn}\r\n`
  const head = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`
  return app.inject({
    method: 'POST',
    url: '/upload',
    payload: Buffer.concat([Buffer.from(field + head), Buffer.from(String(Math.random())), Buffer.from(`\r\n--${b}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${b}`, ...headers },
  })
}

test('invalidExpiry accepts the listed options and "not given", refuses everything else', () => {
  for (const ok of EXPIRY_OPTIONS) assert.equal(invalidExpiry(ok), false, ok)
  for (const absent of [undefined, null, '']) assert.equal(invalidExpiry(absent), false, String(absent))
  for (const bad of ['5m', '2d', '1H', ' 1h', '0', 'never', 3600, true, {}]) assert.equal(invalidExpiry(bad), true, JSON.stringify(bad))
})

test('uploadFieldProblem names the first field that was given but cannot be used', () => {
  assert.equal(uploadFieldProblem({ password: 'pw', expiresIn: '7d' }), null)
  assert.equal(uploadFieldProblem({}), null)
  assert.equal(uploadFieldProblem(undefined), null)
  assert.equal(uploadFieldProblem({ password: '', expiresIn: '' }), null)
  assert.equal(uploadFieldProblem({ expiresIn: '5m' }).code, 'bad_expiry')
  for (const bad of [123456, true, { a: 1 }, ['pw']]) {
    assert.equal(uploadFieldProblem({ password: bad }).code, 'bad_password', JSON.stringify(bad))
  }
})

test('an unknown expiry is refused and says what is allowed', async () => {
  for (const bad of ['5m', '2d', 'never', '3600']) {
    const res = await upload({ expiresIn: bad })
    assert.equal(res.statusCode, 400, `${bad} → ${res.body.slice(0, 120)}`)
    const body = res.json()
    assert.equal(body.code, 'bad_expiry')
    assert.deepEqual(body.allowed, EXPIRY_OPTIONS)
    assert.match(body.error, /1h/)
  }
})

test('nothing is stored when the expiry is refused', async () => {
  await upload({ expiresIn: '5m', name: 'should-not-exist.bin' })
  const list = await app.inject({ method: 'GET', url: '/files?limit=200', headers: { ...ADMIN, accept: 'application/json' } })
  const data = list.json()
  const names = (Array.isArray(data) ? data : data.files || data.items || []).map((entry) => entry.filename)
  assert.ok(!names.includes('should-not-exist.bin'))
})

test('every listed option still works and sets the right lifetime', async () => {
  const lifetimes = { '1h': HOUR, '3h': 3 * HOUR, '6h': 6 * HOUR, '12h': 12 * HOUR, '1d': 24 * HOUR, '7d': 168 * HOUR, '30d': 720 * HOUR }
  for (const [option, ms] of Object.entries(lifetimes)) {
    const res = await upload({ expiresIn: option })
    assert.equal(res.statusCode, 200, option)
    const off = Math.abs(res.json().expires_at - Date.now() - ms)
    assert.ok(off < 60_000, `${option} is off by ${off}ms`)
  }
})

test('"forever", an empty value and no value all mean no expiry', async () => {
  for (const expiresIn of ['forever', '', undefined]) {
    const res = await upload({ expiresIn })
    assert.equal(res.statusCode, 200, String(expiresIn))
    assert.ok(!res.json().expires_at, `${String(expiresIn)} got an expiry`)
  }
})

test('a guest with an unknown expiry is refused without using up the allowance', async () => {
  const guest = { 'cf-connecting-ip': '198.51.100.77' }
  assert.equal((await upload({ expiresIn: '5m', headers: guest })).statusCode, 400)
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await upload({ expiresIn: '30d', headers: guest })).statusCode, 200, `upload ${i + 1}`)
  }
})

test('a chunked upload refuses an unknown expiry before any bytes are sent', async () => {
  const init = (meta) => app.inject({
    method: 'POST',
    url: '/api/upload/chunked/init',
    headers: { ...ADMIN, 'content-type': 'application/json' },
    payload: JSON.stringify({ filename: 'big.bin', size: 80 * 1024 * 1024, mime: 'application/octet-stream', meta }),
  })
  const bad = await init({ expiresIn: '5m' })
  assert.equal(bad.statusCode, 400, bad.body.slice(0, 160))
  assert.match(bad.body, /bad_expiry/)
  assert.equal((await init({ expiresIn: '7d' })).statusCode, 200)
  assert.equal((await init({})).statusCode, 200)
})
