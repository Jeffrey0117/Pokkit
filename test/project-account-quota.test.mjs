// 專案帳號 (pk_ key = 生態系內部服務) 不受零售方案的 bytes 額度管,只受磁碟/全站
// 保險絲限制。2026-11-20 回歸:CheckCut 存課程影片塞過 2GB,Pokkit 的免費方案牆
// 把整個 classroo 的影片上傳全擋死 (413 Storage full)。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkQuota } from '../src/upload-finalize.js'

const GB = 1024 ** 3

// isSelfHosted 看 letmeuseAppId;設了它 = 代管模式,才會走到方案額度那段。
const hostedConfig = {
  letmeuseAppId: 'app_test',
  premiumUserIds: [],
  globalCapacityBytes: 500 * GB,
  minFreeDiskBytes: 0, // 0 = 關掉磁碟保險絲,測試不碰真磁碟
  dataDir: '.',
}

// 這間店/帳號已經用了 3GB(超過免費 2GB)
const storageOverFree = {
  stats: () => ({ totalBytes: 10 * GB }),
  userStats: () => ({ totalBytes: 3 * GB, totalFiles: 10 }),
}

test('專案帳號超過免費 2GB 仍放行 (不受零售方案額度管)', async () => {
  const projectUser = { userId: 'checkcut', email: 'checkcut', isProject: true }
  const result = await checkQuota(projectUser, storageOverFree, hostedConfig, 50 * 1024 * 1024)
  assert.equal(result, null, '專案帳號不該被 2GB 方案牆擋下')
})

test('一般真人免費用戶超過 2GB 照樣被擋 (方案牆仍對零售生效)', async () => {
  const humanUser = { userId: 'usr_human', email: '', isProject: false }
  const result = await checkQuota(humanUser, storageOverFree, hostedConfig, 50 * 1024 * 1024)
  assert.ok(result, '免費真人用戶超過額度應被擋')
  assert.equal(result.status, 413)
  assert.match(String(result.body.error), /Storage full/)
})

test('專案帳號仍受全站容量保險絲限制 (磁碟才是真成本)', async () => {
  const fullBox = { stats: () => ({ totalBytes: 600 * GB }), userStats: () => ({ totalBytes: 0, totalFiles: 0 }) }
  const projectUser = { userId: 'checkcut', email: 'checkcut', isProject: true }
  const result = await checkQuota(projectUser, fullBox, hostedConfig, 1 * GB)
  assert.ok(result, '超過全站容量上限時連專案帳號也要擋')
  assert.equal(result.status, 507)
})
