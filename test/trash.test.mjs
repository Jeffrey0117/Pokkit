// 垃圾桶 (soft delete) 行為:人類軟刪可復原、pk_/admin 硬刪、分享連結即時失效。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'

import http from 'node:http'

process.env.POKKIT_LOG = 'silent'

// HS256 已廢 (2026-10-25 資安事件) — 測試照正規路徑走: 自架迷你 JWKS server
// 餵測試公鑰, LETMEUSE_JWKS_URL 指過去, token 用對應私鑰簽 ES256。
const { publicKey: TEST_PUB, privateKey: TEST_PRIV } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
const TEST_KID = 'trash-test-kid'
const jwk = { ...TEST_PUB.export({ format: 'jwk' }), kid: TEST_KID, alg: 'ES256', use: 'sig' }
const jwksServer = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ keys: [jwk] }))
})
await new Promise((resolve) => jwksServer.listen(0, '127.0.0.1', resolve))
process.env.LETMEUSE_JWKS_URL = 'http://127.0.0.1:' + jwksServer.address().port + '/jwks'

// env 設好才 import (jwks-cache 在 import 時就會打一次 JWKS_URL)
const { createServer } = await import('../src/server.ts')

const API_KEY = 'trash-admin-key'
const APP_ID = 'app_trash_test'
let app
let dataDir

function signES256(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = b64({ alg: 'ES256', typ: 'JWT', kid: TEST_KID })
  const body = b64(payload)
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: TEST_PRIV, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  return `${head}.${body}.${sig}`
}

const USER_TOKEN = signES256({ sub: 'usr_human1', email: 'human@test.local', app: APP_ID, exp: Math.floor(Date.now() / 1000) + 3600 })

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-trash-'))
  app = await createServer({
    port: 0,
    host: '127.0.0.1',
    dataDir,
    apiKey: API_KEY,
    maxFileSize: 500 * 1024 * 1024,
    publicUrl: '',
    premiumUserIds: [],
    adminUsers: [],
    letmeuseAppSecret: '',
    letmeuseAppId: APP_ID,
    globalCapacityBytes: 500 * 1024 * 1024 * 1024,
  })
  await app.ready()
  // 等 jwks-cache 把測試公鑰抓進快取 (import 時觸發的 refresh 是非同步的)
  for (let i = 0; i < 20; i++) {
    const probe = await app.inject({ method: 'GET', url: '/api/user/storage', headers: { authorization: `Bearer ${USER_TOKEN}` } })
    if (probe.statusCode === 200) break
    await new Promise((r) => setTimeout(r, 100))
  }
})

after(async () => {
  if (app) await app.close()
  jwksServer.close()
})

function multipart(fields) {
  const boundary = '----pktrash' + Math.random().toString(16).slice(2)
  const chunks = []
  for (const f of fields) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"`
    if (f.filename !== undefined) head += `; filename="${f.filename}"`
    head += '\r\n'
    if (f.contentType) head += `Content-Type: ${f.contentType}\r\n`
    head += '\r\n'
    chunks.push(Buffer.from(head), Buffer.from(String(f.value)), Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

async function uploadAs(token, fname) {
  const mp = multipart([{ name: 'file', filename: fname, contentType: 'text/plain', value: 'trash-test' }])
  const res = await app.inject({
    method: 'POST', url: '/upload',
    headers: { authorization: `Bearer ${token}`, 'content-type': mp.contentType },
    payload: mp.body,
  })
  assert.equal(res.statusCode, 200)
  return res.json()
}

test('human delete → trash → share link dead → restore → link alive again', async () => {
  const up = await uploadAs(USER_TOKEN, 'precious.txt')
  const auth = { authorization: `Bearer ${USER_TOKEN}` }

  // live before delete
  assert.equal((await app.inject({ method: 'GET', url: `/f/${up.id}`, headers: { accept: 'text/html' } })).statusCode, 200)

  const del = await app.inject({ method: 'DELETE', url: `/files/${up.id}`, headers: auth })
  assert.equal(del.statusCode, 200)
  assert.equal(del.json().trashed, true, 'human delete must be soft')

  // share link + listing both dead
  assert.equal((await app.inject({ method: 'GET', url: `/f/${up.id}`, headers: { accept: 'text/html' } })).statusCode, 404)
  const files = (await app.inject({ method: 'GET', url: '/files?limit=50', headers: auth })).json()
  assert.ok(!files.some((f) => f.id === up.id), 'trashed file hidden from listing')

  // visible in trash
  const trash = (await app.inject({ method: 'GET', url: '/api/trash', headers: auth })).json()
  assert.ok(trash.some((f) => f.id === up.id))

  // restore brings it back
  assert.equal((await app.inject({ method: 'POST', url: `/api/trash/${up.id}/restore`, headers: auth })).statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: `/f/${up.id}`, headers: { accept: 'text/html' } })).statusCode, 200)
})

test('admin API key delete stays HARD (no trash semantics for machines)', async () => {
  const up = await uploadAs(API_KEY, 'machine.txt')
  const del = await app.inject({ method: 'DELETE', url: `/files/${up.id}`, headers: { authorization: `Bearer ${API_KEY}` } })
  assert.equal(del.statusCode, 200)
  assert.equal(del.json().trashed, undefined, 'admin delete is permanent')
  const trash = (await app.inject({ method: 'GET', url: '/api/trash', headers: { authorization: `Bearer ${API_KEY}` } })).json()
  assert.ok(!trash.some((f) => f.id === up.id))
})

test('purge one + empty trash are permanent; other users cannot touch my trash', async () => {
  const a = await uploadAs(USER_TOKEN, 'purge-me.txt')
  const auth = { authorization: `Bearer ${USER_TOKEN}` }
  await app.inject({ method: 'DELETE', url: `/files/${a.id}`, headers: auth })

  // another (non-admin) user cannot restore mine
  const OTHER = signES256({ sub: 'usr_other', email: 'other@test.local', app: APP_ID, exp: Math.floor(Date.now() / 1000) + 3600 })
  assert.equal((await app.inject({ method: 'POST', url: `/api/trash/${a.id}/restore`, headers: { authorization: `Bearer ${OTHER}` } })).statusCode, 403)

  // purge one permanently
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/trash/${a.id}`, headers: auth })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: `/api/trash/${a.id}/restore`, headers: auth })).statusCode, 404)

  // empty trash
  const b = await uploadAs(USER_TOKEN, 'bulk1.txt')
  await app.inject({ method: 'DELETE', url: `/files/${b.id}`, headers: auth })
  const emptied = await app.inject({ method: 'DELETE', url: '/api/trash', headers: auth })
  assert.equal(emptied.statusCode, 200)
  assert.ok(emptied.json().purged >= 1)
  assert.equal(((await app.inject({ method: 'GET', url: '/api/trash', headers: auth })).json()).length, 0)
})

test('re-uploading identical content does NOT resurrect a trashed file (dedup excludes trash)', async () => {
  const a = await uploadAs(USER_TOKEN, 'dedup-check.txt')
  const auth = { authorization: `Bearer ${USER_TOKEN}` }
  await app.inject({ method: 'DELETE', url: `/files/${a.id}`, headers: auth })
  const b = await uploadAs(USER_TOKEN, 'dedup-check.txt')
  assert.notEqual(b.id, a.id, 'new upload must get a NEW id, not the trashed one')
  assert.equal((await app.inject({ method: 'GET', url: `/f/${b.id}`, headers: { accept: 'text/html' } })).statusCode, 200)
})
