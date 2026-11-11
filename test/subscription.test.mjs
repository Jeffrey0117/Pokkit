// Pokkit 問 PayGate「這個人有沒有訂閱」。這裡把 PayGate 換成假的回應,
// 確認付了錢的人真的拿到 Pro,以及 PayGate 出狀況時不會把他們降成免費。
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.POKKIT_LOG = 'silent'
const { checkPremium, clearSubscriptionCache } = await import('../src/subscription.ts')
const { STORAGE_TIERS } = await import('../src/config.ts')

const realFetch = globalThis.fetch
let calls
let respond

// PayGate 實際回的樣子 (paygate subscriptions.js checkSubscription)
const paid = () => ({ active: true, tier: 'Pro', plan_id: 'pokkit-pro-monthly', quotas: { maxBytes: 21474836480 }, end_date: '2026-12-11T00:00:00.000Z' })
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  clearSubscriptionCache()
  calls = []
  respond = () => json({ active: false })
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} })
    return respond()
  }
})
afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.PAYGATE_TOKEN
})

const check = (email) => checkPremium(email, 'user-1', [])

test('付了錢的人是 Pro', async () => {
  // PayGate 回的欄位是 active。之前讀的是 has_subscription (PayGate 從來沒有這個欄位),
  // 所以就算付款成功也永遠是 Free。
  respond = () => json(paid())
  const tier = await check('buyer@example.com')
  assert.equal(tier.isPremium, true)
  assert.equal(tier.tier, STORAGE_TIERS.premium.name)
  assert.equal(tier.maxBytes, STORAGE_TIERS.premium.maxBytes)
})

test('沒訂閱的人是 Free', async () => {
  const tier = await check('nobody@example.com')
  assert.equal(tier.isPremium, false)
  assert.equal(tier.maxBytes, STORAGE_TIERS.free.maxBytes)
})

test('PayGate 回錯誤時,付費用戶維持 Pro', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] })
  respond = () => json(paid())
  await check('buyer@example.com')

  for (const broken of [() => json({ error: 'Too many requests' }, 429), () => json({ error: 'Internal error' }, 500), () => { throw new Error('ECONNREFUSED') }]) {
    t.mock.timers.tick(6 * 60 * 1000) // 快取過期,得再問一次
    respond = broken
    assert.equal((await check('buyer@example.com')).isPremium, true)
  }
})

test('回應長得不對 (沒有 active 欄位) 當成查不到,不當成沒訂閱', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] })
  respond = () => json(paid())
  await check('buyer@example.com')
  t.mock.timers.tick(6 * 60 * 1000)
  respond = () => new Response('<html>502 Bad Gateway</html>', { status: 200 })
  assert.equal((await check('buyer@example.com')).isPremium, true)
  t.mock.timers.tick(6 * 60 * 1000)
  respond = () => json({ has_subscription: true })
  assert.equal((await check('buyer@example.com')).isPremium, true)
})

test('PayGate 恢復後,以它的新答案為準', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] })
  respond = () => json(paid())
  await check('buyer@example.com')
  t.mock.timers.tick(6 * 60 * 1000)
  respond = () => json({ active: false, expired: true })
  assert.equal((await check('buyer@example.com')).isPremium, false, '真的過期了就是 Free')
})

test('查不到又沒有舊紀錄時是 Free,但很快會再問一次', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] })
  respond = () => { throw new Error('ECONNREFUSED') }
  assert.equal((await check('buyer@example.com')).isPremium, false)
  respond = () => json(paid())
  assert.equal((await check('buyer@example.com')).isPremium, false, '30 秒內不重問,免得 PayGate 掛掉時每個請求都去敲它')
  t.mock.timers.tick(31 * 1000)
  assert.equal((await check('buyer@example.com')).isPremium, true)
})

test('剛付完錢的人不用等五分鐘', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] })
  assert.equal((await check('buyer@example.com')).isPremium, false)
  respond = () => json(paid())
  t.mock.timers.tick(16 * 1000)
  assert.equal((await check('buyer@example.com')).isPremium, true, 'Free 的結果只記 15 秒')

  const before = calls.length
  t.mock.timers.tick(60 * 1000)
  await check('buyer@example.com')
  assert.equal(calls.length, before, 'Pro 的結果記 5 分鐘,不會每次都問')
})

test('Email 大小寫與前後空白不影響', async () => {
  respond = () => json(paid())
  await check('  Buyer@Example.COM ')
  await check('buyer@example.com')
  assert.equal(calls.length, 1, '同一個人只問一次')
  assert.match(calls[0].url, /email=buyer%40example\.com&product=pokkit/)
})

test('有設 PAYGATE_TOKEN 就帶上,PayGate 才不會把所有用戶算成同一個訪客', async () => {
  process.env.PAYGATE_TOKEN = 'test-token'
  await check('buyer@example.com')
  assert.equal(calls[0].headers.Authorization, 'Bearer test-token')
  clearSubscriptionCache()
  delete process.env.PAYGATE_TOKEN
  await check('buyer@example.com')
  assert.equal(calls[1].headers.Authorization, undefined)
})

test('管理者與手動名單不用問 PayGate', async () => {
  assert.equal((await checkPremium('a@example.com', 'admin', [])).isPremium, true)
  assert.equal((await checkPremium('b@example.com', 'vip-7', ['vip-7'])).isPremium, true)
  assert.equal((await checkPremium('', 'user-9', [])).isPremium, false)
  assert.equal(calls.length, 0)
})
