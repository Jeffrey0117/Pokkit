// 前端不用瀏覽器原生的 alert / prompt / confirm 視窗:手機上又小又突兀,按鈕文字也翻不了。
// 2026-11-11 之前「新增相簿」「重新命名」「收進資料夾 (要人輸入編號)」都是原生 prompt。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const publicDir = path.join(import.meta.dirname, '..', 'public')
const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8')
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8')
const i18n = fs.readFileSync(path.join(publicDir, 'i18n.js'), 'utf8')

// 去掉註解與字串裡提到這些字的地方之後,剩下的才是真的呼叫
const calls = (name) => app.split('\n')
  .map((line, i) => ({ line: line.replace(/\/\/.*$/, ''), n: i + 1 }))
  .filter(({ line }) => new RegExp(`(^|[^A-Za-z_.$])(window\\.)?${name}\\(`).test(line))

test('沒有 alert()', () => {
  assert.deepEqual(calls('alert').map((c) => c.n), [])
})

test('prompt() 與 confirm() 只剩對話框元件自己的保底', () => {
  for (const name of ['prompt', 'confirm']) {
    const found = calls(name)
    assert.equal(found.length, 1, `${name}(): ${found.map((c) => `${c.n}: ${c.line.trim()}`).join(' | ')}`)
    assert.match(found[0].line, /getElementById\('(promptModal|confirmModal)'\)|!modal/, '只在頁面上沒有對話框元件時才退回原生視窗')
  }
})

test('頁面上有對話框元件,而且文字都有中文', () => {
  for (const id of ['promptModal', 'promptForm', 'promptTitle', 'promptInput', 'promptChoices', 'promptCancel', 'promptOk']) {
    assert.ok(html.includes(`id="${id}"`), `index.html 少了 #${id}`)
  }
  for (const key of ['Album name', 'Rename album', 'Share link', 'Create', 'Close', 'Please sign in first', 'Move to folder', 'Top level', 'New filename', 'Project name']) {
    assert.ok(i18n.includes(`'${key}':`), `i18n.js 少了「${key}」的翻譯`)
  }
})

test('首屏的開機腳本與 app.js 對「沒登入能進哪些分頁」的判斷一致', () => {
  // 兩邊各有一份清單 (開機腳本要在 app.js 載入前就決定畫面),不一致的話第一次畫面會跳
  const routes = (src) => (src.match(/DASH_ROUTES = \[([^\]]+)\]/) || [])[1]
  assert.equal(routes(html), routes(app))
  assert.match(app, /var PUBLIC_DASH_ROUTES = \['pricing'\]/)
  assert.match(html, /mayBeSignedIn \|\| seg === 'pricing'/)
})
