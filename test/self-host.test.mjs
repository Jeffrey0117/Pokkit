// 自架模式:沒設會員系統 (LETMEUSE_APP_ID) 的那台,不能依賴作者的任何服務。
// 2026-11-11 之前:自架的首頁照樣載入作者的登入元件與流量統計、登入按鈕按了沒反應、
// 分享頁下載一般檔案要「登入」但根本沒地方登入。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import vm from 'node:vm'

process.env.POKKIT_LOG = 'silent'
const { createServer } = await import('../src/server.ts')
const { GB } = await import('../src/config.ts')
const { isSelfHosted, toSelfHostedHtml } = await import('../src/self-host.ts')

const publicDir = path.join(import.meta.dirname, '..', 'public')
const appJs = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8')
const i18n = fs.readFileSync(path.join(publicDir, 'i18n.js'), 'utf8')
const css = fs.readFileSync(path.join(publicDir, 'style.css'), 'utf8')

const API_KEY = 'owner-key-for-tests'
const base = {
  port: 0, host: '127.0.0.1', apiKey: API_KEY, maxFileSize: 500 * 1024 * 1024, publicUrl: 'https://mine.example',
  publicHosts: [], premiumUserIds: [], adminUsers: [], globalCapacityBytes: 500 * GB, getJwtKey: () => null,
}
let self
let hosted

before(async () => {
  self = await createServer({ ...base, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pk-self-')), letmeuseAppId: '' })
  hosted = await createServer({ ...base, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pk-host-')), letmeuseAppId: 'pokkit-test' })
  await self.ready()
  await hosted.ready()
})

after(async () => {
  if (self) await self.close()
  if (hosted) await hosted.close()
})

function upload(app, { auth, name, mime }) {
  const b = '----sh' + Math.random().toString(16).slice(2)
  const head = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`
  return app.inject({
    method: 'POST',
    url: '/upload',
    payload: Buffer.concat([Buffer.from(head), Buffer.from(String(Math.random())), Buffer.from(`\r\n--${b}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${b}`, ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
  })
}

const page = (app, url) => app.inject({ method: 'GET', url, headers: { accept: 'text/html' } })
// 頁面會去載入的外部資源的主機名 (script / img / link 等)。給人點的 <a> 連結不算載入。
const externalHosts = (html) => [...new Set(
  [...html.matchAll(/<(?!a\b)[a-z-]+\b[^>]*?\b(?:src|href)="https?:\/\/([^/"]+)/g)].map((m) => m[1]),
)]
const FONTS = ['fonts.googleapis.com', 'fonts.gstatic.com']

test('有沒有設會員系統,決定是不是自架模式', () => {
  assert.equal(isSelfHosted({ letmeuseAppId: '' }), true)
  assert.equal(isSelfHosted({ letmeuseAppId: 'app_x' }), false)
})

test('自架的首頁不載入作者的登入元件與流量統計', async () => {
  const html = (await page(self, '/')).body
  assert.deepEqual(externalHosts(html).filter((h) => !FONTS.includes(h)), [], '首頁還連到別人的主機')
  assert.ok(!/data-app-id|data-website-id/.test(html))
  assert.match(html, /window\.POKKIT_SELFHOST\s*=\s*true/)
})

test('代管版的首頁維持原樣', async () => {
  const html = (await page(hosted, '/')).body
  assert.match(html, /letmeuse\.js/)
  assert.match(html, /data-website-id/)
  assert.ok(!html.includes('POKKIT_SELFHOST'))
})

test('換掉的只有那兩段外部 script,其他一個字不動', () => {
  const src = '<head>\n  <script src="https://a.example/letmeuse.js"\n    data-app-id="x"\n    data-mode="modal">\n  </script>\n  <script defer src="https://b.example/script.js" data-website-id="y"></script>\n  <script src="/i18n.js?v=1"></script>\n</head>'
  const out = toSelfHostedHtml(src)
  assert.ok(!out.includes('a.example') && !out.includes('b.example'))
  assert.ok(out.includes('<script src="/i18n.js?v=1"></script>'))
  assert.ok(out.indexOf('POKKIT_SELFHOST') < out.indexOf('/i18n.js'), '旗標要在 app 的 script 之前')
})

test('自架:拿管理金鑰就能當登入身分用 (網頁登入走這條)', async () => {
  const me = await self.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${API_KEY}` } })
  assert.equal(me.statusCode, 200)
  assert.equal(me.json().isAdmin, true)
  const wrong = await self.inject({ method: 'GET', url: '/api/me', headers: { authorization: 'Bearer nope' } })
  assert.equal(wrong.statusCode, 401)
  for (const url of ['/api/albums', '/api/user/storage', '/files?limit=5']) {
    const res = await self.inject({ method: 'GET', url, headers: { authorization: `Bearer ${API_KEY}`, accept: 'application/json' } })
    assert.equal(res.statusCode, 200, `${url} → ${res.statusCode}`)
  }
})

test('自架:分享頁不載入作者的登入元件,訪客直接下載得到', async () => {
  const up = await upload(self, { auth: API_KEY, name: 'report.zip', mime: 'application/zip' })
  assert.equal(up.statusCode, 200, up.body)
  const { id } = up.json()

  const html = (await page(self, `/f/${id}`)).body
  assert.deepEqual(externalHosts(html).filter((h) => !FONTS.includes(h)), [])
  assert.ok(!/class="[^"]*is-locked/.test(html), '下載鈕不該是鎖住的樣子')

  const dl = await self.inject({ method: 'GET', url: `/f/${id}?dl=1`, headers: { accept: '*/*' } })
  assert.equal(dl.statusCode, 200, '沒有會員系統的站,拿到連結就該能下載')
  const direct = await self.inject({ method: 'GET', url: `/files/${id}/report.zip`, headers: { accept: '*/*' } })
  assert.equal(direct.statusCode, 200)
})

test('自架:有密碼的檔案還是要先輸入密碼', async () => {
  const b = '----shpw'
  const body = `--${b}\r\nContent-Disposition: form-data; name="password"\r\n\r\nhunter2\r\n--${b}\r\nContent-Disposition: form-data; name="file"; filename="secret.zip"\r\nContent-Type: application/zip\r\n\r\nxyz\r\n--${b}--\r\n`
  const up = await self.inject({ method: 'POST', url: '/upload', payload: body, headers: { 'content-type': `multipart/form-data; boundary=${b}`, authorization: `Bearer ${API_KEY}` } })
  assert.equal(up.statusCode, 200, up.body)
  const dl = await self.inject({ method: 'GET', url: `/f/${up.json().id}?dl=1`, headers: { accept: '*/*' } })
  assert.equal(dl.statusCode, 401)
})

test('代管版:沒登入還是不能下載一般檔案', async () => {
  const up = await upload(hosted, { auth: API_KEY, name: 'report.zip', mime: 'application/zip' })
  const dl = await hosted.inject({ method: 'GET', url: `/f/${up.json().id}?dl=1`, headers: { accept: '*/*' } })
  assert.equal(dl.statusCode, 401)
  assert.match((await page(hosted, `/f/${up.json().id}`)).body, /letmeuse\.js/)
})

test('自架:會員管理後台不存在 (沒有會員可管)', async () => {
  assert.equal((await page(self, '/admin')).statusCode, 404)
  assert.equal((await page(self, '/admin.html')).statusCode, 404)
  assert.equal((await page(hosted, '/admin')).statusCode, 200)
})

// ── 前端 ──
function extract(name) {
  const start = appJs.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `app.js 少了 ${name}()`)
  let depth = 0
  for (let i = appJs.indexOf('{', start); i < appJs.length; i++) {
    if (appJs[i] === '{') depth++
    if (appJs[i] === '}' && --depth === 0) return appJs.slice(start, i + 1)
  }
  throw new Error(`${name}() 沒有結尾`)
}

test('前端:登入一律走 startLogin(),自架時改成輸入金鑰', () => {
  const calls = appJs.split('\n').filter((l) => /letmeuse\.login\(\)/.test(l.replace(/\/\/.*$/, '')))
  assert.equal(calls.length, 1, '除了 startLogin() 自己,不該再有地方直接叫 letmeuse.login():\n' + calls.join('\n'))

  const seen = []
  const ctx = vm.createContext({ SELF_HOST: true, keyLogin: () => seen.push('key'), letmeuse: { login: () => seen.push('sdk') }, toast: () => seen.push('toast') })
  vm.runInContext(extract('startLogin'), ctx)
  ctx.startLogin()
  ctx.SELF_HOST = false
  ctx.startLogin()
  assert.deepEqual(seen, ['key', 'sdk'])
})

test('前端:金鑰先向伺服器確認過才存起來', () => {
  const fn = extract('keyLogin')
  assert.match(fn, /'\/api\/me'/)
  assert.ok(fn.indexOf("'/api/me'") < fn.indexOf('localStorage.setItem(STORAGE_TOKEN_KEY'), '要先驗證再存')
  assert.match(fn, /That key was not accepted/)
  for (const key of ['Log in with your key', 'That key was not accepted', 'Log in']) {
    assert.ok(i18n.includes(`'${key}':`), `i18n.js 少了「${key}」`)
  }
})

test('前端:自架時不顯示只有代管版才有的東西', () => {
  assert.match(css, /\.self-hosted \[data-route="pricing"\]/)
  assert.match(css, /\.self-hosted #selectionSendPlottr/)
  assert.match(extract('initLanUx'), /if \(SELF_HOST\) return;/)
  assert.match(extract('showAdminLinks'), /!SELF_HOST/)
})
