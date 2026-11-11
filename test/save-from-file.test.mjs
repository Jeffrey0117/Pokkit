// 一般檔案的「從磁碟上的檔案入庫」:分塊上傳組好的檔案直接搬進儲存區,
// 不把整個檔案讀進記憶體。
//
// 以前只有照片/影片有這條路,一般檔案是 readFile 整個讀進來再寫一次 ——
// 2GB 的上限下,一個檔案就能吃掉 2GB 記憶體並卡住所有請求,剛好 2GiB 還會直接失敗。
// 帶密碼或期限的影片現在也走一般檔案這條路,所以這條路不能再整檔讀進記憶體。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const { Storage } = await import('../src/storage.ts')

async function fresh() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-fromfile-'))
  const storage = new Storage(dataDir)
  await storage.init()
  const temp = (content) => {
    const p = path.join(dataDir, `incoming-${crypto.randomBytes(4).toString('hex')}.part`)
    fs.writeFileSync(p, content)
    return p
  }
  const cleanup = () => {
    try { storage.close?.() } catch { /* already closed */ }
    try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) } catch { /* Windows can still be holding the database file; a leftover temp folder must not fail the run */ }
  }
  return { storage, temp, cleanup }
}

test('the file is moved into storage and reads back byte for byte', async () => {
  const { storage, temp, cleanup } = await fresh()
  try {
    const content = crypto.randomBytes(300_000)
    const src = temp(content)
    const entry = await storage.saveFromFile('report: final.pdf', 'application/pdf', src, { userId: 'u1' })

    assert.equal(entry.filename, 'report: final.pdf', 'display name kept')
    assert.equal(entry.size, content.length)
    assert.equal(entry.hash, crypto.createHash('sha256').update(content).digest('hex'))
    assert.equal(fs.existsSync(src), false, 'moved, not copied and left behind')
    assert.ok(fs.readFileSync(storage.getPath(entry.id)).equals(content))
    assert.equal(storage.find(entry.id).user_id, 'u1')
  } finally { cleanup() }
})

test('password and expiry are applied exactly like the in-memory save', async () => {
  const { storage, temp, cleanup } = await fresh()
  try {
    const entry = await storage.saveFromFile('clip.mp4', 'video/mp4', temp('video bytes'), { password: 'pw', expiresIn: '1d', userId: 'u1' })
    assert.ok(entry.password_hash, 'has a password hash')
    assert.notEqual(entry.password_hash, 'pw', 'and it is a hash, not the password')
    assert.equal(storage.verifyPassword(entry, 'pw'), true)
    assert.equal(storage.verifyPassword(entry, 'nope'), false)
    assert.ok(Math.abs(entry.expires_at - Date.now() - 24 * 60 * 60 * 1000) < 60_000)

    const open = await storage.saveFromFile('clip.mp4', 'video/mp4', temp('other bytes'), { expiresIn: 'forever', userId: 'u1' })
    assert.ok(!open.password_hash && !open.expires_at)
  } finally { cleanup() }
})

test('identical open files are stored once; protected copies stay separate', async () => {
  const { storage, temp, cleanup } = await fresh()
  try {
    const first = await storage.saveFromFile('a.zip', 'application/zip', temp('same bytes'), { userId: 'u1' })
    const again = await storage.saveFromFile('b.zip', 'application/zip', temp('same bytes'), { userId: 'u1' })
    assert.equal(again.id, first.id)
    assert.equal(again.deduplicated, true)

    const locked = await storage.saveFromFile('c.zip', 'application/zip', temp('same bytes'), { password: 'pw', userId: 'u1' })
    assert.notEqual(locked.id, first.id, 'a locked copy is its own entry')
    const otherOwner = await storage.saveFromFile('d.zip', 'application/zip', temp('same bytes'), { userId: 'u2' })
    assert.notEqual(otherOwner.id, first.id, 'never shared across owners')
    const afterLocked = await storage.saveFromFile('e.zip', 'application/zip', temp('same bytes'), { userId: 'u1' })
    assert.equal(afterLocked.id, first.id, 'an open upload is never answered with the locked copy')
  } finally { cleanup() }
})

test('both save paths produce the same kind of entry', async () => {
  const { storage, temp, cleanup } = await fresh()
  try {
    const fromBuffer = await storage.save('x.bin', 'application/octet-stream', Buffer.from('buffer path'), { userId: 'u1' })
    const fromFile = await storage.saveFromFile('y.bin', 'application/octet-stream', temp('file path'), { userId: 'u1' })
    const shape = (entry) => Object.keys(storage.find(entry.id)).sort().join(',')
    assert.equal(shape(fromFile), shape(fromBuffer))
    for (const key of ['status', 'media_type', 'bucket', 'is_directory']) {
      assert.equal(storage.find(fromFile.id)[key], storage.find(fromBuffer.id)[key], key)
    }
  } finally { cleanup() }
})
