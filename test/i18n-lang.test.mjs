// 語言跟著瀏覽器走:中文使用者一看到就是中文,其他人英文;自己切過就記住。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8')

function langFor({ languages, language, stored = null }) {
  const store = new Map(stored ? [['pokkit_lang', stored]] : [])
  const empty = () => []
  const sandbox = {
    navigator: { languages, language },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    },
    document: {
      documentElement: {},
      querySelectorAll: empty,
      addEventListener() {},
      readyState: 'loading',
      getElementById: () => null,
    },
  }
  sandbox.window = sandbox
  vm.runInNewContext(source, sandbox)
  return sandbox.window.t('1 hour') === '1 小時' ? 'zh' : 'en'
}

test('a Traditional Chinese browser sees Chinese', () => {
  assert.equal(langFor({ languages: ['zh-TW', 'en'], language: 'zh-TW' }), 'zh')
})

test('a Simplified Chinese browser sees Chinese', () => {
  assert.equal(langFor({ languages: ['zh-CN'], language: 'zh-CN' }), 'zh')
})

test('Chinese listed second still counts as a Chinese user', () => {
  assert.equal(langFor({ languages: ['en-US', 'zh-TW'], language: 'en-US' }), 'zh')
})

test('an English browser sees English', () => {
  assert.equal(langFor({ languages: ['en-US', 'en'], language: 'en-US' }), 'en')
})

test('a Japanese browser falls back to English', () => {
  assert.equal(langFor({ languages: ['ja'], language: 'ja' }), 'en')
})

test('a choice the user made beats the browser', () => {
  assert.equal(langFor({ languages: ['zh-TW'], language: 'zh-TW', stored: 'en' }), 'en')
  assert.equal(langFor({ languages: ['en-US'], language: 'en-US', stored: 'zh' }), 'zh')
})

test('the landing copy makes no trust or privacy promises', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
  const manifest = fs.readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8')
  for (const text of [html, source, manifest]) {
    assert.doesNotMatch(text, /somewhere you trust|No scanning|AI training|privacy by design|Private by Design|data resale/i)
  }
})
