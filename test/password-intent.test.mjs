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
