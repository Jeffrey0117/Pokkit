// 分享頁:不露檔名、沒有廣告、下載要登入;連結網域跟著使用者打開的網域走。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

process.env.POKKIT_LOG = 'silent'
const { createServer } = await import('../src/server.ts')
const { GB } = await import('../src/config.ts')
const { publicBaseUrl } = await import('../src/public-url.ts')

const SECRET_NAME = 'my-secret-holiday-clip'
let app

before(async () => {
  app = await createServer({
    port: 0,
    host: '127.0.0.1',
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pk-share-')),
    apiKey: 'k',
    maxFileSize: 500 * 1024 * 1024,
    publicUrl: 'https://main.example',
    publicHosts: ['main.example', 'second.example'],
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

async function upload(filename, mime, headers = {}) {
  const b = '----share' + Math.random().toString(16).slice(2)
  const head = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
  const res = await app.inject({
    method: 'POST',
    url: '/upload',
    payload: Buffer.concat([Buffer.from(head), Buffer.from(String(Math.random())), Buffer.from(`\r\n--${b}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${b}`, 'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 250)}`, ...headers },
  })
  return res.json()
}

const page = async (id) =>
  (await app.inject({ method: 'GET', url: `/f/${id}`, headers: { accept: 'text/html' } })).body

test('the share page never shows the file name', async () => {
  for (const [name, mime] of [[`${SECRET_NAME}.mp4`, 'video/mp4'], [`${SECRET_NAME}.zip`, 'application/zip'], [`${SECRET_NAME}.png`, 'image/png']]) {
    const { id } = await upload(name, mime)
    assert.ok(!(await page(id)).includes(SECRET_NAME), `${mime} leaked the name`)
  }
})

test('the video still plays from a nameless address', async () => {
  const { id } = await upload(`${SECRET_NAME}.mp4`, 'video/mp4')
  const html = await page(id)
  assert.match(html, new RegExp(`<video src="/files/${id}/preview"`))
  const res = await app.inject({ method: 'GET', url: `/files/${id}/preview` })
  assert.equal(res.statusCode, 200)
})

test('the share page has no ads', async () => {
  const { id } = await upload('a.mp4', 'video/mp4')
  const html = await page(id)
  assert.doesNotMatch(html, /adman|ad-space|data-adman/i)
})

test('the download button is a login gate, with no direct file link', async () => {
  const { id } = await upload('a.mp4', 'video/mp4')
  const html = await page(id)
  assert.match(html, /id="downloadBtn"/)
  assert.doesNotMatch(html, /href="[^"]*\?dl=1"/)
  assert.match(html, /letmeuse\.js/)
})

test('the download button starts locked and explains itself before any login window', async () => {
  const { id } = await upload('a.mp4', 'video/mp4')
  const html = await page(id)
  assert.match(html, /id="downloadBtn" class="[^"]*is-locked/)
  assert.match(html, /class="lock-icon"/)
  assert.match(html, /要登入才能下載喔/)
  assert.match(html, /id="gateRegister"/)
  assert.match(html, /id="gateLogin"/)
})

test('the share page speaks Chinese to Chinese browsers', async () => {
  const { id } = await upload('a.mp4', 'video/mp4')
  const html = await page(id)
  assert.match(html, /下載/)
})

test('API clients can still fetch the raw file', async () => {
  const { id } = await upload('a.zip', 'application/zip')
  const res = await app.inject({ method: 'GET', url: `/f/${id}?dl=1`, headers: { accept: '*/*' } })
  assert.equal(res.statusCode, 200)
})

test('share links follow the domain the uploader opened', async () => {
  const main = await upload('a.zip', 'application/zip', { host: 'main.example' })
  const second = await upload('b.zip', 'application/zip', { host: 'second.example', 'x-forwarded-proto': 'https' })
  assert.match(main.url, /^https:\/\/main\.example\/f\//)
  assert.match(second.url, /^https:\/\/second\.example\/f\//)
})

test('an unknown host cannot inject itself into links', async () => {
  const evil = await upload('c.zip', 'application/zip', { host: 'evil.example' })
  assert.match(evil.url, /^https:\/\/main\.example\/f\//)
})

test('publicBaseUrl prefers the forwarded host and always uses https for public hosts', () => {
  const config = { publicUrl: 'https://main.example', publicHosts: ['second.example'], port: 1 }
  const req = (headers) => ({ headers, hostname: 'x' })
  assert.equal(publicBaseUrl(req({ 'x-forwarded-host': 'second.example', host: 'localhost' }), config), 'https://second.example')
  assert.equal(publicBaseUrl(req({ host: 'SECOND.example' }), config), 'https://second.example')
  assert.equal(publicBaseUrl(req({ host: 'second.example.evil.test' }), config), 'https://main.example')
})

test('with no configured public url it falls back to the request host', () => {
  const config = { publicUrl: '', publicHosts: [], port: 1 }
  assert.equal(publicBaseUrl({ headers: { host: 'localhost:9' }, hostname: 'x' }, config), 'http://localhost:9')
})
