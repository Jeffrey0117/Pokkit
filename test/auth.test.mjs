// Auth tests: JWT verification (alg pinning, exp, signature, app binding) and
// the tenant access helpers. Imports the TS source directly via the tsx loader.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { verifyLetMeUseToken, canAccessEntry, canAccessAlbum } from '../src/auth.ts'

const SECRET = 'test-signing-secret'
const APP = 'pokkit'

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}
function hs256(payload, { secret = SECRET, header = { alg: 'HS256', typ: 'JWT' } } = {}) {
  const data = `${b64url(header)}.${b64url(payload)}`
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${sig}`
}
const future = () => Math.floor(Date.now() / 1000) + 3600
const pastTs = () => Math.floor(Date.now() / 1000) - 60

test('valid HS256 token resolves to the user', () => {
  const u = verifyLetMeUseToken(hs256({ sub: 'u1', email: 'a@b.com', app: APP, exp: future() }), SECRET, APP)
  assert.equal(u?.userId, 'u1')
  assert.equal(u?.email, 'a@b.com')
})

test('expired token is rejected', () => {
  assert.equal(verifyLetMeUseToken(hs256({ sub: 'u1', app: APP, exp: pastTs() }), SECRET, APP), null)
})

test('token signed with the wrong secret is rejected', () => {
  const forged = hs256({ sub: 'u1', app: APP, exp: future() }, { secret: 'attacker-secret' })
  assert.equal(verifyLetMeUseToken(forged, SECRET, APP), null)
})

test('alg=none is rejected (no signature bypass)', () => {
  const data = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: 'u1', app: APP })}`
  assert.equal(verifyLetMeUseToken(`${data}.`, SECRET, APP), null)
})

test("another app's token cannot be borrowed", () => {
  assert.equal(verifyLetMeUseToken(hs256({ sub: 'u1', app: 'other-app', exp: future() }), SECRET, APP), null)
})

test('missing secret fails closed even with a well-formed token', () => {
  assert.equal(verifyLetMeUseToken(hs256({ sub: 'u1', app: APP, exp: future() }), '', APP), null)
})

test('garbage / malformed token is rejected without throwing', () => {
  assert.equal(verifyLetMeUseToken('not.a.jwt', SECRET, APP), null)
  assert.equal(verifyLetMeUseToken('', SECRET, APP), null)
})

test('canAccessEntry: owner-only, admin bypass, no orphan leak', () => {
  assert.equal(canAccessEntry({ userId: 'a', email: '', isAdmin: false }, { user_id: 'a' }), true)
  assert.equal(canAccessEntry({ userId: 'a', email: '', isAdmin: false }, { user_id: 'b' }), false)
  assert.equal(canAccessEntry({ userId: 'x', email: '', isAdmin: true }, { user_id: 'b' }), true)
  assert.equal(canAccessEntry({ userId: 'a', email: '', isAdmin: false }, { user_id: null }), false)
})

test('canAccessAlbum: same ownership semantics', () => {
  assert.equal(canAccessAlbum({ userId: 'a', email: '', isAdmin: false }, { user_id: 'a' }), true)
  assert.equal(canAccessAlbum({ userId: 'a', email: '', isAdmin: false }, { user_id: 'b' }), false)
  assert.equal(canAccessAlbum({ userId: 'x', email: '', isAdmin: true }, { user_id: 'b' }), true)
  assert.equal(canAccessAlbum({ userId: 'a', email: '', isAdmin: false }, { user_id: null }), false)
})
