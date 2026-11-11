// 把檔案拖到資料夾卡片上 = 傳進那個資料夾;人在資料夾裡時,頁面上方那塊上傳區就是傳進這個資料夾。
// 2026-11-11 之前:卡片不接檔案,資料夾裡另外多一塊「拖曳照片到這裡或點擊上傳」,跟上方那塊重複。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const publicDir = path.join(import.meta.dirname, '..', 'public')
const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8')
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8')
const css = fs.readFileSync(path.join(publicDir, 'style.css'), 'utf8')
const i18n = fs.readFileSync(path.join(publicDir, 'i18n.js'), 'utf8')

// 從 app.js 取出一個具名函式的原始碼,單獨執行
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

function load(names, globals) {
  const ctx = vm.createContext({ ...globals })
  vm.runInContext(names.map(extract).join('\n'), ctx)
  return ctx
}

test('資料夾裡不再有第二塊上傳區', () => {
  assert.ok(!html.includes('galleryDropzone'), 'index.html 還有 #galleryDropzone')
  assert.ok(!app.includes('galleryDropzone'), 'app.js 還在用 galleryDropzone')
  assert.ok(!css.includes('.gallery-dropzone'), 'style.css 還留著 .gallery-dropzone')
  assert.ok(!i18n.includes('Drop photos here or click to upload'), 'i18n.js 還留著沒人用的字')
})

test('檔案加入的當下就定好要進哪個資料夾,之後換頁也不會跑掉', () => {
  const $gallerySection = { hidden: false }
  const ctx = load(['stampUploadAlbum', 'uploadAlbumFor'], { currentAlbumId: 'alb_open', $gallerySection })
  const dropped = [{}, {}]
  ctx.stampUploadAlbum(dropped, 'alb_card')
  assert.deepEqual(dropped.map((f) => ctx.uploadAlbumFor(f)), ['alb_card', 'alb_card'], '拖到卡片上 → 進那張卡片的資料夾')

  const picked = [{}]
  ctx.stampUploadAlbum(picked)
  assert.equal(ctx.uploadAlbumFor(picked[0]), 'alb_open', '沒指定 → 進目前打開的資料夾')

  // 從資料夾跳去別頁(專案頁也有上傳區):資料夾已不在畫面上,新加入的檔案不該進去
  $gallerySection.hidden = true
  const elsewhere = [{}]
  ctx.stampUploadAlbum(elsewhere)
  assert.equal(ctx.uploadAlbumFor(elsewhere[0]), '', '資料夾不在畫面上 → 不帶資料夾')
  assert.ok(extract('navigate').includes('syncDropTarget()'), 'navigate() 之後沒有更新提示')

  ctx.currentAlbumId = null
  assert.equal(ctx.uploadAlbumFor(picked[0]), 'alb_open', '離開資料夾後,已排隊的檔案目的地不變')
  ctx.stampUploadAlbum(picked, 'alb_other')
  assert.equal(ctx.uploadAlbumFor(picked[0]), 'alb_open', '重試時不會被改派')

  const loose = [{}]
  ctx.stampUploadAlbum(loose)
  assert.equal(ctx.uploadAlbumFor(loose[0]), '', '不在資料夾裡 → 不帶資料夾')
})

test('兩條上傳路徑都用檔案自己的目的地,不再看當下開著哪個資料夾', () => {
  assert.match(app, /meta\.album_id = uploadAlbumFor\(file\)/)
  assert.match(app, /fd\.append\('album_id', uploadAlbumFor\(file\)\)/)
  assert.ok(!/album_id['", ]+currentAlbumId\)?;/.test(app.replace(/photo_ids.*$/gm, '')), '上傳還在直接讀 currentAlbumId')
})

test('資料夾卡片會接住拖進來的檔案,並指定自己當目的地', () => {
  const card = extract('addAlbumCard')
  assert.match(card, /makeAlbumDropTarget\(card, album\)/)
  const target = extract('makeAlbumDropTarget')
  for (const ev of ['dragover', 'dragleave', 'drop']) assert.ok(target.includes(`'${ev}'`), `卡片沒有處理 ${ev}`)
  assert.match(target, /handleDrop\(e\.dataTransfer, album\.id\)/)
  assert.match(target, /stopPropagation\(\)/)
  assert.match(css, /\.album-card\.dragover/)
})

test('只有從電腦拖進來的檔案才算,拖頁面上自己的縮圖不算', () => {
  const ctx = load(['isFileDrag'], { pageDragActive: false })
  assert.equal(ctx.isFileDrag({ dataTransfer: { types: ['Files'] } }), true)
  assert.equal(ctx.isFileDrag({ dataTransfer: { types: ['text/plain'] } }), false)
  ctx.pageDragActive = true
  assert.equal(ctx.isFileDrag({ dataTransfer: { types: ['Files', 'text/uri-list'] } }), false)
})

test('人在資料夾裡時,上方上傳區寫明會傳進哪個資料夾', () => {
  assert.ok(html.includes('id="dropTarget"'), 'index.html 少了 #dropTarget')
  assert.ok(i18n.includes("'Uploads go into':"), 'i18n.js 少了「Uploads go into」的翻譯')

  const el = { hidden: true, textContent: '' }
  const ctx = load(['syncDropTarget'], {
    currentAlbumId: 'alb_1',
    currentAlbumName: '商業資料',
    $gallerySection: { hidden: false },
    document: { getElementById: (id) => (id === 'dropTarget' ? el : null) },
    window: { t: (s) => (s === 'Uploads go into' ? '會傳進' : s) },
  })
  ctx.syncDropTarget()
  assert.equal(el.hidden, false)
  assert.equal(el.textContent, '會傳進「商業資料」')

  ctx.currentAlbumId = null
  ctx.syncDropTarget()
  assert.equal(el.hidden, true)

  for (const fn of ['openAlbum', 'switchTab', 'deleteAlbum', 'renameAlbum']) {
    assert.ok(extract(fn).includes('syncDropTarget()'), `${fn}() 之後沒有更新提示`)
  }
})
