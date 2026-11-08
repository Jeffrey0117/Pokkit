// Auth tests: JWT verification (alg pinning, exp, signature, app binding, kid)
// and the tenant access helpers. Imports the TS source directly via tsx.
//
// ⚠️ 2026-11-08 重寫。原本這個檔案的七個 token 測試**全部是 HS256**，而程式碼
// 自 2026-10-25 起只收 ES256 → 每一顆都因為 `alg` 不對而被拒，於是：
//   - 從來沒有任何測試驗過「一顆真的 ES256 token 會通過」
//   - 「過期 token 被拒」那條其實測不到 exp 邏輯（它在更早的 alg 檢查就死了）
//   - 真正的洞 `if (payload.exp && …)`（沒有 exp 的 token 永不過期）因此完全
//     隱形，測試一片綠
// 這就是 testing.md 說的「對壞碼跟好碼都綠的測試比沒測試更糟」的實例。
// 現在用真的 ES256 金鑰簽，並注入 getKey（不碰網路、不碰 LetMeUse）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { verifyLetMeUseToken, canAccessEntry, canAccessAlbum } from '../src/auth.ts'

const APP = 'pokkit'
const SECRET = 'test-signing-secret' // 只拿來模擬「secret 外洩後自簽」的攻擊

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

// ES256 測試金鑰（每次跑都新產生，不碰任何真金鑰）
const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
const attacker = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
const KID = 'test-kid'
const getKey = (kid) => (kid === KID ? kp.publicKey : null)

/** 簽一顆 ES256 token。header 覆寫放最後 → 負面測試可以在**簽之前**改 kid。 */
function es256(payload, { key = kp.privateKey, header = {}, der = false } = {}) {
  const h = { alg: 'ES256', typ: 'JWT', kid: KID, ...header }
  if ('kid' in header && header.kid === undefined) delete h.kid
  const data = `${b64url(h)}.${b64url(payload)}`
  const sig = crypto.sign('sha256', Buffer.from(data), {
    key,
    ...(der ? {} : { dsaEncoding: 'ieee-p1363' }),
  })
  return `${data}.${sig.toString('base64url')}`
}

function hs256(payload, { secret = SECRET, header = { alg: 'HS256', typ: 'JWT' } } = {}) {
  const data = `${b64url(header)}.${b64url(payload)}`
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${sig}`
}

const future = () => Math.floor(Date.now() / 1000) + 3600
const pastTs = () => Math.floor(Date.now() / 1000) - 60

// ── 基準線（原本完全缺這一條）─────────────────────────────────────────────────
test('a genuine ES256 token is accepted and maps to the user', () => {
  const u = verifyLetMeUseToken(
    es256({ sub: 'u1', email: 'a@b.com', name: '寶寶', app: APP, exp: future() }),
    APP,
    getKey,
  )
  assert.ok(u, '真 token 必須通 —— 不然下面每一條 null 都可能是別的原因造成的')
  assert.equal(u.userId, 'u1')
  assert.equal(u.email, 'a@b.com')
  assert.equal(u.name, '寶寶')
})

// ── exp：2026-11-08 之前是活的洞 ─────────────────────────────────────────────
test('🔒 a token with NO exp is rejected (舊碼 `payload.exp &&` → 永不過期)', () => {
  // 這是 4h exp 之外唯一的撤銷機制失效的樣子：登出、停用帳號都靠 exp。
  assert.equal(verifyLetMeUseToken(es256({ sub: 'u1', app: APP }), APP, getKey), null)
})

test('🔒 a string exp is rejected (NaN 比較恆為 false → 躲過)', () => {
  const token = es256({ sub: 'u1', app: APP, exp: String(future()) })
  assert.equal(verifyLetMeUseToken(token, APP, getKey), null)
})

test('expired token is rejected', () => {
  assert.equal(verifyLetMeUseToken(es256({ sub: 'u1', app: APP, exp: pastTs() }), APP, getKey), null)
})

test('🔒 nbf in the future is rejected (舊碼沒檢查)', () => {
  const now = Math.floor(Date.now() / 1000)
  const token = es256({ sub: 'u1', app: APP, exp: now + 3600, nbf: now + 600 })
  assert.equal(verifyLetMeUseToken(token, APP, getKey), null)
})

// ── alg / 簽章 ───────────────────────────────────────────────────────────────
test('HS256 token is rejected even with the correct secret (2026-10-25 資安事件後廢除 — secret 洩漏仍免疫)', () => {
  const u = verifyLetMeUseToken(hs256({ sub: 'u1', email: 'a@b.com', app: APP, exp: future() }), APP, getKey)
  assert.equal(u, null)
})

test('alg=none is rejected (no signature bypass)', () => {
  const data = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: 'u1', app: APP, exp: future() })}`
  assert.equal(verifyLetMeUseToken(`${data}.`, APP, getKey), null)
})

test('token signed with another key is rejected (same kid, attacker key)', () => {
  const forged = es256({ sub: 'u1', app: APP, exp: future() }, { key: attacker.privateKey })
  assert.equal(verifyLetMeUseToken(forged, APP, getKey), null)
})

test('a swapped payload is rejected (驗簽在解析 payload 之前)', () => {
  const [h, , sig] = es256({ sub: 'u1', app: APP, exp: future() }).split('.')
  const evil = b64url({ sub: 'admin', app: APP, exp: future() })
  assert.equal(verifyLetMeUseToken(`${h}.${evil}.${sig}`, APP, getKey), null)
})

test('🔒 DER-encoded signature is rejected (JWS 規定 raw r||s)', () => {
  const token = es256({ sub: 'u1', app: APP, exp: future() }, { der: true })
  assert.equal(verifyLetMeUseToken(token, APP, getKey), null)
})

test('🔒 a non-canonical signature spelling is rejected', () => {
  // 86 個 base64url 字元帶 516 bits 而簽章只有 512 → 最後一個字元有 4 個自由
  // 位元, 同一個簽章有 16 種等價寫法, 舊碼(只檢查長度)全部接受。只要以後有
  // 任何東西以 token 字串當 key(撤銷黑名單 / 重放快取 / 限流桶), 就能繞過。
  const token = es256({ sub: 'u1', app: APP, exp: future() })
  const [h, p, sig] = token.split('.')
  const bytes = Buffer.from(sig, 'base64url')
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let alt = null
  for (const c of ALPHA) {
    if (c === sig[sig.length - 1]) continue
    const cand = sig.slice(0, -1) + c
    if (Buffer.from(cand, 'base64url').equals(bytes)) { alt = cand; break }
  }
  assert.ok(alt, '應該找得到同義寫法')
  assert.ok(verifyLetMeUseToken(`${h}.${p}.${sig}`, APP, getKey), '正規寫法要通')
  assert.equal(verifyLetMeUseToken(`${h}.${p}.${alt}`, APP, getKey), null, '同義寫法要擋')
})

// ── kid ──────────────────────────────────────────────────────────────────────
test('🔒 unknown kid is rejected even though the signature is valid', () => {
  // kid 要在**簽之前**就改掉, 否則簽章本身壞了, 那樣的 null 證明不了 kid 檢查。
  const token = es256({ sub: 'u1', app: APP, exp: future() }, { header: { kid: 'rotated-away' } })
  assert.equal(verifyLetMeUseToken(token, APP, getKey), null)
})

test('🔒 missing kid is rejected (沒 kid 只能猜, 猜第一把 = 輪換期漏洞)', () => {
  const token = es256({ sub: 'u1', app: APP, exp: future() }, { header: { kid: undefined } })
  assert.equal(verifyLetMeUseToken(token, APP, getKey), null)
})

// ── 租戶邊界 ─────────────────────────────────────────────────────────────────
test("another app's token cannot be borrowed", () => {
  const token = es256({ sub: 'u1', app: 'other-app', exp: future() })
  assert.equal(verifyLetMeUseToken(token, APP, getKey), null)
})

test('🔒 a token with no app claim is rejected', () => {
  assert.equal(verifyLetMeUseToken(es256({ sub: 'u1', exp: future() }), APP, getKey), null)
})

test('🔒 missing appId fails closed (JWKS 全 app 共用金鑰, app claim 是唯一的租戶邊界)', () => {
  // 舊碼寫 `if (appId && …)` → 自己忘了設 LETMEUSE_APP_ID 就接受全生態的人。
  const token = es256({ sub: 'u1', app: APP, exp: future() })
  assert.equal(verifyLetMeUseToken(token, '', getKey), null)
})

// ── sub ──────────────────────────────────────────────────────────────────────
test('🔒 a non-string sub is rejected (會直接當 DB 的 key)', () => {
  for (const sub of [undefined, '', 42, { a: 1 }, null]) {
    const token = es256({ sub, app: APP, exp: future() })
    assert.equal(verifyLetMeUseToken(token, APP, getKey), null, JSON.stringify(sub))
  }
})

// ── 格式 ─────────────────────────────────────────────────────────────────────
test('garbage / malformed token is rejected without throwing', () => {
  for (const bad of ['not.a.jwt', '', 'a.b', 'a.b.c.d', '....', null, undefined, 123, {}]) {
    assert.equal(verifyLetMeUseToken(bad, APP, getKey), null, JSON.stringify(bad))
  }
})

test('🔒 getKey throwing does not blow up the route (fail-closed, 不丟例外)', () => {
  const token = es256({ sub: 'u1', app: APP, exp: future() })
  const boom = () => { throw new Error('jwks exploded') }
  assert.equal(verifyLetMeUseToken(token, APP, boom), null)
})

test('canAccessEntry: owner-only, admin bypass, no orphan leak', () => {
  assert.equal(canAccessEntry({ userId: 'a', email: '', isAdmin: false }, { user_id: 'a' }), true)
  assert.equal(canAccessEntry({ userId: 'a', email: '', isAdmin: false }, { user_id: 'b' }), false)
  assert.equal(canAccessEntry({ userId: 'a', email: '', isAdmin: false }, { user_id: null }), false)
  assert.equal(canAccessEntry({ userId: 'x', email: '', isAdmin: true }, { user_id: 'b' }), true)
  assert.equal(canAccessEntry({ userId: 'x', email: '', isAdmin: true }, { user_id: null }), true)
})

test('canAccessAlbum: owner-only, admin bypass, legacy NULL owner stays with the owner', () => {
  assert.equal(canAccessAlbum({ userId: 'a', email: '', isAdmin: false }, { user_id: 'a' }), true)
  assert.equal(canAccessAlbum({ userId: 'a', email: '', isAdmin: false }, { user_id: 'b' }), false)
  assert.equal(canAccessAlbum({ userId: 'a', email: '', isAdmin: false }, { user_id: null }), false)
  assert.equal(canAccessAlbum({ userId: 'x', email: '', isAdmin: true }, { user_id: null }), true)
})
