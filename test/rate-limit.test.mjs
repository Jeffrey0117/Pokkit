// 流量限制要擋的是濫用,不是正常使用。2026-11-11:一個人滑幾百張的照片牆,
// 縮圖把每分鐘 600 次的共用額度用完,之後連頁面本身、JS、CSS 都被回 429,整個站看起來壞掉。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

process.env.POKKIT_LOG = 'silent'
const { createServer } = await import('../src/server.ts')
const { GB } = await import('../src/config.ts')

let app
let dataDir

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-rate-'))
  app = await createServer({
    port: 0, host: '127.0.0.1', dataDir, apiKey: 'test-admin-key', maxFileSize: 500 * 1024 * 1024, publicUrl: '',
    premiumUserIds: [], adminUsers: [], letmeuseAppSecret: '', letmeuseAppId: '', globalCapacityBytes: 500 * GB,
  })
  await app.ready()
})

after(async () => {
  if (app) await app.close()
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 }) } catch { /* Windows may still hold the db */ }
})

// 每個測試用自己的「訪客位址」,額度互不影響
let visitorSeq = 0
const visitor = () => ({ 'cf-connecting-ip': `203.0.113.${(visitorSeq += 1)}` })
const get = (url, headers) => app.inject({ method: 'GET', url, headers })
async function statuses(n, url, headers) {
  const seen = {}
  for (let i = 0; i < n; i += 1) {
    const code = (await get(url, headers)).statusCode
    seen[code] = (seen[code] || 0) + 1
  }
  return seen
}
const html = { accept: 'text/html' }

test('滑一面很長的照片牆不會被擋:縮圖有自己的額度,而且夠大', async () => {
  const who = visitor()
  const thumbs = await statuses(1500, '/photos/nosuchid/thumb.webp', who)
  assert.equal(thumbs[429], undefined, `1500 張縮圖不該有任何一張被擋: ${JSON.stringify(thumbs)}`)
  const photos = await statuses(700, '/photos/nosuchid/photo.webp', who)
  assert.equal(photos[429], undefined, JSON.stringify(photos))
  assert.equal((await get('/api/health', who)).statusCode, 200, '看完照片之後,API 的額度一點都沒被用掉')
})

test('頁面本身與 JS/CSS 不計入額度,就算 API 額度用完也照常載入', async () => {
  const who = visitor()
  const api = await statuses(650, '/api/health', who)
  assert.equal(api[200], 600, `API 還是每分鐘 600 次: ${JSON.stringify(api)}`)
  assert.equal(api[429], 50)

  for (const url of ['/', '/folders', '/photos', '/videos']) {
    assert.equal((await get(url, { ...who, ...html })).statusCode, 200, `${url} 要打得開`)
  }
  for (const url of ['/style.css', '/app.js', '/i18n.js']) {
    assert.equal((await get(url, who)).statusCode, 200, `${url} 要載得到`)
  }
  const pages = await statuses(700, '/folders', { ...who, ...html })
  assert.equal(pages[200], 700, '重新整理幾次都一樣')
})

test('縮圖的額度不是無限:失控的程式一分鐘抓上萬次還是會被擋', async () => {
  const who = visitor()
  const seen = await statuses(6100, '/photos/nosuchid/thumb.webp', who)
  assert.equal(seen[429], 100, JSON.stringify(seen))
  assert.equal((await get('/photos/nosuchid/thumb.webp', visitor())).statusCode, 404, '別的訪客不受影響')
})

test('分享連結與外嵌檔案的讀取也算媒體,不吃 API 額度', async () => {
  const who = visitor()
  const raw = await statuses(700, '/f/nosuchid?raw=1', who)
  assert.equal(raw[429], undefined, JSON.stringify(raw))
  const direct = await statuses(700, '/files/nosuchid/a.jpg', who)
  assert.equal(direct[429], undefined, JSON.stringify(direct))
  assert.equal((await get('/api/health', who)).statusCode, 200)
})

test('密碼驗證維持原本的嚴格限制', async () => {
  const who = visitor()
  const seen = {}
  for (let i = 0; i < 12; i += 1) {
    const res = await app.inject({ method: 'POST', url: '/f/nosuchid/verify', headers: { ...who, 'content-type': 'application/json' }, payload: JSON.stringify({ password: 'x' }) })
    seen[res.statusCode] = (seen[res.statusCode] || 0) + 1
  }
  assert.equal(seen[429], 2, JSON.stringify(seen))
})
