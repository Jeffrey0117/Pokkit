// 捲到底自動載下一頁:只有清單「看得到」的時候才續載。
//
// 2026-11-14 實案:人在「照片」頁,首頁的檔案清單是藏起來的。藏起來的元素量出來
// 位置全是 0,被當成「還在畫面裡」,於是一頁接一頁把 35 頁 (一千多個檔案) 全載完,
// 每一列的縮圖跟著載 —— 12 秒內 1033 個請求,撞到主機前面每分鐘 1000 次的上限,
// 使用者看到 Too many requests。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import vm from 'node:vm'

const appJs = fs.readFileSync(path.join(import.meta.dirname, '..', 'public', 'app.js'), 'utf8')

function extract(name) {
  const start = appJs.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `app.js 少了 ${name}()`)
  let depth = 0
  for (let i = appJs.indexOf('{', start); i < appJs.length; i++) {
    if (appJs[i] === '{') depth++
    if (appJs[i] === '}' && --depth === 0) return appJs.slice(start, i + 1)
  }
  throw new Error(`${name}() 沒有結尾`)
}

// 假的頁面:sentinel 的位置由 state 決定。visible=false 模擬整個清單被藏起來
// (display:none 的元素沒有任何方塊,量出來的位置全是 0)。
function harness(state) {
  const timers = []
  const sentinel = {
    style: {},
    parentNode: null,
    getClientRects: () => (state.visible ? [{}] : []),
    getBoundingClientRect: () => (state.visible ? { top: state.top } : { top: 0 }),
    remove() { this.parentNode = null },
  }
  const container = { appendChild(el) { el.parentNode = container } }
  const sandbox = vm.createContext({
    document: { createElement: () => sentinel },
    window: { innerHeight: 800 },
    IntersectionObserver: class { observe() {} disconnect() {} },
    setTimeout: (fn) => { timers.push(fn) },
  })
  vm.runInContext(extract('createScrollLoader'), sandbox)
  let loads = 0
  const loader = sandbox.createScrollLoader(container, () => { loads += 1 })
  const runTimers = () => { while (timers.length) timers.shift()() }
  return { loader, runTimers, loads: () => loads }
}

test('清單藏起來的時候不會自己一頁接一頁載下去', () => {
  const state = { visible: false, top: 0 }
  const h = harness(state)
  for (let page = 0; page < 35; page++) {
    h.loader.bump()
    h.runTimers()
  }
  assert.equal(h.loads(), 0)
})

test('清單看得到、底部還在畫面裡:繼續載,直到畫面填滿', () => {
  const state = { visible: true, top: 300 }
  const h = harness(state)
  h.loader.bump()
  h.runTimers()
  assert.equal(h.loads(), 1)
})

test('清單看得到、底部已經在畫面下方很遠:不載', () => {
  const state = { visible: true, top: 5000 }
  const h = harness(state)
  h.loader.bump()
  h.runTimers()
  assert.equal(h.loads(), 0)
})
