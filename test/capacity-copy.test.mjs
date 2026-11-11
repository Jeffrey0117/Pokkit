// 方案頁用「約幾張照片、幾小時影片」來講容量 —— 這些數字要算得出來,而且要跟
// 方案的實際大小綁在一起。
//
// 2026-11-11 稽核:方案頁賣過兩個不存在的功能(4K 原畫質、優先轉檔)。文案是手寫
// 的,沒有任何東西把它跟程式綁住,所以程式改了、文案沒人動。這份測試就是那條線:
// 方案大小一改,這裡會紅,逼著人回去看文案還對不對。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const { STORAGE_TIERS, GB } = await import('../src/config.ts')
const { estimateCapacity, describeCapacity, PHOTO_BYTES, VIDEO_BYTES_PER_MINUTE } = await import('../src/capacity-hint.ts')

const MB = 1024 * 1024
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
const i18nSource = fs.readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8')

function chinese() {
  const store = new Map([['pokkit_lang', 'zh']])
  const sandbox = {
    navigator: { languages: ['zh-TW'], language: 'zh-TW' },
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    document: { documentElement: {}, querySelectorAll: () => [], addEventListener() {}, readyState: 'loading', getElementById: () => null },
  }
  sandbox.MutationObserver = class { observe() {} disconnect() {} }
  sandbox.window = sandbox
  vm.runInNewContext(i18nSource, sandbox)
  return sandbox.window.t
}
const pricing = html.slice(html.indexOf('id="pricingSection"'), html.indexOf('</section>', html.indexOf('id="pricingSection"')))
const card = (name) => {
  const start = pricing.indexOf(`<h3 class="price-name">${name}</h3>`)
  return pricing.slice(start, pricing.indexOf('</ul>', start))
}

// ── 換算 ──

test('the assumptions are no rosier than what is actually stored', () => {
  // 線上實測 (2026-11-11):照片平均 0.17 MB (3,771 張),影片 31.6 MB/分鐘 (930 支)
  assert.ok(PHOTO_BYTES >= 0.17 * MB, 'a photo is assumed at least as big as the measured average')
  assert.ok(VIDEO_BYTES_PER_MINUTE >= 31.6 * MB, 'a minute of video is assumed at least as big as measured')
})

test('estimates round down, never up', () => {
  assert.deepEqual(estimateCapacity(2 * GB), { photos: 10_000, videoMinutes: 60 })
  assert.deepEqual(estimateCapacity(20 * GB), { photos: 100_000, videoMinutes: 600 })
  assert.deepEqual(estimateCapacity(5 * GB), { photos: 25_000, videoMinutes: 120 })
  assert.deepEqual(estimateCapacity(500 * MB), { photos: 2_500, videoMinutes: 10 })
  for (const bytes of [2 * GB, 5 * GB, 20 * GB, 137 * MB]) {
    const { photos, videoMinutes } = estimateCapacity(bytes)
    assert.ok(photos * PHOTO_BYTES <= bytes, `${bytes}: photos fit`)
    assert.ok(videoMinutes * VIDEO_BYTES_PER_MINUTE <= bytes, `${bytes}: video fits`)
  }
})

test('the sentence reads naturally in both languages', () => {
  assert.equal(describeCapacity(2 * GB, 'en'), 'About 10,000 photos, or 1 hour of video')
  assert.equal(describeCapacity(20 * GB, 'en'), 'About 100,000 photos, or 10 hours of video')
  assert.equal(describeCapacity(500 * MB, 'en'), 'About 2,500 photos, or 10 minutes of video')
  assert.equal(describeCapacity(2 * GB, 'zh'), '約 1 萬張照片，或 1 小時影片')
  assert.equal(describeCapacity(20 * GB, 'zh'), '約 10 萬張照片，或 10 小時影片')
  assert.equal(describeCapacity(5 * GB, 'zh'), '約 2.5 萬張照片，或 2 小時影片')
  assert.equal(describeCapacity(500 * MB, 'zh'), '約 2,500 張照片，或 10 分鐘影片')
  assert.equal(describeCapacity(40 * MB, 'en'), 'About 200 photos, or 1 minute of video')
})

// ── 頁面上寫的,就是照方案大小算出來的那一句 ──

test('each plan card says what its real size holds', () => {
  const t = chinese()
  for (const [name, tier] of [['Free', STORAGE_TIERS.free], ['Pro', STORAGE_TIERS.premium]]) {
    const english = describeCapacity(tier.maxBytes, 'en')
    assert.ok(card(name).includes(`data-i18n="${english}"`), `${name} card should say: ${english}`)
    assert.equal(t(english), describeCapacity(tier.maxBytes, 'zh'), `${name} card in Chinese`)
  }
})

test('the Pro teaser on the account page uses the same numbers', () => {
  const t = chinese()
  const gb = STORAGE_TIERS.premium.maxBytes / GB
  const english = `${gb}GB — ${describeCapacity(STORAGE_TIERS.premium.maxBytes, 'en').replace(/^A/, 'a')}.`
  assert.ok(html.includes(`data-i18n="${english}"`), `account promo should say: ${english}`)
  assert.equal(t(english), `${gb}GB，${describeCapacity(STORAGE_TIERS.premium.maxBytes, 'zh')}。`)
})

test('the page does not promise features the code does not have', () => {
  // 影片一律轉成 1080p、原檔轉完即刪、沒有依方案排優先 —— 這三件事哪天真的做了,
  // 再把對應的字從這裡拿掉。i18n.js 的中文是 \u 跳脫,所以比對求值後的翻譯表。
  const appSource = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  const t = chinese()
  const keys = [...i18nSource.matchAll(/^\s+'((?:[^'\\]|\\.)+)':/gm)].map((m) => JSON.parse(`"${m[1].replace(/\\'/g, "'").replace(/"/g, '\\"')}"`))
  const translations = keys.map((key) => t(key)).join('\n')
  assert.ok(keys.length > 100, 'the translation table was read')
  // 原始檔也整份掃一次:有些條目的 key 用雙引號、中文直接寫 UTF-8,上面那條規則讀不到
  const sources = [['index.html', html], ['i18n.js as written', i18nSource], ['i18n keys', keys.join('\n')], ['i18n translations', translations], ['app.js', appSource]]
  for (const [name, text] of sources) {
    assert.doesNotMatch(text, /\b4K\b|original[ -]quality|priority processing|原畫質|優先轉檔/i, name)
  }
})
