// 相簿可以收進資料夾(一層),刪掉資料夾時裡面的相簿退回最上層。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

process.env.POKKIT_LOG = 'silent'
const { createServer } = await import('../src/server.ts')
const { GB } = await import('../src/config.ts')

const APP = 'pokkit-test'
const KID = 'kid-1'
const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
let app

function token(userId) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const data = `${b64({ alg: 'ES256', typ: 'JWT', kid: KID })}.${b64({ sub: userId, email: `${userId}@example.com`, app: APP, exp: Math.floor(Date.now() / 1000) + 3600 })}`
  const sig = crypto.sign('sha256', Buffer.from(data), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' })
  return `${data}.${sig.toString('base64url')}`
}

const ME = token('usr_folders')
const OTHER = token('usr_folders_other')

before(async () => {
  app = await createServer({
    port: 0, host: '127.0.0.1', dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pk-folders-')), apiKey: 'k',
    maxFileSize: 1024 * 1024, publicUrl: '', premiumUserIds: [], adminUsers: [], letmeuseAppSecret: '', letmeuseAppId: APP,
    globalCapacityBytes: 500 * GB, getJwtKey: (kid) => (kid === KID ? keys.publicKey : null),
  })
  await app.ready()
})

after(async () => {
  if (app) await app.close()
})

const call = (method, url, auth, payload) =>
  app.inject({ method, url, payload, headers: { authorization: `Bearer ${auth}` } })
const create = async (auth, name, extra = {}) => (await call('POST', '/api/albums', auth, { name, ...extra })).json()
const list = async (auth) => (await call('GET', '/api/albums', auth)).json()

test('an album can be moved into a folder and shows up inside it', async () => {
  const folder = await create(ME, '人物')
  const album = await create(ME, 'zoe')
  assert.equal((await call('PUT', `/api/albums/${album.id}`, ME, { parent_id: folder.id })).statusCode, 200)
  const rows = await list(ME)
  assert.equal(rows.find((a) => a.id === album.id).parent_id, folder.id)
  assert.equal(rows.find((a) => a.id === folder.id).child_count, 1)
  const opened = (await call('GET', `/api/albums/${folder.id}`, ME)).json()
  assert.deepEqual(opened.children.map((c) => c.id), [album.id])
})

test('an album can be created straight inside a folder', async () => {
  const folder = await create(ME, '健身')
  const album = await create(ME, '腿日', { parent_id: folder.id })
  assert.equal((await list(ME)).find((a) => a.id === album.id).parent_id, folder.id)
})

test('moving an album out of a folder puts it back on top', async () => {
  const folder = await create(ME, '靈感')
  const album = await create(ME, 'x', { parent_id: folder.id })
  assert.equal((await call('PUT', `/api/albums/${album.id}`, ME, { parent_id: null })).statusCode, 200)
  assert.equal((await list(ME)).find((a) => a.id === album.id).parent_id, null)
})

test('folders only go one level deep', async () => {
  const top = await create(ME, 'top')
  const mid = await create(ME, 'mid', { parent_id: top.id })
  const leaf = await create(ME, 'leaf')
  assert.equal((await call('PUT', `/api/albums/${leaf.id}`, ME, { parent_id: mid.id })).statusCode, 400)
  assert.equal((await call('PUT', `/api/albums/${top.id}`, ME, { parent_id: leaf.id })).statusCode, 400)
  assert.equal((await call('PUT', `/api/albums/${leaf.id}`, ME, { parent_id: leaf.id })).statusCode, 400)
})

test('you cannot file an album into someone else\'s folder', async () => {
  const theirs = await create(OTHER, 'theirs')
  const mine = await create(ME, 'mine')
  assert.equal((await call('PUT', `/api/albums/${mine.id}`, ME, { parent_id: theirs.id })).statusCode, 404)
  assert.equal((await call('POST', '/api/albums', ME, { name: 'sneaky', parent_id: theirs.id })).statusCode, 404)
})

test('deleting a folder keeps its albums and moves them back on top', async () => {
  const folder = await create(ME, '證件')
  const album = await create(ME, '護照', { parent_id: folder.id })
  assert.equal((await call('DELETE', `/api/albums/${folder.id}`, ME)).statusCode, 200)
  const row = (await list(ME)).find((a) => a.id === album.id)
  assert.ok(row, 'the album inside was deleted')
  assert.equal(row.parent_id, null)
})

test('the page renders folders and can open them', () => {
  const src = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  assert.match(src, /subAlbumGrid/)
  assert.match(src, /parent_id/)
})
