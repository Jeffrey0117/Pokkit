// 方案頁是獨立的行銷頁 (不套後台的殼);首頁最上面就寫出免費與訂閱各多少容量;
// 兩邊都有一張跟 LINE、Google 雲端硬碟的對比表。
// 2026-11-11 之前:方案頁套在後台裡 (沒登入的人看到一條只有「升級」的側欄,內容靠左半邊空著),
// Pro 的賣點有一條是錯的 (「大檔分塊上傳」免費會員也有),首頁沒有寫容量。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const publicDir = path.join(import.meta.dirname, '..', 'public')
const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8')
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8')
const css = fs.readFileSync(path.join(publicDir, 'style.css'), 'utf8')
const i18nSrc = fs.readFileSync(path.join(publicDir, 'i18n.js'), 'utf8')

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

// 把 i18n.js 的中文對照表讀出來
function zhDict() {
  const win = { addEventListener() {}, localStorage: { getItem: () => 'zh' } }
  const ctx = vm.createContext({
    window: win, document: { addEventListener() {}, querySelectorAll: () => [], documentElement: {}, readyState: 'loading' },
    localStorage: win.localStorage, navigator: { language: 'zh-TW', languages: ['zh-TW'] }, MutationObserver: function () { this.observe = () => {} },
  })
  const m = i18nSrc.match(/var ZH = \{([\s\S]*?)\n  \};/)
  assert.ok(m, '讀不到 i18n.js 的中文對照表')
  return vm.runInContext(`({${m[1]}})`, ctx)
}
const zh = zhDict()

test('方案頁不套後台的殼:開機腳本與換頁都把它當成獨立頁', () => {
  assert.match(html, /seg === 'pricing'[\s\S]{0,200}page-pricing/, '開機腳本沒有在第一次畫面就切成獨立頁')
  const nav = extract('navigate')
  assert.match(nav, /classList\.toggle\('page-pricing', route === 'pricing'\)/)
  assert.match(nav, /if \(route === 'pricing'\) setMode\(false\)/)
  assert.match(css, /body\.page-pricing \.pricing-section/)
})

test('首頁最上面寫出免費與訂閱各多少容量,數字跟方案設定同一個來源', () => {
  const hero = html.slice(html.indexOf('class="hero landing-only"'), html.indexOf('id="dropzone"'))
  for (const id of ['heroFreeGB', 'heroProGB', 'heroProPrice']) assert.ok(hero.includes(`id="${id}"`), `首頁頂部少了 #${id}`)
  assert.match(hero, /data-route="pricing"/)
  const fill = extract('fillPlanNumbers')
  for (const id of ['heroFreeGB', 'heroProGB', 'heroProPrice', 'priceFreeAmount', 'priceProAmount']) assert.ok(fill.includes(id), `fillPlanNumbers 沒有填 #${id}`)
  assert.match(app, /'\/api\/tiers'/)
})

test('Pro 的賣點沒有免費也有的東西,按鈕不寫 PRO', () => {
  assert.ok(!html.includes('Large files via chunked upload'), '分塊上傳免費會員也有,不是 Pro 的賣點')
  assert.ok(!/pro/i.test(zh['Upgrade to Pro']), `升級按鈕的中文是「${zh['Upgrade to Pro']}」`)
  assert.ok(!html.includes('Start free. Upgrade when your memories outgrow it.'), '舊定位 (相簿) 的標語還在')
})

test('對比表:對手是 LINE 和 Google 雲端硬碟,首頁和方案頁用同一份資料', () => {
  const ctx = vm.createContext({})
  const src = app.slice(app.indexOf('var COMPARE_ROWS = ['), app.indexOf('];', app.indexOf('var COMPARE_ROWS = [')) + 2)
  vm.runInContext(src.replace('var COMPARE_ROWS', 'this.COMPARE_ROWS'), ctx)
  const rows = ctx.COMPARE_ROWS
  assert.ok(rows.length >= 5)
  for (const r of rows) {
    for (const k of ['label', 'pokkit', 'line', 'google']) {
      assert.ok(typeof r[k] === 'string' && r[k].length > 0, `對比表有一格是空的: ${JSON.stringify(r)}`)
      assert.ok(zh[r[k]], `「${r[k]}」沒有中文`)
    }
  }
  // 不能寫 Pokkit 不壓縮:相片庫的影片會轉成 1080p
  assert.ok(!rows.some((r) => /compress|壓縮|original quality|原畫質/i.test(r.pokkit + zh[r.pokkit])))
  assert.equal((html.match(/class="compare"/g) || []).length, 2, '首頁和方案頁各要有一張對比表')
  assert.match(extract('renderCompare'), /COMPARE_ROWS/)
  for (const head of ['LINE', 'Google Drive']) assert.ok(extract('renderCompare').includes(head))
})

test('方案頁有「也可以自己架」,自架的站不顯示這些', () => {
  const pricing = html.slice(html.indexOf('id="pricingSection"'), html.indexOf('id="projectsSection"'))
  assert.match(pricing, /github\.com\/Jeffrey0117\/Pokkit/)
  assert.match(css, /\.self-hosted \.hero-plans/)
})
