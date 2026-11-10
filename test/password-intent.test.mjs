// 2026-11-11 事故回歸:上傳頁的「Password(Optional)」欄被瀏覽器自動填入已存的
// 登入密碼,使用者沒打任何字,上傳的 zip 卻被上了鎖(檔案列表顯示 locked、
// 分享頁要求輸入密碼)。Chrome 對 type=password 的欄位會無視 autocomplete="off"。
//
// 修法:只有「使用者親手打字 / 貼上」的值才算數。自動填入只會改 value 並發
// input/change,不會有 keydown / paste / beforeinput。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../public/vendor/password-intent.js', import.meta.url), 'utf8')

function load() {
  const window = {}
  vm.runInNewContext(source, { window })
  return window.PokkitPasswordIntent
}

// 夠用的假 <input>:記 listener,事件照註冊順序派送。
function fakeInput() {
  const listeners = {}
  const input = {
    value: '',
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn) },
    dispatch(type, event = {}) { for (const fn of listeners[type] || []) fn({ type, isTrusted: true, ...event }) },
  }
  return input
}

// 瀏覽器 / 密碼管理器自動填入:直接改 value,再發 input + change。
function autofill(input, value) {
  input.value = value
  input.dispatch('input')
  input.dispatch('change')
}

// 真人打字:每個字先 keydown,瀏覽器才把字放進去,再發 input。
function type(input, text) {
  for (const ch of text) {
    input.dispatch('keydown', { key: ch })
    input.value += ch
    input.dispatch('input')
  }
}

test('an autofilled password is never used and is wiped from the field', () => {
  const input = fakeInput()
  const intent = load().attach(input)
  autofill(input, 'my-saved-login-password')
  assert.equal(intent.value(), '')
  assert.equal(input.value, '', 'the field must not keep showing a value that will be ignored')
})

test('an autofill that fires no events at all is still ignored', () => {
  // 有些瀏覽器在頁面載入時靜默填值,不發任何事件。
  const input = fakeInput()
  const intent = load().attach(input)
  input.value = 'silently-filled'
  assert.equal(intent.value(), '')
  assert.equal(input.value, '')
})

test('a password the user typed is used', () => {
  const input = fakeInput()
  const intent = load().attach(input)
  type(input, 'hunter2')
  assert.equal(intent.value(), 'hunter2')
})

test('a pasted password is used', () => {
  const input = fakeInput()
  const intent = load().attach(input)
  input.dispatch('paste')
  input.value = 'pasted-secret'
  input.dispatch('input')
  assert.equal(intent.value(), 'pasted-secret')
})

test('tabbing or arrowing through an autofilled field does not adopt its value', () => {
  const input = fakeInput()
  const intent = load().attach(input)
  input.value = 'silently-filled'
  for (const key of ['Tab', 'Shift', 'ArrowLeft', 'Escape', 'Enter', 'Control']) input.dispatch('keydown', { key })
  assert.equal(intent.value(), '')
})

test('typing into an autofilled field keeps only what the user typed', () => {
  const input = fakeInput()
  const intent = load().attach(input)
  input.value = 'silently-filled' // no events → nothing cleared it yet
  type(input, 'abc')
  assert.equal(intent.value(), 'abc')
})

test('mobile / IME typing (no usable key value) still counts as the user', () => {
  const input = fakeInput()
  const intent = load().attach(input)
  input.dispatch('beforeinput', { inputType: 'insertText' })
  input.value = '密碼'
  input.dispatch('input')
  assert.equal(intent.value(), '密碼')
})

test('reset() clears the field and requires typing again', () => {
  const input = fakeInput()
  const intent = load().attach(input)
  type(input, 'first')
  intent.reset()
  assert.equal(input.value, '')
  autofill(input, 'refilled-by-browser')
  assert.equal(intent.value(), '', 'a refill after reset must not ride on the earlier typing')
})

test('surrounding whitespace is trimmed, an all-blank value is no password', () => {
  const input = fakeInput()
  const intent = load().attach(input)
  type(input, '  spaced  ')
  assert.equal(intent.value(), 'spaced')
  intent.reset()
  type(input, '   ')
  assert.equal(intent.value(), '')
})

// ── 批次:密碼在「加入檔案」那一刻就綁到每個檔上 ──
// 舊行為:每個檔開始上傳時才去讀欄位,而欄位在第一個檔傳完就被清空。同時最多傳
// 10 個,所以一次傳 25 個並設了密碼 → 只有前 10 個上鎖,後 15 個是沒密碼的公開連結,
// 使用者卻以為整批都有保護。

const fakeFiles = (n) => Array.from({ length: n }, (_, i) => ({ name: `f${i}.jpg`, size: 1 }))

test('every file in a batch gets the password, not just the first ten', () => {
  const api = load()
  const input = fakeInput()
  const intent = api.attach(input)
  type(input, 's3cret')
  const files = fakeFiles(25)
  const result = api.stampBatch(files, intent)
  assert.equal(result.password, 's3cret')
  assert.equal(result.stamped, 25)
  assert.deepEqual([...new Set(files.map((f) => api.passwordFor(f)))], ['s3cret'])
})

test('the password is consumed by the batch: the field clears and the next batch is open', () => {
  const api = load()
  const input = fakeInput()
  const intent = api.attach(input)
  type(input, 's3cret')
  api.stampBatch(fakeFiles(3), intent)
  assert.equal(input.value, '', 'field is cleared once the batch has taken the password')

  const next = fakeFiles(2)
  const result = api.stampBatch(next, intent)
  assert.equal(result.password, '')
  assert.deepEqual(next.map((f) => api.passwordFor(f)), ['', ''])
})

test('a file keeps its batch password when it is retried or re-queued later', () => {
  // 重試 / 驗證補傳會把同一個 File 物件再排一次。那時欄位早就空了(或使用者正在
  // 幫下一批打別的密碼),不能蓋掉它原本那批的密碼。
  const api = load()
  const input = fakeInput()
  const intent = api.attach(input)
  type(input, 'batch-one')
  const files = fakeFiles(2)
  api.stampBatch(files, intent)

  type(input, 'batch-two')
  const mixed = [files[0], { name: 'new.jpg', size: 1 }]
  const result = api.stampBatch(mixed, intent)
  assert.equal(api.passwordFor(files[0]), 'batch-one', 'already-stamped file is left alone')
  assert.equal(api.passwordFor(mixed[1]), 'batch-two')
  assert.equal(result.stamped, 1)
})

test('a batch added with no password stays open even if a password is typed afterwards', () => {
  const api = load()
  const input = fakeInput()
  const intent = api.attach(input)
  const files = fakeFiles(12)
  api.stampBatch(files, intent)
  type(input, 'typed-later-for-another-batch')
  assert.deepEqual([...new Set(files.map((f) => api.passwordFor(f)))], [''])
})

test('passwordFor is safe on files that were never stamped', () => {
  const api = load()
  assert.equal(api.passwordFor({ name: 'x' }), '')
  assert.equal(api.passwordFor(null), '')
  assert.equal(api.passwordFor(undefined), '')
})

test('an autofilled value never reaches a batch', () => {
  const api = load()
  const input = fakeInput()
  const intent = api.attach(input)
  autofill(input, 'my-saved-login-password')
  input.value = 'filled-again-silently'
  const files = fakeFiles(4)
  assert.equal(api.stampBatch(files, intent).password, '')
  assert.deepEqual([...new Set(files.map((f) => api.passwordFor(f)))], [''])
})

test('the upload queue takes the password per batch, not per upload start', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')

  // New helper code must not be served from a stale cached copy.
  assert.match(html, /\/vendor\/password-intent\.js\?v=2"/)

  const handleFiles = app.slice(app.indexOf('function handleFiles('), app.indexOf('function queueFiles('))
  assert.match(handleFiles, /stampUploadPassword\(files\)/, 'the batch is stamped when files are added')

  const uploadFile = app.slice(app.indexOf('function uploadFile('))
  assert.equal((uploadFile.match(/uploadPasswordFor\(file\)/g) || []).length, 2, 'both upload paths read the stamped password')
  assert.ok(!/passwordIntent\.(value|reset)\(\)/.test(uploadFile), 'uploads must not read or clear the live field')
})

test('the upload page is wired to it', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')

  const field = html.match(/<input[^>]*id="passwordInput"[^>]*>/)
  assert.ok(field, 'password field exists')
  assert.match(field[0], /autocomplete="new-password"/, 'Chrome ignores autocomplete="off" on password fields')
  assert.ok(html.indexOf('/vendor/password-intent.js') > 0, 'helper script is loaded')
  assert.ok(html.indexOf('/vendor/password-intent.js') < html.indexOf('/app.js'), 'and loaded before app.js')

  // The two upload paths must go through the intent gate, not read the raw field.
  assert.ok(!/\$passwordInput\.value\.trim\(\)/.test(app.replace(/\/\/ fallback:[^\n]*\n[^\n]*/g, '')),
    'app.js must not send $passwordInput.value directly')
  assert.match(app, /passwordIntent\.value\(\)/)
})
