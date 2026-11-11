// 分享連結在瀏覽器裡的三種「看不到檔案」:不存在、過期、有密碼。
//
// 2026-11-11 稽核實案:
//   - 過期的連結 API 回 410,瀏覽器卻是 HTTP 200 加一句「已過期」
//   - 不存在的連結在瀏覽器直接顯示一行 JSON
//   - 影片分享頁沒有預覽圖(規格 2026-10-04 第 8 節要補),貼到聊天軟體沒有縮圖
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'

process.env.POKKIT_LOG = 'silent'
const { createServer } = await import('../src/server.ts')
const { GB } = await import('../src/config.ts')
const { sharePreviewTags } = await import('../src/share-meta.ts')
const require = createRequire(import.meta.url)

const ADMIN = { authorization: 'Bearer k' }
const BROWSER = { accept: 'text/html,application/xhtml+xml' }
let app
let dataDir

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-status-'))
  app = await createServer({
    port: 0,
    host: '127.0.0.1',
    dataDir,
    apiKey: 'k',
    maxFileSize: 500 * 1024 * 1024,
    publicUrl: 'https://main.example',
    publicHosts: ['main.example'],
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

async function upload(filename, mime, fields = {}) {
  const b = '----status' + Math.random().toString(16).slice(2)
  const extra = Object.entries(fields).map(([k, v]) => `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('')
  const head = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
  const res = await app.inject({
    method: 'POST',
    url: '/upload',
    payload: Buffer.concat([Buffer.from(extra + head), Buffer.from(String(Math.random())), Buffer.from(`\r\n--${b}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${b}`, ...ADMIN },
  })
  return res.json()
}

// 把一個檔案的期限撥到過去(只動這份測試自己的資料庫)
function expire(id) {
  const Database = require('better-sqlite3')
  const db = new Database(path.join(dataDir, 'pokkit.db'))
  db.prepare('UPDATE files SET expires_at = ? WHERE id = ?').run(Date.now() - 60_000, id)
  db.close()
}

// ── 不存在 ──

test('a link that does not exist shows a page, not raw JSON, and is still a 404', async () => {
  const res = await app.inject({ method: 'GET', url: '/f/no-such-file', headers: BROWSER })
  assert.equal(res.statusCode, 404)
  assert.match(res.headers['content-type'], /text\/html/)
  assert.ok(!res.body.trim().startsWith('{'), 'not JSON')
  assert.match(res.body, /<html/)
  assert.match(res.body, /data-zh="[^"]*不存在/)
  assert.match(res.body, /href="\/"/, 'offers a way back home')
})

test('an API client asking for a missing link still gets JSON', async () => {
  const res = await app.inject({ method: 'GET', url: '/f/no-such-file', headers: { accept: 'application/json' } })
  assert.equal(res.statusCode, 404)
  assert.equal(res.json().error, 'File not found')
})

test('the missing-link page cannot be used to inject markup through the address', async () => {
  const res = await app.inject({ method: 'GET', url: '/f/%3Cscript%3Ealert(1)%3C%2Fscript%3E', headers: BROWSER })
  assert.equal(res.statusCode, 404)
  assert.ok(!res.body.includes('<script>alert(1)'))
})

// ── 過期 ──

test('an expired link answers 410 in a browser too, and still explains itself', async () => {
  const { id } = await upload('gone.png', 'image/png', { expiresIn: '1h' })
  assert.equal((await app.inject({ method: 'GET', url: `/f/${id}`, headers: BROWSER })).statusCode, 200, 'fine while valid')
  expire(id)

  const page = await app.inject({ method: 'GET', url: `/f/${id}`, headers: BROWSER })
  assert.equal(page.statusCode, 410)
  assert.match(page.headers['content-type'], /text\/html/)
  assert.match(page.body, /This link has expired/)
  assert.ok(!page.body.includes(`/files/${id}/preview`), 'no preview and no preview tags for an expired file')

  const api = await app.inject({ method: 'GET', url: `/f/${id}`, headers: { accept: 'application/json' } })
  assert.equal(api.statusCode, 410)
})

// ── 預覽卡 ──

const base = 'https://main.example'
const entry = (over) => ({ id: 'abc123', mime: 'video/mp4', password_hash: null, expires_at: null, thumb_stored_name: null, ...over })

test('a processed video advertises its thumbnail as the preview image', () => {
  const tags = sharePreviewTags(entry({ thumb_stored_name: 'users/u/abc123/thumb.webp' }), base)
  assert.match(tags, /property="og:image" content="https:\/\/main\.example\/photos\/abc123\/thumb\.webp"/)
  assert.match(tags, /property="og:video" content="https:\/\/main\.example\/files\/abc123\/preview"/)
  assert.match(tags, /name="twitter:card" content="summary_large_image"/)
})

test('a video without a thumbnail claims no preview image', () => {
  const tags = sharePreviewTags(entry({}), base)
  assert.ok(!tags.includes('og:image'))
  assert.match(tags, /property="og:video"/)
  assert.match(tags, /name="twitter:card" content="summary"/)
})

test('an image keeps using itself as the preview image', () => {
  const tags = sharePreviewTags(entry({ mime: 'image/png' }), base)
  assert.match(tags, /property="og:image" content="https:\/\/main\.example\/files\/abc123\/preview"/)
  assert.match(tags, /name="twitter:card" content="summary_large_image"/)
  assert.ok(!tags.includes('og:video'))
})

test('a password-protected or expired file advertises no media at all', () => {
  const locked = sharePreviewTags(entry({ password_hash: 'x', thumb_stored_name: 't' }), base)
  const expired = sharePreviewTags(entry({ expires_at: Date.now() - 1000, thumb_stored_name: 't' }), base)
  for (const tags of [locked, expired]) {
    assert.ok(!tags.includes('og:image'))
    assert.ok(!tags.includes('og:video'))
    assert.match(tags, /name="twitter:card" content="summary"/)
  }
})

test('a hostile host name or id cannot break out of the tags', () => {
  const tags = sharePreviewTags(entry({ id: 'a"><script>x', mime: 'image/png' }), 'https://evil.example"><script>alert(1)</script>')
  assert.ok(!tags.includes('<script>'))
  assert.ok(!/content="[^"]*"[^>\s]/.test(tags), 'every attribute value stays closed')
})

test('a plain document gets a plain card', () => {
  const tags = sharePreviewTags(entry({ mime: 'application/pdf' }), base)
  assert.ok(!tags.includes('og:image'))
  assert.match(tags, /property="og:type" content="website"/)
})

test('the real share page carries these tags', async () => {
  const { id } = await upload('pic.png', 'image/png')
  const html = (await app.inject({ method: 'GET', url: `/f/${id}`, headers: BROWSER })).body
  assert.match(html, new RegExp(`property="og:image" content="https://main\\.example/files/${id}/preview"`))
  const locked = await upload('secret.png', 'image/png', { password: 'pw' })
  const lockedHtml = (await app.inject({ method: 'GET', url: `/f/${locked.id}`, headers: BROWSER })).body
  assert.ok(!lockedHtml.includes('og:image'), 'a locked file does not advertise a preview')
})
