// 2026-11-10 資安稽核修補。每一條都先對舊程式確認會失敗。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

process.env.POKKIT_LOG = 'silent'
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createServer } = await import('../src/server.ts')
const { GB } = await import('../src/config.ts')
const { clientAddress } = await import('../src/guest-limit.ts')

const API_KEY = 'admin-key'
const APP = 'pokkit-test'
const KID = 'kid-1'
const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-sec-'))
let app

function token(userId, email) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const data = `${b64({ alg: 'ES256', typ: 'JWT', kid: KID })}.${b64({ sub: userId, email, app: APP, exp: Math.floor(Date.now() / 1000) + 3600 })}`
  const sig = crypto.sign('sha256', Buffer.from(data), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' })
  return `${data}.${sig.toString('base64url')}`
}

const A = token('usr_a', 'a@example.com')
const B = token('usr_b', 'b@example.com')

before(async () => {
  app = await createServer({
    port: 0, host: '127.0.0.1', dataDir, apiKey: API_KEY, maxFileSize: 500 * 1024 * 1024, publicUrl: '',
    premiumUserIds: [], adminUsers: [], letmeuseAppSecret: '', letmeuseAppId: APP, globalCapacityBytes: 500 * GB,
    getJwtKey: (kid) => (kid === KID ? keys.publicKey : null),
  })
  await app.ready()
})

after(async () => {
  if (app) await app.close()
})

function upload({ auth, ip, name = 'a.zip', mime = 'application/zip', content, fields = {} }) {
  const b = '----sec' + Math.random().toString(16).slice(2)
  const parts = Object.entries(fields).map(([k, v]) => `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('')
  const head = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`
  return app.inject({
    method: 'POST',
    url: '/upload',
    payload: Buffer.concat([Buffer.from(parts + head), content ?? Buffer.from(String(Math.random())), Buffer.from(`\r\n--${b}--\r\n`)]),
    headers: {
      'content-type': `multipart/form-data; boundary=${b}`,
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      ...(ip ? { 'cf-connecting-ip': ip } : {}),
    },
  })
}

async function lockedFile() {
  const res = await upload({ ip: `198.51.100.${Math.floor(Math.random() * 200) + 1}`, fields: { password: 'pw-1234', expiresIn: '1h' }, name: 'l.txt', mime: 'text/plain' })
  return res.json().id
}

const raw = (id, cookie) => app.inject({ method: 'GET', url: `/f/${id}?raw=1`, headers: { accept: '*/*', ...(cookie ? { cookie } : {}) } })

test('a forged password cookie does not unlock a file', async () => {
  const id = await lockedFile()
  assert.equal((await raw(id)).statusCode, 401)
  assert.equal((await raw(id, `pokkit_pass_${id}=1`)).statusCode, 401)
  const direct = await app.inject({ method: 'GET', url: `/files/${id}/x`, headers: { cookie: `pokkit_pass_${id}=1` } })
  assert.notEqual(direct.statusCode, 200)
})

test('the real password still works, and its cookie only opens that file', async () => {
  const id = await lockedFile()
  const other = await lockedFile()
  const ok = await app.inject({
    method: 'POST',
    url: `/f/${id}/verify`,
    payload: 'password=pw-1234',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '198.51.100.201' },
  })
  assert.equal(ok.statusCode, 302)
  const value = ok.cookies.find((c) => c.name === `pokkit_pass_${id}`).value
  assert.equal((await raw(id, `pokkit_pass_${id}=${value}`)).statusCode, 200)
  assert.equal((await raw(other, `pokkit_pass_${other}=${value}`)).statusCode, 401)
})

test('a wrong password sets no usable cookie', async () => {
  const id = await lockedFile()
  const bad = await app.inject({
    method: 'POST',
    url: `/f/${id}/verify`,
    payload: 'password=nope',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '198.51.100.202' },
  })
  assert.equal(bad.statusCode, 401)
  assert.equal(bad.cookies.length, 0)
})

test('password-protected and expired files are not reachable through the photo urls', async () => {
  const dir = path.join(dataDir, 'pokkit.db')
  const up = await upload({ auth: A, name: 'p.jpg', mime: 'image/jpeg', content: fs.readFileSync(new URL('./fixtures/one-pixel.jpg', import.meta.url)) })
  const id = up.json().id
  for (let i = 0; i < 40; i += 1) {
    const s = (await app.inject({ method: 'GET', url: `/api/photos/${id}/status`, headers: { authorization: `Bearer ${A}` } })).json()
    if (s.status !== 'processing') break
    await new Promise((r) => setTimeout(r, 100))
  }
  assert.equal((await app.inject({ method: 'GET', url: `/photos/${id}/thumb.webp` })).statusCode, 200)
  const db = new Database(dir)
  db.prepare('UPDATE files SET password_hash = ? WHERE id = ?').run('x', id)
  db.close()
  for (const name of ['photo.webp', 'thumb.webp']) {
    assert.equal((await app.inject({ method: 'GET', url: `/photos/${id}/${name}` })).statusCode, 404, `${name} locked`)
  }
  const db2 = new Database(dir)
  db2.prepare('UPDATE files SET password_hash = NULL, expires_at = ? WHERE id = ?').run(Date.now() - 1000, id)
  db2.close()
  for (const name of ['photo.webp', 'thumb.webp']) {
    assert.equal((await app.inject({ method: 'GET', url: `/photos/${id}/${name}` })).statusCode, 404, `${name} expired`)
  }
})

test('the same bytes from two members stay two separate files', async () => {
  const content = Buffer.from(`same ${Math.random()}`)
  const a = (await upload({ auth: A, name: 'a-secret-name.zip', content })).json()
  const b = (await upload({ auth: B, name: 'b.zip', content })).json()
  assert.notEqual(a.id, b.id)
  assert.equal(b.filename, 'b.zip')
  await app.inject({ method: 'DELETE', url: `/files/${a.id}`, headers: { authorization: `Bearer ${A}` } })
  const stillThere = await app.inject({ method: 'GET', url: `/f/${b.id}?dl=1`, headers: { accept: '*/*', authorization: `Bearer ${B}` } })
  assert.equal(stillThere.statusCode, 200)
})

test('re-uploading your own file still dedupes', async () => {
  const content = Buffer.from(`mine ${Math.random()}`)
  const one = (await upload({ auth: A, content })).json()
  const two = (await upload({ auth: A, content })).json()
  assert.equal(one.id, two.id)
})

test('a taken-down file cannot be restored by its owner', async () => {
  const id = (await upload({ auth: A })).json().id
  await app.inject({ method: 'DELETE', url: `/api/admin/files/${id}`, payload: {}, headers: { authorization: `Bearer ${API_KEY}` } })
  const res = await app.inject({ method: 'POST', url: `/api/trash/${id}/restore`, payload: {}, headers: { authorization: `Bearer ${A}` } })
  assert.equal(res.statusCode, 403)
  const gone = await app.inject({ method: 'GET', url: `/f/${id}`, headers: { accept: 'text/html' } })
  assert.equal(gone.statusCode, 404)
})

test('a file you trashed yourself can still be restored', async () => {
  const id = (await upload({ auth: A })).json().id
  await app.inject({ method: 'DELETE', url: `/files/${id}`, headers: { authorization: `Bearer ${A}` } })
  const res = await app.inject({ method: 'POST', url: `/api/trash/${id}/restore`, payload: {}, headers: { authorization: `Bearer ${A}` } })
  assert.equal(res.statusCode, 200)
})

test('a purged member cannot restore files after being unblocked', async () => {
  const t = token('usr_purged', 'purged@example.com')
  const id = (await upload({ auth: t })).json().id
  const headers = { authorization: `Bearer ${API_KEY}` }
  await app.inject({ method: 'POST', url: '/api/admin/members/usr_purged/purge', payload: { confirm: 'usr_purged' }, headers })
  await app.inject({ method: 'POST', url: '/api/admin/members/usr_purged/unblock', payload: {}, headers })
  const res = await app.inject({ method: 'POST', url: `/api/trash/${id}/restore`, payload: {}, headers: { authorization: `Bearer ${t}` } })
  assert.equal(res.statusCode, 403)
})

test('check-hashes does not count trashed files as already stored', async () => {
  const content = Buffer.from(`trash ${Math.random()}`)
  const id = (await upload({ auth: A, content })).json().id
  const hash = crypto.createHash('sha256').update(content).digest('hex')
  const db = new Database(path.join(dataDir, 'pokkit.db'), { readonly: true })
  const stored = db.prepare('SELECT hash FROM files WHERE id = ?').get(id).hash
  db.close()
  const ask = () => app.inject({ method: 'POST', url: '/api/check-hashes', payload: { hashes: [stored, hash] }, headers: { authorization: `Bearer ${A}` } })
  assert.ok((await ask()).json().existing[stored])
  await app.inject({ method: 'DELETE', url: `/files/${id}`, headers: { authorization: `Bearer ${A}` } })
  assert.equal((await ask()).json().existing[stored], undefined)
})

test('an oversized guest upload stops at the guest limit', async () => {
  const res = await upload({ ip: '198.51.100.203', content: Buffer.alloc(65 * 1024 * 1024, 1) })
  assert.equal(res.statusCode, 413)
})

test('rate limits are per visitor, not one bucket for everyone behind the tunnel', async () => {
  const hit = (ip) => app.inject({ method: 'POST', url: '/f/none/verify', payload: 'password=x', headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': ip } })
  for (let i = 0; i < 11; i += 1) await hit('198.51.100.210')
  assert.equal((await hit('198.51.100.210')).statusCode, 429)
  assert.equal((await hit('198.51.100.211')).statusCode, 404)
})

test('the visitor header is only believed from the local tunnel', () => {
  const header = { 'cf-connecting-ip': '198.51.100.1' }
  assert.equal(clientAddress({ headers: header, ip: '127.0.0.1' }), '198.51.100.1')
  assert.equal(clientAddress({ headers: header, ip: '::1' }), '198.51.100.1')
  assert.equal(clientAddress({ headers: header, ip: '192.168.0.50' }), '192.168.0.50')
  assert.equal(clientAddress({ headers: {}, ip: '127.0.0.1' }), '127.0.0.1')
})

test('pro interest does not send mail to a typed-in address', () => {
  const src = fs.readFileSync(new URL('../src/routes/status.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /api\/send/)
})

test('album names cannot inject markup into the page', () => {
  const app_js = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  assert.doesNotMatch(app_js, /innerHTML[^\n]*album\.name/)
})

test('video tools only open real video containers', () => {
  const src = fs.readFileSync(new URL('../src/workers/video-processor.cjs', import.meta.url), 'utf8')
  const inputs = src.match(/'-i', rawPath/g) || []
  assert.ok(inputs.length >= 2)
  assert.equal((src.match(/\.\.\.SAFE_INPUT, '-i', rawPath/g) || []).length, inputs.length)
  assert.match(src, /\.\.\.SAFE_INPUT,\s*\n?\s*filePath/)
})
