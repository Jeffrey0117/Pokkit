// 會員管理:新檔案按會員分資料夾、管理員能查能下架能封鎖、動作留紀錄。
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

const API_KEY = 'admin-key'
const APP = 'pokkit-test'
const KID = 'kid-1'
const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-mod-'))
let app

function token(userId, email) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const data = `${b64({ alg: 'ES256', typ: 'JWT', kid: KID })}.${b64({
    sub: userId,
    email,
    app: APP,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}`
  const sig = crypto.sign('sha256', Buffer.from(data), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' })
  return `${data}.${sig.toString('base64url')}`
}

before(async () => {
  app = await createServer({
    port: 0,
    host: '127.0.0.1',
    dataDir,
    apiKey: API_KEY,
    maxFileSize: 500 * 1024 * 1024,
    publicUrl: '',
    premiumUserIds: [],
    adminUsers: ['owner@example.com'],
    letmeuseAppSecret: '',
    letmeuseAppId: APP,
    globalCapacityBytes: 500 * GB,
    getJwtKey: (kid) => (kid === KID ? keys.publicKey : null),
  })
  await app.ready()
})

after(async () => {
  if (app) await app.close()
})

function upload({ auth, ip, name = `f${Math.random()}.zip`, mime = 'application/zip' }) {
  const b = '----mod' + Math.random().toString(16).slice(2)
  const head = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`
  return app.inject({
    method: 'POST',
    url: '/upload',
    payload: Buffer.concat([Buffer.from(head), Buffer.from(String(Math.random())), Buffer.from(`\r\n--${b}--\r\n`)]),
    headers: {
      'content-type': `multipart/form-data; boundary=${b}`,
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      ...(ip ? { 'cf-connecting-ip': ip } : {}),
    },
  })
}

const admin = (method, url, payload) =>
  app.inject({ method, url, payload, headers: { authorization: `Bearer ${API_KEY}` } })

test('a new upload is stored under its owner', async () => {
  const res = await upload({ auth: token('usr_path', 'path@example.com') })
  assert.equal(res.statusCode, 200)
  const dir = path.join(dataDir, 'default', 'users', 'usr_path', res.json().id)
  assert.ok(fs.existsSync(dir), `missing ${dir}`)
})

test('guest uploads go under their own folder', async () => {
  const res = await upload({ ip: '198.51.100.10' })
  assert.ok(fs.existsSync(path.join(dataDir, 'default', 'users', 'guest', res.json().id)))
})

test('a stored file still downloads from its new path', async () => {
  const res = await upload({ auth: token('usr_path', 'path@example.com') })
  const dl = await app.inject({ method: 'GET', url: `/f/${res.json().id}?dl=1`, headers: { accept: '*/*', authorization: `Bearer ${API_KEY}` } })
  assert.equal(dl.statusCode, 200)
})

test('a hostile user id cannot escape the users folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-esc-'))
  const store = new PokkitStore({ dataDir: dir })
  const entry = store.save('a.txt', 'text/plain', Buffer.from('x'), { user_id: '../../evil' })
  const full = path.resolve(dir, 'default', entry.stored_name)
  assert.ok(full.startsWith(path.resolve(dir, 'default', 'users') + path.sep), full)
  store.close()
})

test('photos finish processing under the owner folder and keep the original beside them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-photo-'))
  const store = new PokkitStore({ dataDir: dir })
  const raw = store.saveRawPhoto('a.jpg', 'image/jpeg', Buffer.alloc(100, 3), { user_id: 'usr_p' })
  store.finalizePhoto(raw.id, { webpBuffer: Buffer.alloc(10, 1), thumbBuffer: Buffer.alloc(5, 2), width: 1, height: 1, takenAt: null })
  const entryDir = store.getEntryDir(raw.id)
  assert.equal(path.basename(path.dirname(entryDir)), 'usr_p')
  assert.deepEqual(fs.readdirSync(entryDir).sort(), ['_raw.jpg', 'photo.webp', 'thumb.webp'])
  store.close()
})

test('files stored the old flat way keep working', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-old-'))
  const store = new PokkitStore({ dataDir: dir })
  const entry = store.saveRawPhoto('a.jpg', 'image/jpeg', Buffer.alloc(50, 4), {})
  assert.equal(path.basename(path.dirname(store.getEntryDir(entry.id))), 'default')
  store.close()
})

test('removing a file deletes its original and thumbnail from disk too', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-rm-'))
  const store = new PokkitStore({ dataDir: dir })
  const raw = store.saveRawPhoto('a.jpg', 'image/jpeg', Buffer.alloc(100, 5), { user_id: 'usr_rm' })
  store.finalizePhoto(raw.id, { webpBuffer: Buffer.alloc(10, 1), thumbBuffer: Buffer.alloc(5, 2), width: 1, height: 1, takenAt: null })
  const entryDir = store.getEntryDir(raw.id)
  store.remove(raw.id)
  assert.equal(fs.existsSync(entryDir), false)
  store.close()
})

test('removing a file never deletes a folder that is not its own', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-rm2-'))
  const store = new PokkitStore({ dataDir: dir })
  const a = store.save('a.txt', 'text/plain', Buffer.from('a'), { user_id: 'usr_same' })
  const b = store.save('b.txt', 'text/plain', Buffer.from('b'), { user_id: 'usr_same' })
  store.remove(a.id)
  assert.ok(store.getEntryDir(b.id) && fs.existsSync(store.getEntryDir(b.id)))
  assert.ok(store.find(b.id))
  store.close()
})

test('admin routes refuse everyone but the admin', async () => {
  const member = token('usr_nosy', 'nosy@example.com')
  for (const [method, url] of [
    ['GET', '/api/admin/members'],
    ['GET', '/api/admin/members/usr_path/files'],
    ['POST', '/api/admin/members/usr_path/block'],
    ['POST', '/api/admin/members/usr_path/purge'],
    ['DELETE', '/api/admin/files/x'],
    ['GET', '/api/admin/moderation-log'],
  ]) {
    const anon = await app.inject({ method, url, payload: method === 'GET' ? undefined : {} })
    assert.equal(anon.statusCode, 401, `${url} anon`)
    const res = await app.inject({ method, url, payload: method === 'GET' ? undefined : {}, headers: { authorization: `Bearer ${member}` } })
    assert.equal(res.statusCode, 403, `${url} member`)
  }
})

test('the member list shows usage, email and block state', async () => {
  await upload({ auth: token('usr_list', 'list@example.com') })
  await upload({ auth: token('usr_list', 'list@example.com') })
  const { members, total } = (await admin('GET', '/api/admin/members')).json()
  const row = members.find((m) => m.userId === 'usr_list')
  assert.equal(row.files, 2)
  assert.ok(row.bytes > 0)
  assert.equal(row.email, 'list@example.com')
  assert.equal(row.kind, 'member')
  assert.equal(row.blocked, false)
  assert.ok(total >= 1)
})

test('the admin can list a member\'s files', async () => {
  const up = await upload({ auth: token('usr_files', 'files@example.com'), name: 'clip.zip' })
  const { files } = (await admin('GET', '/api/admin/members/usr_files/files')).json()
  assert.equal(files.length, 1)
  assert.equal(files[0].id, up.json().id)
  assert.equal(files[0].filename, 'clip.zip')
  assert.match(files[0].shareUrl, new RegExp(`/f/${up.json().id}$`))
})

test('taking down a file breaks its link and is logged', async () => {
  const up = await upload({ auth: token('usr_td', 'td@example.com') })
  const id = up.json().id
  const res = await admin('DELETE', `/api/admin/files/${id}`, { reason: 'spam' })
  assert.equal(res.statusCode, 200)
  const gone = await app.inject({ method: 'GET', url: `/f/${id}`, headers: { accept: 'text/html' } })
  assert.equal(gone.statusCode, 404)
  const { log } = (await admin('GET', '/api/admin/moderation-log')).json()
  const row = log.find((l) => l.targetFile === id)
  assert.equal(row.action, 'takedown')
  assert.equal(row.targetUser, 'usr_td')
  assert.equal(row.detail, 'spam')
})

test('taking down a missing file is a 404', async () => {
  assert.equal((await admin('DELETE', '/api/admin/files/nope', {})).statusCode, 404)
})

test('a blocked member cannot upload or use their account, and unblocking restores it', async () => {
  const t = token('usr_block', 'block@example.com')
  assert.equal((await upload({ auth: t })).statusCode, 200)
  assert.equal((await admin('POST', '/api/admin/members/usr_block/block', { reason: 'abuse' })).statusCode, 200)
  const blocked = await upload({ auth: t })
  assert.equal(blocked.statusCode, 403)
  assert.equal(blocked.json().code, 'account_blocked')
  const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${t}` } })
  assert.equal(me.statusCode, 403)
  assert.equal((await admin('POST', '/api/admin/members/usr_block/unblock', {})).statusCode, 200)
  assert.equal((await upload({ auth: t })).statusCode, 200)
})

test('purge removes all of a member\'s files and blocks them, but needs the id typed back', async () => {
  const t = token('usr_purge', 'purge@example.com')
  const a = (await upload({ auth: t })).json().id
  const b = (await upload({ auth: t })).json().id
  assert.equal((await admin('POST', '/api/admin/members/usr_purge/purge', {})).statusCode, 400)
  const res = await admin('POST', '/api/admin/members/usr_purge/purge', { confirm: 'usr_purge' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().removed, 2)
  for (const id of [a, b]) {
    assert.equal((await app.inject({ method: 'GET', url: `/f/${id}`, headers: { accept: 'text/html' } })).statusCode, 404)
  }
  assert.equal((await upload({ auth: t })).statusCode, 403)
})

test('owners, project accounts and the guest bucket cannot be blocked or purged', async () => {
  for (const id of ['admin', 'guest']) {
    assert.equal((await admin('POST', `/api/admin/members/${id}/block`, {})).statusCode, 400, id)
    assert.equal((await admin('POST', `/api/admin/members/${id}/purge`, { confirm: id })).statusCode, 400, id)
  }
  const owner = token('usr_owner', 'owner@example.com')
  assert.equal((await upload({ auth: owner })).statusCode, 200)
  assert.equal((await admin('POST', '/api/admin/members/usr_owner/block', {})).statusCode, 400)
  const acct = (await admin('POST', '/api/admin/accounts', { name: 'proj' })).json()
  const acctId = acct.account?.id ?? acct.id
  assert.equal((await admin('POST', `/api/admin/members/${acctId}/block`, {})).statusCode, 400)
})

test('an abusive guest can be blocked from one of their files', async () => {
  const ip = '198.51.100.20'
  const up = await upload({ ip })
  const id = up.json().id
  const res = await admin('POST', `/api/admin/files/${id}/block-uploader`, { reason: 'abuse' })
  assert.equal(res.statusCode, 200)
  const blocked = await upload({ ip })
  assert.equal(blocked.statusCode, 403)
  assert.equal(blocked.json().code, 'account_blocked')
  assert.equal((await upload({ ip: '198.51.100.21' })).statusCode, 200)
})

test('blocking the uploader of a member file blocks that member', async () => {
  const t = token('usr_viafile', 'via@example.com')
  const id = (await upload({ auth: t })).json().id
  assert.equal((await admin('POST', `/api/admin/files/${id}/block-uploader`, {})).statusCode, 200)
  assert.equal((await upload({ auth: t })).statusCode, 403)
})

test('the admin page is served without caching', async () => {
  const res = await app.inject({ method: 'GET', url: '/admin', headers: { accept: 'text/html' } })
  assert.equal(res.statusCode, 200)
  assert.match(res.headers['cache-control'], /no-store/)
  assert.match(res.body, /會員管理/)
})
