// 下載要登入、圖片影片防盜連、大量刪除不卡住。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

process.env.POKKIT_LOG = 'silent'
const require = createRequire(import.meta.url)
const PokkitStore = require('../core/index.js')
const { createServer } = await import('../src/server.ts')
const { GB } = await import('../src/config.ts')
const { issueTicket, verifyTicket } = await import('../src/download-ticket.ts')

const API_KEY = 'admin-key'
const APP = 'pokkit-test'
const KID = 'kid-1'
const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
let app

function token(userId, email) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const data = `${b64({ alg: 'ES256', typ: 'JWT', kid: KID })}.${b64({ sub: userId, email, app: APP, exp: Math.floor(Date.now() / 1000) + 3600 })}`
  const sig = crypto.sign('sha256', Buffer.from(data), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' })
  return `${data}.${sig.toString('base64url')}`
}

const OWNER = token('usr_dl_owner', 'dl-owner@example.com')
const VIEWER = token('usr_dl_viewer', 'dl-viewer@example.com')

before(async () => {
  app = await createServer({
    port: 0, host: '127.0.0.1', dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pk-dl-')), apiKey: API_KEY,
    maxFileSize: 500 * 1024 * 1024, publicUrl: 'https://main.example', publicHosts: ['main.example', 'second.example'],
    premiumUserIds: [], adminUsers: [], letmeuseAppSecret: '', letmeuseAppId: APP, globalCapacityBytes: 500 * GB,
    getJwtKey: (kid) => (kid === KID ? keys.publicKey : null),
  })
  await app.ready()
})

after(async () => {
  if (app) await app.close()
})

function upload({ auth, ip, name = 'a.zip', mime = 'application/zip', content }) {
  const b = '----dl' + Math.random().toString(16).slice(2)
  const head = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`
  return app.inject({
    method: 'POST',
    url: '/upload',
    payload: Buffer.concat([Buffer.from(head), content ?? Buffer.from(String(Math.random())), Buffer.from(`\r\n--${b}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${b}`, ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(ip ? { 'cf-connecting-ip': ip } : {}) },
  })
}

const get = (url, headers = {}) => app.inject({ method: 'GET', url, headers: { accept: '*/*', ...headers } })

test('typing the download address without logging in does not download', async () => {
  const id = (await upload({ ip: '198.51.100.31' })).json().id
  assert.equal((await get(`/f/${id}?dl=1`)).statusCode, 401)
  assert.equal((await get(`/f/${id}?raw=1`)).statusCode, 401)
  assert.equal((await get(`/f/${id}`)).statusCode, 401)
  const browser = await get(`/f/${id}?dl=1`, { accept: 'text/html' })
  assert.equal(browser.statusCode, 302)
  assert.equal(browser.headers.location, `/f/${id}`)
})

test('a downloadable file cannot be pulled from its direct address either', async () => {
  const id = (await upload({ ip: '198.51.100.32', name: 'b.zip' })).json().id
  assert.equal((await get(`/files/${id}/b.zip`)).statusCode, 401)
})

test('a logged-in visitor gets a short ticket that downloads the file', async () => {
  const id = (await upload({ ip: '198.51.100.33' })).json().id
  const res = await app.inject({ method: 'POST', url: `/api/files/${id}/download-ticket`, payload: {}, headers: { authorization: `Bearer ${VIEWER}` } })
  assert.equal(res.statusCode, 200)
  const dl = await get(res.json().url)
  assert.equal(dl.statusCode, 200)
  assert.match(dl.headers['content-disposition'], /attachment/)
})

test('a ticket needs a login, works for one file only, and expires', async () => {
  const id = (await upload({ ip: '198.51.100.34' })).json().id
  const other = (await upload({ ip: '198.51.100.35' })).json().id
  assert.equal((await app.inject({ method: 'POST', url: `/api/files/${id}/download-ticket`, payload: {} })).statusCode, 401)
  const t = issueTicket(id)
  assert.equal(verifyTicket(id, t), true)
  assert.equal(verifyTicket(other, t), false)
  assert.equal(verifyTicket(id, issueTicket(id, 60_000, Date.now() - 120_000)), false)
  assert.equal(verifyTicket(id, 'garbage'), false)
  assert.equal((await get(`/f/${other}?dl=1&t=${encodeURIComponent(t)}`)).statusCode, 401)
})

test('API clients with a key keep working', async () => {
  const id = (await upload({ auth: OWNER })).json().id
  assert.equal((await get(`/f/${id}?dl=1`, { authorization: `Bearer ${API_KEY}` })).statusCode, 200)
  assert.equal((await get(`/f/${id}?dl=1`, { authorization: `Bearer ${OWNER}` })).statusCode, 200)
})

test('files owned by project accounts stay open for the services that use them', async () => {
  const created = (await app.inject({ method: 'POST', url: '/api/admin/accounts', payload: { name: 'svc' }, headers: { authorization: `Bearer ${API_KEY}` } })).json()
  const key = created.key
  const id = (await app.inject({
    method: 'POST',
    url: '/upload',
    payload: Buffer.concat([Buffer.from('--x\r\nContent-Disposition: form-data; name="file"; filename="s.zip"\r\nContent-Type: application/zip\r\n\r\n'), Buffer.from(String(Math.random())), Buffer.from('\r\n--x--\r\n')]),
    headers: { 'content-type': 'multipart/form-data; boundary=x', 'x-pokkit-key': key },
  })).json().id
  assert.equal((await get(`/f/${id}?dl=1`)).statusCode, 200)
  assert.equal((await get(`/files/${id}/s.zip`)).statusCode, 200)
})

test('a share page preview still plays, but not when embedded on another site', async () => {
  const id = (await upload({ ip: '198.51.100.36', name: 'v.mp4', mime: 'video/mp4' })).json().id
  assert.equal((await get(`/files/${id}/preview`)).statusCode, 200)
  assert.equal((await get(`/files/${id}/preview`, { referer: `https://main.example/f/${id}` })).statusCode, 200)
  assert.equal((await get(`/files/${id}/preview`, { referer: 'https://second.example/x' })).statusCode, 200)
  assert.equal((await get(`/files/${id}/preview`, { referer: 'https://evil.example/page' })).statusCode, 403)
  assert.equal((await get(`/files/${id}/preview`, { referer: 'https://main.example.evil.test/' })).statusCode, 403)
})

test('photo and video addresses refuse other sites and are not cached by the edge', async () => {
  const fixture = fs.readFileSync(new URL('./fixtures/one-pixel.jpg', import.meta.url))
  const id = (await upload({ auth: OWNER, name: 'p.jpg', mime: 'image/jpeg', content: fixture })).json().id
  for (let i = 0; i < 40; i += 1) {
    const s = (await app.inject({ method: 'GET', url: `/api/photos/${id}/status`, headers: { authorization: `Bearer ${OWNER}` } })).json()
    if (s.status !== 'processing') break
    await new Promise((r) => setTimeout(r, 100))
  }
  const ok = await get(`/photos/${id}/thumb.webp`)
  assert.equal(ok.statusCode, 200)
  assert.doesNotMatch(ok.headers['cache-control'], /public/)
  assert.equal((await get(`/photos/${id}/photo.webp`, { referer: 'https://evil.example/' })).statusCode, 403)
  assert.equal((await get(`/photos/${id}/thumb.webp`, { referer: 'https://main.example/' })).statusCode, 200)
})

test('the share page asks for a ticket instead of linking the file', async () => {
  const id = (await upload({ ip: '198.51.100.37' })).json().id
  const html = (await get(`/f/${id}`, { accept: 'text/html' })).body
  assert.match(html, /download-ticket/)
  assert.doesNotMatch(html, /data-dl="\/f\/[^"]*\?dl=1"/)
})

test('the library asks for a ticket instead of linking the file', () => {
  const src = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /href = '\/f\/' \+ [a-z.]+ \+ '\?dl=1'/)
  assert.match(src, /download-ticket/)
})

test('expired files are swept in bounded batches', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-sweep-'))
  const store = new PokkitStore({ dataDir: dir })
  for (let i = 0; i < 25; i += 1) store.save(`e${i}.txt`, 'text/plain', Buffer.from(`e${i}`), { user_id: 'u', expires_at: Date.now() - 1000 })
  assert.equal(store.sweepExpired(Date.now(), 10), 10)
  assert.equal(store.sweepExpired(Date.now(), 10), 10)
  assert.equal(store.sweepExpired(Date.now(), 10), 5)
  store.close()
})

test('old trash is purged in bounded batches', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-purge-'))
  const store = new PokkitStore({ dataDir: dir })
  for (let i = 0; i < 25; i += 1) store.softDelete(store.save(`t${i}.txt`, 'text/plain', Buffer.from(`t${i}`), { user_id: 'u' }).id)
  const future = Date.now() + 40 * 24 * 3600 * 1000
  assert.equal(store.purgeOldTrash(future, undefined, 10), 10)
  assert.equal(store.purgeOldTrash(future, undefined, 10), 10)
  assert.equal(store.purgeOldTrash(future, undefined, 10), 5)
  store.close()
})

test('emptying a big trash keeps the server responsive', async () => {
  const t = token('usr_bigtrash', 'big@example.com')
  const ids = []
  for (let i = 0; i < 120; i += 1) ids.push((await upload({ auth: t, name: `x${i}.zip` })).json().id)
  for (const id of ids) await app.inject({ method: 'DELETE', url: `/files/${id}`, headers: { authorization: `Bearer ${t}` } })
  let ticks = 0
  const timer = setInterval(() => { ticks += 1 }, 0)
  const res = await app.inject({ method: 'DELETE', url: '/api/trash', headers: { authorization: `Bearer ${t}` } })
  clearInterval(timer)
  assert.equal(res.json().purged, 120)
  assert.ok(ticks > 1, `event loop never yielded during the purge (ticks=${ticks})`)
})
