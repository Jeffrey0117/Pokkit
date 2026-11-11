// 「在家? LAN 高速直傳」是站長自己在家用的捷徑,一般會員看不到,也拿不到主機的內網位址。
// 2026-11-11 之前:任何登入的會員都會看到這顆按鈕 (按了也連不上),
// 而且 /api/lan-info 會把主機的內網 IP 回給任何登入的人。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

process.env.POKKIT_LOG = 'silent'
const require = createRequire(import.meta.url)
const PokkitStore = require('../core/index.js')
const { createServer } = await import('../src/server.ts')
const { GB } = await import('../src/config.ts')

const appJs = fs.readFileSync(path.join(import.meta.dirname, '..', 'public', 'app.js'), 'utf8')
const API_KEY = 'admin-key'
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-lan-'))
let app
let memberKey

before(async () => {
  app = await createServer({
    port: 0, host: '127.0.0.1', dataDir, apiKey: API_KEY, maxFileSize: 500 * 1024 * 1024, publicUrl: 'https://main.example',
    publicHosts: [], premiumUserIds: [], adminUsers: [], letmeuseAppId: 'pokkit-test', globalCapacityBytes: 500 * GB, getJwtKey: () => null,
  })
  await app.ready()
  const store = new PokkitStore({ dataDir })
  memberKey = store.createAccount('not-an-admin').key // 同一個行程共用資料庫連線,這裡不能 close
})

after(async () => {
  if (app) await app.close()
})

const lanInfo = (key) => app.inject({ method: 'GET', url: '/api/lan-info', headers: key ? { authorization: `Bearer ${key}` } : {} })

test('主機的內網位址只給管理員', async () => {
  assert.equal((await lanInfo(API_KEY)).statusCode, 200)
  const member = await lanInfo(memberKey)
  assert.equal(member.statusCode, 403, member.body)
  assert.ok(!/\d+\.\d+\.\d+\.\d+/.test(member.body), '非管理員的回應裡不該有 IP')
  assert.equal((await lanInfo()).statusCode, 401)
})

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

test('前端:確認是管理員之後才去問、才掛按鈕;一般會員連問都不問', () => {
  const offer = extract('offerLanSwitch')
  assert.match(offer, /'\/api\/lan-info'/)
  assert.match(extract('showAdminLinks'), /if \(isAdmin\) offerLanSwitch\(\)/)
  // 開機時不分身分就去問的那段要拿掉 (訪客問了還會拿到 401)
  assert.ok(!extract('initLanUx').includes('/api/lan-info'))
  assert.equal((appJs.match(/'\/api\/lan-info'/g) || []).length, 1)
})
