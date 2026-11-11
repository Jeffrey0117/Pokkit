// 單次上傳超過大小上限:一定要明確拒絕(413),不能回「成功」卻只存下前半段。
//
// 2026-11-11 實案:訪客傳 65MB,18 次有 16 次回 200,硬碟上是剛好 64MB 的壞檔。
// 套件在串流被切斷時「通常」會丟錯,但切斷如果發生在最後一塊讀完之後就不丟了。
//
// 一定要走真的 socket。app.inject 整包一次進來,讀完與切斷之間沒有空隙,
// 所以 guest-limits.test 裡同樣的情境一直是綠的,卻沒測到這個洞。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

process.env.POKKIT_LOG = 'silent'
const { createServer } = await import('../src/server.ts')
const { GB, GUEST_MAX_FILE_BYTES } = await import('../src/config.ts')
const { readWithinLimit, readUpload } = await import('../src/upload-read.ts')

// ── 表單走完才算數:欄位排在檔案後面也要收到 ──
// (app.inject 整包一次進來,後面的欄位剛好已經解析完,所以走 HTTP 的測試測不到
//  這個洞;真實連線、2MB 以上的檔案,排在後面的密碼 6 次有 6 次不見。)

const filePart = (name, content, extra = {}) => ({
  type: 'file',
  filename: name,
  mimetype: 'application/octet-stream',
  toBuffer: async () => Buffer.from(content),
  file: { truncated: false, resumed: 0, resume() { this.resumed += 1 } },
  ...extra,
})
const field = (fieldname, value) => ({ type: 'field', fieldname, value })
async function* partsOf(list) { for (const part of list) yield part }

test('fields placed after the file are collected too', async () => {
  const read = await readUpload(partsOf([field('album_id', 'a1'), filePart('x.bin', 'data'), field('password', 'pw'), field('expiresIn', '7d')]))
  assert.deepEqual(read.fields, { album_id: 'a1', password: 'pw', expiresIn: '7d' })
  assert.deepEqual(read.file, { filename: 'x.bin', mimetype: 'application/octet-stream' })
  assert.equal(read.buffer.toString(), 'data')
  assert.equal(read.tooLarge, false)
})

test('a form with no file reports no file', async () => {
  const read = await readUpload(partsOf([field('password', 'pw')]))
  assert.equal(read.file, null)
  assert.equal(read.buffer, null)
})

test('only the first file is kept; extra files are drained, not buffered', async () => {
  const second = filePart('second.bin', 'ignored')
  const read = await readUpload(partsOf([filePart('first.bin', 'kept'), second, field('password', 'pw')]))
  assert.equal(read.file.filename, 'first.bin')
  assert.equal(read.buffer.toString(), 'kept')
  assert.equal(second.file.resumed, 1, 'the extra file was drained so later parts could arrive')
  assert.equal(read.fields.password, 'pw')
})

test('a file can be skipped on what the earlier fields already say', async () => {
  const part = filePart('big.bin', 'never read', { toBuffer: async () => { throw new Error('must not be read') } })
  const read = await readUpload(partsOf([field('expiresIn', '5m'), part]), (seen) => seen.expiresIn === '5m')
  assert.equal(read.buffer, null)
  assert.equal(read.tooLarge, false)
  assert.equal(part.file.resumed, 1)
  assert.equal(read.file.filename, 'big.bin')
})

test('a cut-off file is too large whether the library says so at once or on the next part', async () => {
  const quiet = await readUpload(partsOf([filePart('a.bin', 'half', { file: { truncated: true } }), field('password', 'pw')]))
  assert.equal(quiet.tooLarge, true)
  assert.equal(quiet.buffer, null)

  async function* throwsLater() {
    yield filePart('b.bin', 'half')
    throw Object.assign(new Error('request file too large'), { code: 'FST_REQ_FILE_TOO_LARGE' })
  }
  const late = await readUpload(throwsLater())
  assert.equal(late.tooLarge, true)
  assert.equal(late.buffer, null)
})

test('a broken form is reported as broken, not as a size problem', async () => {
  async function* broken() {
    yield field('password', 'pw')
    throw Object.assign(new Error('Part terminated early'), { code: 'FST_PART_ERROR' })
  }
  await assert.rejects(readUpload(broken()), /terminated early/)
})

test('a second file in the form does not cost the first one', async () => {
  // limits.files: 1 讓套件遇到第二個檔案就停、不去讀它;停下來時丟的是這個錯
  async function* twoFiles() {
    yield field('password', 'pw')
    yield filePart('first.bin', 'kept')
    throw Object.assign(new Error('reach files limit'), { code: 'FST_FILES_LIMIT' })
  }
  const read = await readUpload(twoFiles())
  assert.equal(read.file.filename, 'first.bin')
  assert.equal(read.buffer.toString(), 'kept')
  assert.equal(read.tooLarge, false)
  assert.equal(read.fields.password, 'pw')
})

test('a form that hits the file limit before any file was read is still an error', async () => {
  async function* noFileYet() {
    throw Object.assign(new Error('reach files limit'), { code: 'FST_FILES_LIMIT' })
  }
  await assert.rejects(readUpload(noFileYet()), /files limit/)
})

// ── 讀檔的判斷本身:兩種「太大」都要認得,這段不靠時序 ──
// 下面走 socket 的測試在同一個程序裡跑,套件幾乎每次都丟錯,測不到「靜靜切斷」那條路。

test('a part the library cut off without throwing counts as too large', async () => {
  const firstHalf = Buffer.alloc(64, 1)
  const part = { toBuffer: async () => firstHalf, file: { truncated: true } }
  assert.equal(await readWithinLimit(part), null)
})

test('a part the library refused by throwing counts as too large', async () => {
  const tooLarge = Object.assign(new Error('request file too large'), { code: 'FST_REQ_FILE_TOO_LARGE' })
  const part = { toBuffer: async () => { throw tooLarge }, file: { truncated: true } }
  assert.equal(await readWithinLimit(part), null)
})

test('a complete part comes back as it is', async () => {
  const whole = Buffer.from('all of it')
  assert.equal(await readWithinLimit({ toBuffer: async () => whole, file: { truncated: false } }), whole)
  assert.equal(await readWithinLimit({ toBuffer: async () => whole, file: {} }), whole)
})

test('any other read failure is passed on, not mistaken for a size problem', async () => {
  const broken = Object.assign(new Error('Part terminated early'), { code: 'FST_PART_ERROR' })
  await assert.rejects(readWithinLimit({ toBuffer: async () => { throw broken }, file: {} }), /terminated early/)
})

const API_KEY = 'test-admin-key'
const MB = 1024 * 1024
const SIGNED_IN_LIMIT = 2 * MB
const ADMIN = { authorization: `Bearer ${API_KEY}` }
const ATTEMPTS = 3
let app
let base
let dataDir

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-size-'))
  app = await createServer({
    port: 0,
    host: '127.0.0.1',
    dataDir,
    apiKey: API_KEY,
    maxFileSize: SIGNED_IN_LIMIT,
    publicUrl: '',
    premiumUserIds: [],
    adminUserIds: [],
    letmeuseAppSecret: '',
    letmeuseAppId: '',
    globalCapacityBytes: 500 * GB,
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  base = `http://127.0.0.1:${app.server.address().port}`
})

after(async () => {
  if (app) await app.close()
  // 這份測試會留下一個 64MB 的檔案,跑完要清掉
  if (dataDir) try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) } catch { /* Windows can still be holding the database file; a leftover temp folder must not fail the run */ }
})

test('a request that is not multipart does not use up the guest allowance', async () => {
  const from = guestFrom('203.0.113.50')
  for (let i = 0; i < 7; i += 1) {
    const res = await fetch(`${base}/upload`, { method: 'POST', headers: { ...from, 'content-type': 'text/plain' }, body: 'not a form' })
    assert.ok(res.status >= 400 && res.status < 500, `status ${res.status}`)
  }
  assert.equal((await send(1024, 'after-bad-requests.bin', from)).status, 200)
})

async function send(size, name, headers) {
  const form = new FormData()
  form.append('file', new Blob([crypto.randomBytes(size)], { type: 'application/octet-stream' }), name)
  const res = await fetch(`${base}/upload`, { method: 'POST', headers, body: form })
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

const guestFrom = (ip) => ({ 'cf-connecting-ip': ip })

async function storedNames() {
  const res = await fetch(`${base}/files?limit=200`, { headers: { ...ADMIN, accept: 'application/json' } })
  const data = await res.json()
  return (Array.isArray(data) ? data : data.files || data.items || []).map((entry) => entry.filename)
}

test('a guest file over the limit is refused, never stored cut short', async () => {
  for (let i = 0; i < ATTEMPTS; i += 1) {
    const res = await send(GUEST_MAX_FILE_BYTES + 1, 'guest-over.bin', guestFrom(`203.0.113.${10 + i}`))
    assert.equal(res.status, 413, `attempt ${i + 1}: kept ${res.body?.size} of ${GUEST_MAX_FILE_BYTES + 1} bytes`)
    assert.equal(res.body.code, 'file_too_large')
    assert.equal(res.body.maxBytes, GUEST_MAX_FILE_BYTES)
  }
  assert.ok(!(await storedNames()).includes('guest-over.bin'), 'nothing was stored')
})

test('a guest file exactly at the limit is accepted whole', async () => {
  const res = await send(GUEST_MAX_FILE_BYTES, 'guest-exact.bin', guestFrom('203.0.113.30'))
  assert.equal(res.status, 200)
  assert.equal(res.body.size, GUEST_MAX_FILE_BYTES)
})

test('a refused oversize upload does not use up the guest allowance', async () => {
  const from = guestFrom('203.0.113.40')
  assert.equal((await send(GUEST_MAX_FILE_BYTES + 1, 'guest-over-again.bin', from)).status, 413)
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await send(1024, `small-${i}.bin`, from)).status, 200, `upload ${i + 1}`)
  }
})

test('a signed-in upload over the server limit is refused too', async () => {
  for (let i = 0; i < ATTEMPTS; i += 1) {
    const res = await send(SIGNED_IN_LIMIT + 1, 'member-over.bin', ADMIN)
    assert.equal(res.status, 413, `attempt ${i + 1}: kept ${res.body?.size} of ${SIGNED_IN_LIMIT + 1} bytes`)
    assert.equal(res.body.code, 'file_too_large')
    assert.equal(res.body.maxBytes, SIGNED_IN_LIMIT)
  }
  assert.ok(!(await storedNames()).includes('member-over.bin'), 'nothing was stored')
})

test('a signed-in upload exactly at the limit is accepted whole', async () => {
  const res = await send(SIGNED_IN_LIMIT, 'member-exact.bin', ADMIN)
  assert.equal(res.status, 200)
  assert.equal(res.body.size, SIGNED_IN_LIMIT)
})
