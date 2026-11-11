// 點資料夾卡片先跳出預覽視窗 (看得到裡面有什麼),在視窗裡再點一下才真的進去。
// 2026-11-11 之前:點卡片直接換頁進資料夾。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const publicDir = path.join(import.meta.dirname, '..', 'public')
const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8')
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8')
const css = fs.readFileSync(path.join(publicDir, 'style.css'), 'utf8')

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

test('頁面上有預覽視窗', () => {
  for (const id of ['albumPeek', 'albumPeekTitle', 'albumPeekCount', 'albumPeekBody', 'albumPeekOpen', 'albumPeekClose']) {
    assert.ok(html.includes(`id="${id}"`), `index.html 少了 #${id}`)
  }
  assert.match(css, /\.album-peek-card/)
  assert.match(css, /\.album-peek-grid/)
})

test('點卡片是開預覽,不是直接進去', () => {
  const card = extract('addAlbumCard')
  assert.match(card, /card\.addEventListener\('click', function \(\) \{\s*peekAlbum\(album\);/)
  assert.ok(!/addEventListener\('click', function \(\) \{\s*openAlbum\(/.test(card), '卡片點一下還是直接 openAlbum')
})

test('預覽視窗裡:點「開啟」或點照片 → 進資料夾;關閉、點外面、按 Esc → 只關視窗', () => {
  const opened = []
  const modal = { hidden: false }
  const ctx = vm.createContext({
    peekedAlbum: { id: 'alb_1', name: '商業資料' },
    document: { getElementById: (id) => (id === 'albumPeek' ? modal : null) },
    openAlbum: (id, name) => opened.push([id, name]),
  })
  vm.runInContext(extract('closeAlbumPeek') + '\n' + extract('enterPeekedAlbum'), ctx)

  ctx.enterPeekedAlbum()
  assert.deepEqual(opened, [['alb_1', '商業資料']])
  assert.equal(modal.hidden, true, '進去之後視窗要關掉')
  assert.equal(ctx.peekedAlbum, null)

  ctx.enterPeekedAlbum()
  assert.equal(opened.length, 1, '沒有預覽中的資料夾時不該再進一次')

  assert.match(app, /getElementById\('albumPeekOpen'\)\.addEventListener\('click', enterPeekedAlbum\)/)
  assert.match(app, /getElementById\('albumPeekClose'\)\.addEventListener\('click', closeAlbumPeek\)/)
  assert.match(app, /e\.target === \$albumPeek\) closeAlbumPeek\(\)/, '點視窗外面要關閉')
  assert.match(app, /!\$albumPeek\.hidden && e\.key === 'Escape'/)
  assert.match(extract('renderAlbumPeek'), /addEventListener\('click', enterPeekedAlbum\)/, '點預覽裡的照片要進資料夾')
})

test('預覽內容晚回來時,不會蓋掉後來點的另一個資料夾', () => {
  assert.match(extract('peekAlbum'), /if \(peekedAlbum !== album \|\| !data\) return;/)
})
