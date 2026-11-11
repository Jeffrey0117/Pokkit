// 照片與影片也要吃到密碼和期限。
//
// 2026-11-11 實案:登入的使用者上傳圖片或影片時,密碼和期限被整個丟掉 ——
// 照片/影片走的是相片庫那條入庫路徑,那條路沒把這兩個欄位帶進去。上傳頁照樣
// 顯示密碼欄與期限選單,使用者以為鎖上了,其實分享頁、原圖網址誰都能開,而且永久有效。
//
// 修法:帶了密碼或期限 = 這是一個「分享連結」,不是相片庫裡的一張照片,
// 走一般檔案那條路(訪客上傳一直是這樣)。密碼、期限、到期清除都在那條路上,
// 相片庫裡也不會出現一張會自己消失、或縮圖打不開的照片。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'

process.env.POKKIT_LOG = 'silent'
const { createServer } = await import('../src/server.ts')
const { GB } = await import('../src/config.ts')
const require = createRequire(import.meta.url)
const sharp = require('sharp')

const ADMIN = { authorization: 'Bearer k' }
const BROWSER = { accept: 'text/html' }
const HOUR = 60 * 60 * 1000
let app
let dataDir

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-media-'))
  app = await createServer({
    port: 0,
    host: '127.0.0.1',
    dataDir,
    apiKey: 'k',
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

// 每張圖都是雜訊:長得像的照片會被當成重複丟進垃圾桶
const picture = () => sharp({ create: { width: 120, height: 90, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).jpeg().toBuffer()

// `fields` go before the file part, `after` go behind it — `curl -F file=@x -F password=…`
// sends them in that second order, and so does the README's own example.
function upload(content, filename, mime, fields = {}, after = {}) {
  const b = '----media' + Math.random().toString(16).slice(2)
  const part = ([k, v]) => `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`
  const extra = Object.entries(fields).map(part).join('')
  const trailing = Object.entries(after).map(part).join('')
  const head = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
  return app.inject({
    method: 'POST',
    url: '/upload',
    payload: Buffer.concat([Buffer.from(extra + head), content, Buffer.from(`\r\n${trailing}--${b}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${b}`, ...ADMIN },
  })
}

async function waitProcessed(id) {
  for (let i = 0; i < 100; i += 1) {
    const status = (await app.inject({ method: 'GET', url: `/api/photos/${id}/status`, headers: ADMIN })).json().status
    if (status === 'done' || status === 'ready' || status === 'failed') return status
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return 'timeout'
}

const get = (url, headers = {}) => app.inject({ method: 'GET', url, headers })
const rowsOf = (data) => (Array.isArray(data) ? data : data.photos || data.files || data.items || [])
const libraryIds = async () => rowsOf((await get('/api/photos?limit=200', ADMIN)).json()).map((row) => row.id)
const fileIds = async () => rowsOf((await get('/files?limit=200', { ...ADMIN, accept: 'application/json' })).json()).map((row) => row.id)

async function unlock(id, password) {
  const res = await app.inject({
    method: 'POST',
    url: `/f/${id}/verify`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: `password=${encodeURIComponent(password)}`,
  })
  return String(res.headers['set-cookie'] || '').split(';')[0]
}

test('a photo uploaded with a password is locked everywhere it can be fetched', async () => {
  const bytes = await picture()
  const res = await upload(bytes, 'private.jpg', 'image/jpeg', { password: 'pw-photo' })
  assert.equal(res.statusCode, 200, res.body.slice(0, 200))
  const { id, url } = res.json()
  assert.equal(res.json().has_password, true, 'the response says it is protected')
  assert.match(url, new RegExp(`/f/${id}$`), 'the response carries the share link')

  const page = await get(`/f/${id}`, BROWSER)
  assert.match(page.body, /type="password"/, 'share page asks for the password')
  assert.ok(!page.body.includes(`/files/${id}/preview`), 'share page shows no preview')
  assert.equal((await get(`/photos/${id}/photo.webp`)).statusCode, 404, 'full image address')
  assert.equal((await get(`/photos/${id}/thumb.webp`)).statusCode, 404, 'thumbnail address')
  assert.notEqual((await get(`/files/${id}/preview`)).statusCode, 200, 'preview address')
  assert.equal((await get(`/f/${id}`, { accept: 'application/json' })).statusCode, 401, 'raw fetch')

  const wrong = await unlock(id, 'not-it')
  assert.notEqual((await get(`/files/${id}/preview`, { cookie: wrong })).statusCode, 200, 'wrong password')
  const cookie = await unlock(id, 'pw-photo')
  const opened = await get(`/files/${id}/preview`, { cookie })
  assert.equal(opened.statusCode, 200, 'right password opens it')
  assert.ok(opened.rawPayload.equals(bytes), 'and gives back the picture exactly as uploaded')
})

test('a protected photo is a share link: in the file list, not in the photo library', async () => {
  const res = await upload(await picture(), 'shared.jpg', 'image/jpeg', { password: 'pw-photo' })
  const { id } = res.json()
  assert.ok((await fileIds()).includes(id), 'its owner finds it among the files')
  assert.ok(!(await libraryIds()).includes(id), 'the library has no locked photo with a broken thumbnail')
})

test('a photo uploaded with an expiry gets that expiry and still previews', async () => {
  const res = await upload(await picture(), 'temporary.jpg', 'image/jpeg', { expiresIn: '1h' })
  assert.equal(res.statusCode, 200, res.body.slice(0, 200))
  const { id, expires_at: expiresAt } = res.json()
  const off = Math.abs(expiresAt - Date.now() - HOUR)
  assert.ok(off < 60_000, `expires_at is off by ${off}ms (${expiresAt})`)
  assert.match((await get(`/f/${id}`, BROWSER)).body, new RegExp(`<img src="/files/${id}/preview"`))
  assert.equal((await get(`/files/${id}/preview`)).statusCode, 200)
  assert.ok(!(await libraryIds()).includes(id), 'a photo that will delete itself stays out of the library')
})

test('"forever" is not an expiry: the photo goes to the library as usual', async () => {
  const res = await upload(await picture(), 'keep.jpg', 'image/jpeg', { expiresIn: 'forever' })
  const { id } = res.json()
  assert.match(await waitProcessed(id), /^(ready|done)$/)
  assert.ok((await libraryIds()).includes(id))
})

// ── 欄位排在檔案後面 ──

test('a password sent after the file is applied just the same', async () => {
  const res = await upload(await picture(), 'late-pw.jpg', 'image/jpeg', {}, { password: 'pw-late' })
  assert.equal(res.statusCode, 200, res.body.slice(0, 200))
  const { id } = res.json()
  assert.equal(res.json().has_password, true)
  assert.match((await get(`/f/${id}`, BROWSER)).body, /type="password"/)
  assert.equal((await get(`/photos/${id}/photo.webp`)).statusCode, 404)
  assert.notEqual((await get(`/files/${id}/preview`)).statusCode, 200)
})

test('an expiry sent after the file is applied just the same', async () => {
  const photo = await upload(await picture(), 'late-exp.jpg', 'image/jpeg', {}, { expiresIn: '7d' })
  assert.ok(Math.abs(photo.json().expires_at - Date.now() - 168 * HOUR) < 60_000, `photo: ${photo.body.slice(0, 160)}`)
  const doc = await upload(Buffer.from('doc ' + Math.random()), 'late-exp.txt', 'text/plain', {}, { expiresIn: '1h' })
  assert.ok(Math.abs(doc.json().expires_at - Date.now() - HOUR) < 60_000, `document: ${doc.body.slice(0, 160)}`)
})

test('an unknown expiry sent after the file is refused, and nothing is kept', async () => {
  const res = await upload(await picture(), 'late-bad.jpg', 'image/jpeg', {}, { expiresIn: '5m' })
  assert.equal(res.statusCode, 400, res.body.slice(0, 200))
  assert.equal(res.json().code, 'bad_expiry')
  const names = rowsOf((await get('/files?limit=200', { ...ADMIN, accept: 'application/json' })).json()).map((row) => row.filename)
  const library = rowsOf((await get('/api/photos?limit=200', ADMIN)).json()).map((row) => row.filename)
  assert.ok(!names.includes('late-bad.jpg') && !library.includes('late-bad.jpg'))
})

// ── 分塊上傳:密碼只跟著最後的 complete 請求來 ──

const CHUNKED = '/api/upload/chunked'
async function chunked(bytes, filename, mime, { meta, completeBody } = {}) {
  const json = { ...ADMIN, 'content-type': 'application/json' }
  const init = await app.inject({ method: 'POST', url: `${CHUNKED}/init`, headers: json, payload: JSON.stringify({ filename, size: bytes.length, mime, meta }) })
  if (init.statusCode !== 200) return init
  const { uploadId } = init.json()
  await app.inject({ method: 'PUT', url: `${CHUNKED}/${uploadId}/0`, headers: { ...ADMIN, 'content-type': 'application/octet-stream' }, payload: bytes })
  return app.inject({ method: 'POST', url: `${CHUNKED}/${uploadId}/complete`, headers: json, payload: JSON.stringify(completeBody ?? {}) })
}

test('a chunked photo whose password arrives only with the last request is locked', async () => {
  const bytes = await picture()
  const res = await chunked(bytes, 'big-private.jpg', 'image/jpeg', { completeBody: { password: 'pw-chunk' } })
  assert.equal(res.statusCode, 200, res.body.slice(0, 200))
  const { id } = res.json()
  assert.equal(res.json().has_password, true)
  assert.equal((await get(`/photos/${id}/photo.webp`)).statusCode, 404)
  assert.notEqual((await get(`/files/${id}/preview`)).statusCode, 200)
  const opened = await get(`/files/${id}/preview`, { cookie: await unlock(id, 'pw-chunk') })
  assert.equal(opened.statusCode, 200)
  assert.ok(opened.rawPayload.equals(bytes), 'the stored file is the upload, byte for byte')
})

test('a chunked video with an expiry keeps it and comes back byte for byte', async () => {
  const bytes = Buffer.from('stand-in video ' + Math.random())
  const res = await chunked(bytes, 'clip.mp4', 'video/mp4', { meta: { expiresIn: '1d' } })
  assert.equal(res.statusCode, 200, res.body.slice(0, 200))
  const body = res.json()
  assert.ok(Math.abs(body.expires_at - Date.now() - 24 * HOUR) < 60_000, `expires_at ${body.expires_at}`)
  const back = await get(`/files/${body.id}/preview`)
  assert.equal(back.statusCode, 200)
  assert.ok(back.rawPayload.equals(bytes))
})

test('a chunked upload refuses an unknown expiry that arrives with the last request', async () => {
  const res = await chunked(Buffer.from('x ' + Math.random()), 'late.bin', 'application/octet-stream', { completeBody: { expiresIn: '5m' } })
  assert.equal(res.statusCode, 400, res.body.slice(0, 200))
  assert.equal(res.json().code, 'bad_expiry')
})

test('a password that is not text is refused instead of being dropped', async () => {
  const res = await chunked(await picture(), 'num-pw.jpg', 'image/jpeg', { completeBody: { password: 123456 } })
  assert.equal(res.statusCode, 400, res.body.slice(0, 200))
  assert.equal(res.json().code, 'bad_password')
  assert.ok(!rowsOf((await get('/api/photos?limit=200', ADMIN)).json()).some((row) => row.filename === 'num-pw.jpg'), 'not stored unprotected')
})

test('two files in one form: the first is stored, the second is not read', async () => {
  const b = '----two' + Math.random().toString(16).slice(2)
  const filePart = (name, content) => `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n`
  const res = await app.inject({
    method: 'POST',
    url: '/upload',
    payload: filePart('one.txt', 'first ' + Math.random()) + filePart('two.txt', 'second') + `--${b}--\r\n`,
    headers: { 'content-type': `multipart/form-data; boundary=${b}`, ...ADMIN },
  })
  assert.equal(res.statusCode, 200, res.body.slice(0, 200))
  assert.equal(res.json().filename, 'one.txt')
  const names = rowsOf((await get('/files?limit=200', { ...ADMIN, accept: 'application/json' })).json()).map((row) => row.filename)
  assert.ok(!names.includes('two.txt'))
})

// ── 相簿 ──

test('a chunked photo with an album and an expiry is refused before any bytes are sent', async () => {
  const album = (await app.inject({ method: 'POST', url: '/api/albums', headers: { ...ADMIN, 'content-type': 'application/json' }, payload: JSON.stringify({ name: 'Early' }) })).json()
  const albumId = album.id || album.album?.id
  const init = (body) => app.inject({ method: 'POST', url: `${CHUNKED}/init`, headers: { ...ADMIN, 'content-type': 'application/json' }, payload: JSON.stringify(body) })
  const refused = await init({ filename: 'big.mp4', size: 90 * 1024 * 1024, mime: 'video/mp4', meta: { album_id: albumId, expiresIn: '7d' } })
  assert.equal(refused.statusCode, 400, refused.body.slice(0, 200))
  assert.match(refused.body, /album_share_conflict/)
  assert.equal((await init({ filename: 'big.mp4', size: 90 * 1024 * 1024, mime: 'video/mp4', meta: { album_id: albumId } })).statusCode, 200)
  assert.equal((await init({ filename: 'big.zip', size: 90 * 1024 * 1024, mime: 'application/zip', meta: { album_id: albumId, expiresIn: '7d' } })).statusCode, 200, 'documents were never album items; unchanged')
})

test('a protected photo aimed at an album is refused with a reason instead of vanishing', async () => {
  const album = (await app.inject({ method: 'POST', url: '/api/albums', headers: { ...ADMIN, 'content-type': 'application/json' }, payload: JSON.stringify({ name: 'Trip' }) })).json()
  const albumId = album.id || album.album?.id
  const refused = await upload(await picture(), 'in-album.jpg', 'image/jpeg', { album_id: albumId, password: 'pw' })
  assert.equal(refused.statusCode, 400, refused.body.slice(0, 200))
  assert.equal(refused.json().code, 'album_share_conflict')

  const fine = await upload(await picture(), 'in-album-open.jpg', 'image/jpeg', { album_id: albumId })
  assert.equal(fine.statusCode, 200)
  await waitProcessed(fine.json().id)
  const inside = rowsOf((await get(`/api/albums/${albumId}`, ADMIN)).json()).map((row) => row.id)
  assert.ok(inside.includes(fine.json().id), 'an ordinary photo still lands in the album')
})

test('a photo uploaded with neither stays an ordinary library photo', async () => {
  const res = await upload(await picture(), 'open.jpg', 'image/jpeg')
  const { id } = res.json()
  assert.notEqual(await waitProcessed(id), 'failed')
  assert.ok(!res.json().has_password)
  assert.ok(!res.json().expires_at)
  assert.ok((await libraryIds()).includes(id))
  assert.equal((await get(`/photos/${id}/photo.webp`)).statusCode, 200)
  assert.equal((await get(`/photos/${id}/thumb.webp`)).statusCode, 200)
})

test('a video uploaded with a password and an expiry gets both', async () => {
  const bytes = Buffer.from('stand-in video bytes ' + Math.random())
  const res = await upload(bytes, 'private.mp4', 'video/mp4', { password: 'pw-video', expiresIn: '1d' })
  assert.equal(res.statusCode, 200, res.body.slice(0, 200))
  const body = res.json()
  assert.equal(body.has_password, true)
  assert.ok(Math.abs(body.expires_at - Date.now() - 24 * HOUR) < 60_000, `expires_at ${body.expires_at}`)
  assert.match((await get(`/f/${body.id}`, BROWSER)).body, /type="password"/)
  assert.equal((await get(`/photos/${body.id}/video.mp4`)).statusCode, 404)
  assert.notEqual((await get(`/files/${body.id}/preview`)).statusCode, 200)
  const cookie = await unlock(body.id, 'pw-video')
  const opened = await get(`/files/${body.id}/preview`, { cookie })
  assert.equal(opened.statusCode, 200)
  assert.ok(opened.rawPayload.equals(bytes))
})

test('the same picture uploaded open and then locked stays two separate things', async () => {
  const bytes = await picture()
  const open = (await upload(bytes, 'same.jpg', 'image/jpeg')).json()
  await waitProcessed(open.id)
  const locked = (await upload(bytes, 'same.jpg', 'image/jpeg', { password: 'pw' })).json()
  assert.notEqual(locked.id, open.id, 'the locked copy must not reuse the open one')
  assert.equal(locked.has_password, true)
  assert.notEqual((await get(`/files/${locked.id}/preview`)).statusCode, 200)
  assert.equal((await get(`/photos/${open.id}/photo.webp`)).statusCode, 200, 'the open one is untouched')
})

test('the same picture uploaded locked and then open still reaches the library', async () => {
  const bytes = await picture()
  const locked = (await upload(bytes, 'again.jpg', 'image/jpeg', { password: 'pw' })).json()
  const open = (await upload(bytes, 'again.jpg', 'image/jpeg')).json()
  assert.notEqual(open.id, locked.id, 'the open upload must not be answered with the locked share')
  assert.ok(!open.deduplicated)
  assert.notEqual(await waitProcessed(open.id), 'failed')
  assert.ok((await libraryIds()).includes(open.id))
  assert.equal((await get(`/photos/${open.id}/photo.webp`)).statusCode, 200)
})
