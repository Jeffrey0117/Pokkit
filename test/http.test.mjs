// HTTP integration tests via Fastify app.inject() (no real port needed).
// Exercises the request-path security fixes end to end.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

// Quiet Fastify's request logger for readable test output (set before import).
process.env.POKKIT_LOG = 'silent'
const { createServer } = await import('../src/server.ts')

const API_KEY = 'test-admin-key'
let app
let dataDir

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-http-'))
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
  })
  await app.ready()
})

after(async () => {
  if (app) await app.close()
})

// Build a multipart/form-data body for inject().
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

async function upload(fields, headers = {}) {
  const mp = multipart(fields)
  return app.inject({
    method: 'POST',
    url: '/upload',
    headers: { authorization: `Bearer ${API_KEY}`, 'content-type': mp.contentType, ...headers },
    payload: mp.body,
  })
}

test('S1: traversal filename upload does not escape the data dir', async () => {
  const res = await upload([{ name: 'file', filename: '../../../escaped.txt', contentType: 'text/plain', value: 'x' }])
  assert.equal(res.statusCode, 200)
  assert.ok(!fs.existsSync(path.resolve(dataDir, '..', 'escaped.txt')), 'nothing written outside data dir')
})

test('S3: uploaded HTML is served as attachment + nosniff (no inline XSS)', async () => {
  const up = await upload([{ name: 'file', filename: 'x.html', contentType: 'text/html', value: '<script>alert(1)</script>' }])
  const id = up.json().id
  const res = await app.inject({ method: 'GET', url: `/f/${id}?raw=1` })
  assert.match(res.headers['content-disposition'] || '', /attachment/)
  assert.equal(res.headers['x-content-type-options'], 'nosniff')
})

test('P1: served files carry an immutable cache header + ETag, and 304 on match', async () => {
  const up = await upload([{ name: 'file', filename: 'a.txt', contentType: 'text/plain', value: 'cacheme' }])
  const id = up.json().id
  const res = await app.inject({ method: 'GET', url: `/f/${id}?raw=1` })
  assert.match(res.headers['cache-control'] || '', /immutable/)
  const etag = res.headers['etag']
  assert.ok(etag, 'has ETag')
  const res304 = await app.inject({ method: 'GET', url: `/f/${id}?raw=1`, headers: { 'if-none-match': etag } })
  assert.equal(res304.statusCode, 304)
})

test('/api/me: 401 without/with-bad token, real identity with the key', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/api/me' })).statusCode, 401)
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: 'Bearer nope' } })).statusCode,
    401,
  )
  const ok = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${API_KEY}` } })
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.json().isAdmin, true)
})

test('S6: password-verify is rate limited (11th attempt → 429)', async () => {
  const up = await upload([
    { name: 'file', filename: 'secret.txt', contentType: 'text/plain', value: 'hush' },
    { name: 'password', value: 'pw' },
  ])
  const id = up.json().id
  let sawRateLimit = false
  for (let i = 0; i < 12; i++) {
    const res = await app.inject({
      method: 'POST',
      url: `/f/${id}/verify`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `password=wrong${i}`,
    })
    if (res.statusCode === 429) sawRateLimit = true
  }
  assert.ok(sawRateLimit, 'rate limit kicked in')
})

test('health endpoint is public and returns 200', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/health' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().ok, true)
})
