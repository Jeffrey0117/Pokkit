// 檔名在手機、Mac 上合法,Windows 硬碟卻不收的情況。
//
// 2026-11-11 實案:「會議紀錄: Q3.pdf」這種檔名上傳直接 500 —— 伺服器跑在
// Windows,而 < > : " | ? * 不能出現在檔名裡。顯示用的檔名要原封不動留著,
// 只有落到硬碟上的那個名字要換掉。
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

const API_KEY = 'test-admin-key'
const ADMIN = { authorization: `Bearer ${API_KEY}` }
let app
let dataDir

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-names-'))
  app = await createServer({
    port: 0,
    host: '127.0.0.1',
    dataDir,
    apiKey: API_KEY,
    maxFileSize: 50 * 1024 * 1024,
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

function upload(name, content, mime = 'text/plain') {
  const b = '----names' + Math.random().toString(16).slice(2)
  const head = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`
  return app.inject({
    method: 'POST',
    url: '/upload',
    payload: Buffer.concat([Buffer.from(head), Buffer.from(content), Buffer.from(`\r\n--${b}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${b}`, ...ADMIN },
  })
}

const AWKWARD = [
  'report: final.txt',
  'what?.txt',
  'a|b.txt',
  'star*.txt',
  'less<more>.txt',
  'trailing dot.',
  'CON',
  'nul.txt',
  'Lpt1.log',
  '中文 檔名 (1).txt',
  `${'long-'.repeat(60)}name.txt`,
]

for (const name of AWKWARD) {
  test(`uploads and reads back intact: ${name.length > 40 ? name.slice(0, 20) + '… (' + name.length + ' chars)' : name}`, async () => {
    const content = `content of ${name} ${Math.random()}`
    const res = await upload(name, content)
    assert.equal(res.statusCode, 200, res.body.slice(0, 200))
    const entry = res.json()
    assert.equal(entry.filename, name, 'the name people see is kept as uploaded')

    const back = await app.inject({ method: 'GET', url: `/f/${entry.id}?raw=1`, headers: ADMIN })
    assert.equal(back.statusCode, 200)
    assert.equal(back.body, content)
  })
}

test('a photo whose extension carries a forbidden character still uploads', async () => {
  const sharp = require('sharp')
  const jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#336699' } }).jpeg().toBuffer()
  const res = await upload('holiday.jp?g', jpeg, 'image/jpeg')
  assert.equal(res.statusCode, 200, res.body.slice(0, 200))
})

test('nothing with a forbidden character ever lands on disk', () => {
  const bad = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (/[<>:"|?*\u0000-\u001f]/.test(entry.name) || /[. ]$/.test(entry.name)) bad.push(entry.name)
      if (entry.isDirectory()) walk(path.join(dir, entry.name))
    }
  }
  walk(path.join(dataDir, 'default'))
  assert.deepEqual(bad, [])
})

// ── the helper on its own ──
const loadHelper = () => require('../core/disk-name.js')

test('diskSafeName replaces what Windows refuses and keeps everything else', () => {
  const { diskSafeName } = loadHelper()
  assert.equal(diskSafeName('report: final.txt'), 'report_ final.txt')
  assert.equal(diskSafeName('a<b>c"d|e?f*g.txt'), 'a_b_c_d_e_f_g.txt')
  assert.equal(diskSafeName('tab\tand\u0001bell.txt'), 'tab_and_bell.txt')
  assert.equal(diskSafeName('中文 檔名 (1).txt'), '中文 檔名 (1).txt')
  assert.equal(diskSafeName('plain-name_2.tar.gz'), 'plain-name_2.tar.gz')
})

test('diskSafeName drops folders, leading dots and trailing dots or spaces', () => {
  const { diskSafeName } = loadHelper()
  assert.equal(diskSafeName('../../etc/passwd'), 'passwd')
  assert.equal(diskSafeName('..\\..\\up.txt'), 'up.txt')
  assert.equal(diskSafeName('...hidden'), 'hidden')
  assert.equal(diskSafeName('trailing dot.'), 'trailing dot')
  assert.equal(diskSafeName('trailing space   '), 'trailing space')
  assert.equal(diskSafeName(''), 'file')
  assert.equal(diskSafeName('???'), '___')
  assert.equal(diskSafeName('. . .'), 'file')
  assert.equal(diskSafeName(undefined), 'file')
})

test('diskSafeName steps around reserved device names', () => {
  const { diskSafeName } = loadHelper()
  assert.equal(diskSafeName('CON'), '_CON')
  assert.equal(diskSafeName('nul.txt'), '_nul.txt')
  assert.equal(diskSafeName('Lpt1.log'), '_Lpt1.log')
  assert.equal(diskSafeName('COM9.tar.gz'), '_COM9.tar.gz')
  assert.equal(diskSafeName('console.txt'), 'console.txt')
  assert.equal(diskSafeName('com10.txt'), 'com10.txt')
})

test('diskSafeName keeps long names under the filesystem limit and keeps the extension', () => {
  const { diskSafeName, MAX_DISK_NAME } = loadHelper()
  const long = `${'x'.repeat(400)}.mp4`
  const safe = diskSafeName(long)
  assert.ok(safe.length <= MAX_DISK_NAME, `${safe.length} chars`)
  assert.ok(safe.endsWith('.mp4'))
  assert.equal(diskSafeName('short.mp4'), 'short.mp4')
})

test('diskSafeName never leaves half an emoji when it shortens a name', () => {
  const { diskSafeName } = loadHelper()
  const safe = diskSafeName(`${'a'.repeat(195)}\u{1F600}${'b'.repeat(40)}.mp4`)
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(safe), 'no orphaned surrogate')
  assert.ok(safe.endsWith('.mp4'))
})

test('diskSafeExt gives a usable extension or the fallback', () => {
  const { diskSafeExt } = loadHelper()
  assert.equal(diskSafeExt('photo.JPG', '.jpg'), '.JPG')
  assert.equal(diskSafeExt('holiday.jp?g', '.jpg'), '.jp_g')
  assert.equal(diskSafeExt('noext', '.jpg'), '.jpg')
  assert.equal(diskSafeExt('weird.', '.jpg'), '.jpg')
  assert.equal(diskSafeExt(`clip.${'e'.repeat(60)}`, '.mp4'), '.mp4')
})
