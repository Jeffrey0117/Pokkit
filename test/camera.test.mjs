// 在網頁裡開相機:拍一張就傳一張,傳到目前所在的資料夾。
// 瀏覽器不給用相機時退回系統相機 (一樣拍完就傳)。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import vm from 'node:vm'

const pub = path.join(import.meta.dirname, '..', 'public')
const appJs = fs.readFileSync(path.join(pub, 'app.js'), 'utf8')
const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8')
const i18n = fs.readFileSync(path.join(pub, 'i18n.js'), 'utf8')

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

function load(names, context = {}) {
  const sandbox = vm.createContext({ ...context })
  vm.runInContext(names.map(extract).join('\n'), sandbox)
  return sandbox
}

test('頁面上有拍照按鈕、相機視窗、快門,以及退回系統相機用的輸入', () => {
  assert.match(html, /<button[^>]*id="cameraBtn"/)
  assert.match(html, /id="cameraModal"[^>]*hidden/)
  assert.match(html, /<video[^>]*id="cameraVideo"[^>]*playsinline/, 'iPhone 沒有 playsinline 會變全螢幕播放器')
  assert.match(html, /id="cameraShutter"/)
  assert.match(html, /<input[^>]*id="cameraInput"[^>]*capture="environment"/)
  assert.match(i18n, /'Take photo': '拍照'/)
})

test('瀏覽器沒有相機功能時不開視窗,直接用系統相機', () => {
  const { canUseInPageCamera } = load(['canUseInPageCamera'])
  assert.equal(canUseInPageCamera({ mediaDevices: { getUserMedia() {} } }), true)
  assert.equal(canUseInPageCamera({ mediaDevices: {} }), false)
  assert.equal(canUseInPageCamera({}), false, '非 https 的頁面沒有 mediaDevices')
  assert.equal(canUseInPageCamera(undefined), false)
})

test('每張照片的檔名都不一樣,同一秒連拍也不會互相蓋掉', () => {
  const { cameraFileName } = load(['cameraFileName'])
  const at = new Date(2026, 10, 13, 9, 5, 7)
  assert.equal(cameraFileName(at, 1), 'photo-20261113-090507-1.jpg')
  assert.notEqual(cameraFileName(at, 1), cameraFileName(at, 2))
})

test('關掉相機會真的把鏡頭關掉 (不然手機上相機燈會一直亮)', () => {
  const { stopCameraStream } = load(['stopCameraStream'])
  const stopped = []
  stopCameraStream({ getTracks: () => [{ stop: () => stopped.push('a') }, { stop: () => stopped.push('b') }] })
  assert.deepEqual(stopped, ['a', 'b'])
  assert.doesNotThrow(() => stopCameraStream(null))
  assert.match(extract('closeCamera'), /stopCameraStream\(cameraStream\)/)
})

test('按下快門:照片交給平常的上傳流程,一張一張傳', () => {
  const shoot = extract('shootCamera')
  assert.match(shoot, /toBlob\(/)
  assert.match(shoot, /'image\/jpeg'/)
  assert.match(shoot, /handleFiles\(\[file\]\)/)
})

test('拍照按鈕在上傳區裡面,按它不會同時跳出選檔案', () => {
  assert.match(appJs, /cameraBtn'\)\.addEventListener\('click', function \(e\) \{\s*e\.stopPropagation\(\);\s*openCamera\(\);/)
  // 鍵盤 Enter 也一樣:只有焦點在上傳區本身才開選檔案
  assert.match(appJs, /\$dropzone\.addEventListener\('keydown', function \(e\) \{\s*if \(e\.target !== \$dropzone\) return;/)
})

// 2026-11-13:相機打得開但畫面全黑。選鏡頭時帶了 4K 的要求,瀏覽器會挑「規格最接近」
// 的那顆 —— 多鏡頭的手機、有紅外線或虛擬鏡頭的電腦上,那顆可能根本沒畫面。
test('選鏡頭時不帶解析度,交給瀏覽器用預設的那顆', () => {
  const { cameraConstraints } = load(['cameraConstraints'])
  const first = cameraConstraints(null)
  assert.equal(first.audio, false)
  assert.deepEqual(Object.keys(first.video), ['facingMode'])
  assert.deepEqual(Object.keys(cameraConstraints('cam-2').video), ['deviceId'])
  assert.equal(cameraConstraints('cam-2').video.deviceId.exact, 'cam-2')
  // 高解析度是選定之後才跟那顆鏡頭要的
  assert.match(extract('startCameraStream'), /applyConstraints\(/)
})

test('換鏡頭是把裝置上每一顆輪過一遍,不是只有前後兩顆', () => {
  const { nextCameraId } = load(['nextCameraId'])
  const devices = [
    { kind: 'audioinput', deviceId: 'mic' },
    { kind: 'videoinput', deviceId: 'a' },
    { kind: 'videoinput', deviceId: 'b' },
    { kind: 'videoinput', deviceId: 'c' },
  ]
  assert.equal(nextCameraId(devices, 'a'), 'b')
  assert.equal(nextCameraId(devices, 'c'), 'a')
  assert.equal(nextCameraId(devices, 'unknown'), 'a')
  assert.equal(nextCameraId(devices.slice(0, 2), 'a'), null, '只有一顆就沒得換')
})

test('看得出畫面是全黑的,會提示換鏡頭', () => {
  const { isBlackFrame } = load(['isBlackFrame'])
  assert.equal(isBlackFrame(new Uint8ClampedArray(4 * 16)), true)
  assert.equal(isBlackFrame(Uint8ClampedArray.from({ length: 4 * 16 }, (_, i) => (i % 4 === 3 ? 255 : 1))), true, '感光雜訊也算黑')
  assert.equal(isBlackFrame(Uint8ClampedArray.from({ length: 4 * 16 }, () => 90)), false)
  assert.equal(isBlackFrame(new Uint8ClampedArray(0)), true)
  assert.match(html, /id="cameraHint"/)
})
