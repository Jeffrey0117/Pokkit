// 「卡住偵測」不能把慢網路上還在排隊的檔案當成斷線。
// 2026-11-11 實案:會員一次丟 9 張 (各 2~3MB),上行慢,9 路同時搶頻寬,
// 輪不到的那幾路 10 秒沒動就被砍掉重傳 (從 0 開始,更塞),三次後判失敗 —
// 9 張只進了 2 張,另外 7 張伺服器連請求都沒收到。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const app = fs.readFileSync(path.join(import.meta.dirname, '..', 'public', 'app.js'), 'utf8')

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

const ctx = vm.createContext({ STALL_ALL_MS: 10000, STALL_ONE_MS: 60000 })
vm.runInContext(extract('uploadStalled'), ctx)
const stalled = (ownIdle, anyIdle) => ctx.uploadStalled(100000, 100000 - ownIdle, 100000 - anyIdle)

test('別的檔案還在傳,自己只是輪不到 → 不算卡住', () => {
  assert.equal(stalled(15000, 500), false)
  assert.equal(stalled(45000, 2000), false)
})

test('全部檔案都 10 秒沒動 → 連線死了,砍掉重來', () => {
  assert.equal(stalled(11000, 11000), true)
  assert.equal(stalled(9000, 9000), false)
})

test('自己整整一分鐘沒動 → 不管別人,砍掉重來', () => {
  assert.equal(stalled(61000, 500), true)
})

test('門檻與接線', () => {
  assert.match(app, /var STALL_ALL_MS = 10000;/)
  assert.match(app, /var STALL_ONE_MS = 60000;/)
  const upload = extract('uploadFile')
  assert.match(upload, /uploadStalled\(Date\.now\(\), lastProgressAt, lastAnyProgressAt\)/)
  assert.match(upload, /lastAnyProgressAt = lastProgressAt = Date\.now\(\)/, '每次有進度都要更新「全體」的時間')
  // 檔案本體送完之後只剩等伺服器回應,這段沒有進度事件,不能再用「沒進度」判卡住
  assert.match(upload, /xhr\.upload\.addEventListener\('load', clearStallTimer\)/)
})
