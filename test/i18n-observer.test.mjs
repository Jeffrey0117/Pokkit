// 2026-11-09 事故回歸:翻譯監聽自己改 DOM 又觸發自己,整個首頁卡死、永遠載不完。
// 用會真的回報變動的假 DOM 跑 i18n.js,迴圈一出現就會超過次數上限。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8')
const MAX_RUNS = 50

test('translating during page parse does not retrigger itself forever', () => {
  const observers = new Set()
  let runs = 0

  // 寫入 textContent 就通知「還在監聽」的 observer,跟瀏覽器一樣
  function notify() {
    for (const o of [...observers]) o.pending = true
  }
  function drain() {
    let guard = 0
    while ([...observers].some((o) => o.pending)) {
      guard += 1
      assert.ok(guard <= MAX_RUNS, 'the observer keeps retriggering itself')
      for (const o of [...observers]) {
        if (!o.pending) continue
        o.pending = false
        runs += 1
        o.callback()
      }
    }
  }

  class FakeObserver {
    constructor(callback) {
      this.callback = callback
      this.pending = false
    }
    observe() {
      observers.add(this)
    }
    disconnect() {
      observers.delete(this)
      this.pending = false
    }
  }

  const node = {
    _text: 'Drop it, share it.',
    getAttribute: () => 'Drop it, share it.',
    set textContent(value) {
      this._text = value
      notify()
    },
    get textContent() {
      return this._text
    },
  }

  const listeners = {}
  const sandbox = {
    navigator: { languages: ['zh-TW'], language: 'zh-TW' },
    localStorage: { getItem: () => null, setItem() {} },
    MutationObserver: FakeObserver,
    CustomEvent: class {},
    document: {
      documentElement: {},
      readyState: 'loading',
      querySelectorAll: (sel) => (sel === '[data-i18n]' ? [node] : []),
      addEventListener: (name, fn) => { listeners[name] = fn },
      dispatchEvent() {},
      getElementById: () => null,
    },
  }
  sandbox.window = sandbox
  vm.runInNewContext(source, sandbox)

  // 解析器塞進新節點
  notify()
  drain()
  assert.ok(runs >= 1, 'it should translate during parsing')
  assert.equal(node.textContent, '隨手一丟就分享')

  // app.js 接手後不能再被蓋回去
  sandbox.window.__i18nFinish()
  node._text = 'changed by app.js'
  notify()
  drain()
  assert.equal(node.textContent, 'changed by app.js')
})
