// 2026-11-10 事故回歸:管理員的「所有照片」混進其他會員的檔案。
// 管理員的個人檔案庫只放自己的,查別人走會員管理後台。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

process.env.POKKIT_LOG = 'silent'
const { createServer } = await import('../src/server.ts')
const { GB } = await import('../src/config.ts')

const API_KEY = 'admin-key'
const APP = 'pokkit-test'
const KID = 'kid-1'
const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-scope-'))
let app

function token(userId, email) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const data = `${b64({ alg: 'ES256', typ: 'JWT', kid: KID })}.${b64({ sub: userId, email, app: APP, exp: Math.floor(Date.now() / 1000) + 3600 })}`
  const sig = crypto.sign('sha256', Buffer.from(data), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' })
  return `${data}.${sig.toString('base64url')}`
}

const OWNER = token('usr_owner', 'owner@example.com')
const MEMBER = token('usr_member', 'member@example.com')

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

function upload(auth, name, mime = 'application/zip') {
  const b = '----scope' + Math.random().toString(16).slice(2)
  const head = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`
  return app.inject({
    method: 'POST',
    url: '/upload',
    payload: Buffer.concat([Buffer.from(head), Buffer.from(String(Math.random())), Buffer.from(`\r\n--${b}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${b}`, authorization: `Bearer ${auth}` },
  })
}

const get = (url, auth) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${auth}`, accept: 'application/json' } })
const idsOf = (body) => (Array.isArray(body) ? body : body.files ?? body.photos ?? body.items ?? []).map((f) => f.id)

test('the owner file list has only the owner files', async () => {
  const mine = (await upload(OWNER, 'mine.zip')).json().id
  const theirs = (await upload(MEMBER, 'theirs.zip')).json().id
  const ids = idsOf((await get('/files', OWNER)).json())
  assert.ok(ids.includes(mine))
  assert.ok(!ids.includes(theirs), 'another member leaked into the owner library')
})

test('the owner photo library has only the owner media', async () => {
  const theirs = (await upload(MEMBER, 'their.jpg', 'image/jpeg')).json().id
  const res = await get('/api/photos?limit=200', OWNER)
  assert.equal(res.statusCode, 200)
  assert.ok(!idsOf(res.json()).includes(theirs), 'another member leaked into the owner photos')
})

test('the owner album list has only the owner albums', async () => {
  const mk = (auth, name) => app.inject({ method: 'POST', url: '/api/albums', payload: { name }, headers: { authorization: `Bearer ${auth}` } })
  const mine = (await mk(OWNER, 'mine')).json().id
  const theirs = (await mk(MEMBER, 'theirs')).json().id
  const albums = (await get('/api/albums', OWNER)).json()
  const ids = (Array.isArray(albums) ? albums : albums.albums).map((a) => a.id)
  assert.ok(ids.includes(mine))
  assert.ok(!ids.includes(theirs))
})

test('old unowned albums stay with the owner and never reach members', async () => {
  const Database = createRequire(import.meta.url)('better-sqlite3')
  const db = new Database(path.join(dataDir, 'pokkit.db'))
  db.prepare("INSERT INTO albums (id, name, created_at, updated_at, user_id) VALUES ('legacy1', 'old', 1, 1, NULL)").run()
  db.close()
  const list = async (auth) => {
    const albums = (await get('/api/albums', auth)).json()
    return (Array.isArray(albums) ? albums : albums.albums).map((a) => a.id)
  }
  assert.ok((await list(OWNER)).includes('legacy1'), 'the owner lost an old album')
  assert.ok(!(await list(MEMBER)).includes('legacy1'), 'a member can see an old album')
})

test('emptying the trash as owner never destroys a member trash', async () => {
  const theirs = (await upload(MEMBER, 'their-trash.zip')).json().id
  assert.equal((await app.inject({ method: 'DELETE', url: `/files/${theirs}`, headers: { authorization: `Bearer ${MEMBER}` } })).statusCode, 200)
  const seen = idsOf((await get('/api/trash', OWNER)).json())
  assert.ok(!seen.includes(theirs), 'member trash leaked into the owner trash')
  const purge = await app.inject({ method: 'DELETE', url: '/api/trash', headers: { authorization: `Bearer ${OWNER}` } })
  assert.equal(purge.statusCode, 200)
  const left = idsOf((await get('/api/trash', MEMBER)).json())
  assert.ok(left.includes(theirs), 'owner purge destroyed a member file')
})

test('members see their own photos and videos when filtering by type', async () => {
  const fixture = fs.readFileSync(new URL('./fixtures/one-pixel.jpg', import.meta.url))
  const b = '----own' + Math.random().toString(16).slice(2)
  const head = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="own.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
  const up = await app.inject({
    method: 'POST',
    url: '/upload',
    payload: Buffer.concat([Buffer.from(head), fixture, Buffer.from(`\r\n--${b}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${b}`, authorization: `Bearer ${MEMBER}` },
  })
  const id = up.json().id
  const typed = idsOf((await get('/api/photos?type=photo&limit=50', MEMBER)).json())
  assert.ok(typed.includes(id), 'type=photo hides the member photos')
  const all = idsOf((await get('/api/photos?limit=50', MEMBER)).json())
  assert.ok(all.includes(id))
})

test('members still see their own library', async () => {
  const id = (await upload(MEMBER, 'own.zip')).json().id
  assert.ok(idsOf((await get('/files', MEMBER)).json()).includes(id))
})

test('the admin console still reaches every member', async () => {
  const id = (await upload(MEMBER, 'audit.zip')).json().id
  const res = await get('/api/admin/members/usr_member/files', OWNER)
  assert.equal(res.statusCode, 200)
  assert.ok(res.json().files.some((f) => f.id === id))
})

test('the API key keeps its service-wide view for tools', async () => {
  const id = (await upload(MEMBER, 'tool.zip')).json().id
  assert.ok(idsOf((await get('/files', API_KEY)).json()).includes(id))
})
