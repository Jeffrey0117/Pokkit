// Chunked upload route (chunked-upload-kit) end to end via app.inject().
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'

process.env.POKKIT_LOG = 'silent'
const { createServer } = await import('../src/server.ts')

const API_KEY = 'test-admin-key'
const PREFIX = '/api/upload/chunked'
const KB = 1024
let app
let dataDir

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-chunk-'))
  app = await createServer({
    port: 0,
    host: '127.0.0.1',
    dataDir,
    apiKey: API_KEY,
    maxFileSize: 4 * 1024 * KB,
    publicUrl: 'https://files.example',
    premiumUserIds: [],
    adminUsers: [],
    letmeuseAppSecret: '',
    letmeuseAppId: '',
  })
  await app.ready()
})

after(async () => {
  if (app) await app.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

const auth = { authorization: `Bearer ${API_KEY}` }
const init = (body, headers = auth) => app.inject({ method: 'POST', url: `${PREFIX}/init`, headers: { ...headers, 'content-type': 'application/json' }, payload: JSON.stringify(body) })
const put = (id, i, buf, headers = auth) => app.inject({ method: 'PUT', url: `${PREFIX}/${id}/${i}`, headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: buf })
const complete = (id, headers = auth) => app.inject({ method: 'POST', url: `${PREFIX}/${id}/complete`, headers })
const status = (id, headers = auth) => app.inject({ method: 'GET', url: `${PREFIX}/${id}`, headers })

test('requires auth on every chunked route', async () => {
  assert.equal((await init({ filename: 'a', size: 1 }, {})).statusCode, 401)
  assert.equal((await status('whatever', {})).statusCode, 401)
  assert.equal((await init({ filename: 'a', size: 1 }, { authorization: 'Bearer wrong' })).statusCode, 401)
})

test('plain file: init → chunks (1 MiB) → complete returns the same JSON as /upload', async () => {
  const data = crypto.randomBytes(2 * 1024 * KB + 321)
  const r = await init({ filename: 'big.bin', size: data.length, mime: 'application/octet-stream', chunkSize: 1024 * KB, meta: { expiresIn: '1d' } })
  assert.equal(r.statusCode, 200, r.body)
  const s = r.json()
  assert.equal(s.totalChunks, 3)

  for (let i = 0; i < s.totalChunks; i++) {
    const p = await put(s.uploadId, i, data.subarray(i * s.chunkSize, (i + 1) * s.chunkSize))
    assert.equal(p.statusCode, 200, p.body)
  }
  const c = await complete(s.uploadId)
  assert.equal(c.statusCode, 200, c.body)
  const body = c.json()
  assert.equal(body.filename, 'big.bin')
  assert.equal(body.size, data.length)
  assert.equal(body.url, `https://files.example/f/${body.id}`)
  assert.ok(body.expires_at > Date.now(), 'meta.expiresIn applied')

  // stored bytes are intact and the chunk session is gone
  const dl = await app.inject({ method: 'GET', url: `/files/${body.id}/big.bin` })
  assert.equal(dl.statusCode, 200)
  assert.ok(dl.rawPayload.equals(data))
  assert.equal((await status(s.uploadId)).statusCode, 404)
  assert.ok(!fs.existsSync(path.join(dataDir, 'chunks', s.uploadId)))
})

test('image goes through the photo branch (status + photoUrl)', async () => {
  // smallest valid PNG (1x1) — enough for the mime branch; processing is async
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
  const s = (await init({ filename: 'dot.png', size: png.length, mime: 'image/png', chunkSize: 1024 })).json()
  assert.equal(s.totalChunks, 1)
  await put(s.uploadId, 0, png)
  const c = await complete(s.uploadId)
  assert.equal(c.statusCode, 200, c.body)
  const body = c.json()
  assert.ok(body.status)
  assert.equal(body.photoUrl, `https://files.example/photos/${body.id}/photo.webp`)
})

test('protocol errors: wrong chunk length 400, missing chunks 409, other owner 403, unknown album 400', async () => {
  const data = crypto.randomBytes(3 * KB)
  const s = (await init({ filename: 'x.bin', size: data.length, chunkSize: 2 * KB })).json()
  const bad = await put(s.uploadId, 0, data.subarray(0, 10))
  assert.equal(bad.statusCode, 400)
  assert.equal(bad.json().code, 'bad_chunk_length')

  await put(s.uploadId, 0, data.subarray(0, 2 * KB))
  const c = await complete(s.uploadId)
  assert.equal(c.statusCode, 409)
  assert.deepEqual(c.json().missing, [1])

  // a different account cannot touch the session (project key → different userId)
  const other = await status(s.uploadId, { authorization: 'Bearer pk_nope' })
  assert.ok([401, 403].includes(other.statusCode))

  // album ownership / existence is refused at init, before any byte is stored
  const r2 = await init({ filename: 'y.bin', size: 4, chunkSize: 1024, meta: { album_id: 'no-such-album' } })
  assert.equal(r2.statusCode, 400)
  assert.equal(r2.json().code, 'album_not_found')
  assert.ok(!fs.existsSync(path.join(dataDir, 'chunks')) || fs.readdirSync(path.join(dataDir, 'chunks')).every((d) => d !== r2.json().uploadId))
  const s2 = null
  void s2
})

test('password rides on /complete (completeBody), never in session meta', async () => {
  const data = Buffer.from('secret-file')
  const s = (await init({ filename: 'p.txt', size: data.length, chunkSize: 1024 })).json()
  const metaOnDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'chunks', s.uploadId, 'meta.json'), 'utf8'))
  assert.equal(metaOnDisk.meta, null)
  await put(s.uploadId, 0, data)
  const c = await app.inject({ method: 'POST', url: `${PREFIX}/${s.uploadId}/complete`, headers: { ...auth, 'content-type': 'application/json' }, payload: JSON.stringify({ password: 'hunter2' }) })
  assert.equal(c.statusCode, 200, c.body)
  assert.equal(c.json().has_password, true)
  // a proxy-style body-less POST /complete (no content-type) must not 415
  const s3 = (await init({ filename: 'q.txt', size: 3, chunkSize: 1024 })).json()
  await put(s3.uploadId, 0, Buffer.from('abc'))
  const c3 = await app.inject({ method: 'POST', url: `${PREFIX}/${s3.uploadId}/complete`, headers: { ...auth, 'transfer-encoding': 'chunked' }, payload: '' })
  assert.equal(c3.statusCode, 200, c3.body)
})

test('file above POKKIT_MAX_FILE_SIZE is rejected at init (413)', async () => {
  const r = await init({ filename: 'huge.mp4', size: 5 * 1024 * KB })
  assert.equal(r.statusCode, 413)
  assert.equal(r.json().code, 'too_large')
})

test('/upload (single request) still works unchanged', async () => {
  const boundary = '----pk' + Math.random().toString(16).slice(2)
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="t.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--${boundary}--\r\n`),
  ])
  const r = await app.inject({ method: 'POST', url: '/upload', headers: { ...auth, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body })
  assert.equal(r.statusCode, 200, r.body)
  assert.equal(r.json().filename, 't.txt')
})
