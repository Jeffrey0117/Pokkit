// 先讓人用,撞到容量上限才談升級。
// 2026-11-11 之前:免費會員的側欄永遠掛著「升級」按鈕、帳戶頁永遠有一張 Pro 廣告;
// 真的傳到滿的那一刻卻只有每個檔案各跳一則「Storage full」的紅字,沒有任何下一步。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const publicDir = path.join(import.meta.dirname, '..', 'public')
const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8')
const i18n = fs.readFileSync(path.join(publicDir, 'i18n.js'), 'utf8')

function extract(name) {
  const start = app.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `app.js 少了 ${name}()`)
  let depth = 0
  for (let i = app.indexOf('{', start); i < app.length; i++) {
    if (app[i] === '{') depth++
    if (app[i] === '}' && --depth === 0) return app.slice(start, i + 1)
  }
  throw new Error(`${name}() 沒有結尾`)
}

test('快滿了 (75% 以上) 才出現升級入口;已經是付費或無上限的人永遠不出現', () => {
  const ctx = vm.createContext({ NEAR_FULL_PERCENT: 75 })
  vm.runInContext(extract('shouldOfferUpgrade'), ctx)
  assert.equal(ctx.shouldOfferUpgrade({ isPremium: false, usedPercent: 10 }), false)
  assert.equal(ctx.shouldOfferUpgrade({ isPremium: false, usedPercent: 75 }), true)
  assert.equal(ctx.shouldOfferUpgrade({ isPremium: false, usedPercent: 100 }), true)
  assert.equal(ctx.shouldOfferUpgrade({ isPremium: true, usedPercent: 99 }), false)
  assert.equal(ctx.shouldOfferUpgrade({ unlimited: true, isPremium: true, usedPercent: 0 }), false)
  assert.equal(ctx.shouldOfferUpgrade(null), false)

  assert.match(extract('loadStats'), /\$upgradeBtn\.hidden = !shouldOfferUpgrade\(data\)/)
  const acct = extract('loadAccount')
  assert.match(acct, /promo\.hidden = !shouldOfferUpgrade\(data\)/, '帳戶頁的 Pro 廣告也要等快滿了才出現')
  assert.match(acct, /up\.hidden = !!data\.isPremium/, '帳戶頁用量條旁的升級按鈕留給所有免費會員')
})

function wallContext(storageInfo) {
  const shown = []
  const went = []
  let now = 1_000_000
  const ctx = vm.createContext({
    QUOTA_WALL_QUIET_MS: 5 * 60 * 1000,
    quotaWallShownAt: 0,
    lastStorageInfo: storageInfo,
    Date: { now: () => now },
    window: { t: (s) => s },
    formatBytes: (b) => `${b / (1024 * 1024 * 1024)} GB`,
    confirmDialog: (msg, opts) => { shown.push({ msg, opts }); return { then: (fn) => fn(true) } },
    navigate: (route) => went.push(route),
    scheduleStatsRefresh: () => {},
  })
  vm.runInContext(extract('quotaWall'), ctx)
  return { ctx, shown, went, tick: (ms) => { now += ms } }
}

test('撞到上限:跳一次對話框,寫明用了多少,按下去到方案頁', () => {
  const { ctx, shown, went, tick } = wallContext({ isPremium: false })
  const body = { usedBytes: 2 * 1024 ** 3, maxBytes: 2 * 1024 ** 3, tier: 'Free' }
  ctx.quotaWall(body)
  assert.equal(shown.length, 1)
  assert.match(shown[0].msg, /Your space is full\./)
  assert.match(shown[0].msg, /2 GB/)
  assert.equal(shown[0].opts.okLabel, 'See plans')
  assert.equal(shown[0].opts.danger, false)
  assert.deepEqual(went, ['pricing'])

  // 同一批的其他檔案也會撞牆,不能每個都跳
  ctx.quotaWall(body)
  ctx.quotaWall(body)
  assert.equal(shown.length, 1)
  tick(6 * 60 * 1000)
  ctx.quotaWall(body)
  assert.equal(shown.length, 2, '隔一陣子再撞到,要再提醒一次')
})

test('付費的人撞到上限:不推銷,只說清出空間', () => {
  const { ctx, shown, went } = wallContext({ isPremium: true })
  ctx.quotaWall({ usedBytes: 20 * 1024 ** 3, maxBytes: 20 * 1024 ** 3, tier: 'Pro' })
  assert.equal(shown.length, 1)
  assert.match(shown[0].msg, /Delete some files to make room\./)
  assert.notEqual(shown[0].opts.okLabel, 'See plans')
  assert.deepEqual(went, [])
})

test('兩條上傳路徑撞到 413 都走同一個對話框,不再每個檔案跳一則紅字', () => {
  const upload = extract('uploadFile')
  assert.equal((upload.match(/quotaWall\(/g) || []).length, 2, '單次上傳與分段上傳各一處')
  assert.ok(!upload.includes("var quotaErr = 'Storage full!'"), '舊的逐檔紅字還在')
  for (const key of ['Your space is full.', 'Upgrade for more space, then upload again.', 'Delete some files to make room.']) {
    assert.ok(i18n.includes(`'${key}':`), `i18n.js 少了「${key}」`)
  }
})
