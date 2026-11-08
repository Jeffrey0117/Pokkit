/**
 * 🔑 JWKS 公鑰快取 — 從 LetMeUse /api/jwks 抓 ES256 公鑰, 同步取用 + 定時刷新。
 *
 * 為什麼是同步取用: 這個 app 的 requireAuth 是同步的, 改 async 要動整票 route。
 * 所以背景非同步抓 → cache 起來 → verify 同步讀 (crypto.verify 也同步)。
 *
 * 2026-11-08: 實作搬進 `jwks-verify-kit`。生態系原本有十份各自獨立的拷貝, 每份
 * 踩到不同的一半坑; 這份原本中的是:
 *   - `fetch(JWKS_URL)` **沒有逾時**。node 的 fetch 沒有預設逾時 —— 對方接了
 *     連線卻不回應會讓 promise 永不 settle → `fetching` 旗標永遠卡住 → 快取
 *     再也不更新、每個請求都 401 直到有人重啟, 而且零診斷。
 *   - `if (m.size) { keysByKid = m }` —— 格式正確的空回應不覆蓋快取, 所以緊急
 *     撤銷金鑰(私鑰外洩後把金鑰從 JWKS 下架)永遠不生效。
 *   - 未知 kid 的重抓冷卻跟「上次成功抓取」共用 `lastFetch`, 所以剛跑完的定時
 *     刷新會把冷卻洗掉; 而且冷卻從抓取「開始」算, 慢速或逾時的抓取等於完全沒
 *     冷卻。
 *   - 抓取失敗完全沒有紀錄(`catch {}`)→ fail-closed 變成無聲故障。
 *   - 沒有開機預熱的等待點(見 warmUpJwks)。
 */
import { createJwksCache, type JwksStats, type JwksCache } from 'jwks-verify-kit'

export type { JwksStats }

/**
 * **延遲**建立行程共用的那一份。
 *
 * 為什麼不在 import 時就建: `auth.ts` 的 `verifyLetMeUseToken` 支援注入自己的
 * getKey(測試就是那樣用的, 完全不碰網路)。如果 import 這個模組就會去建快取 /
 * 打網路 / 因為缺 env 而 throw, 那些測試連載入都辦不到。
 *
 * ⚠️ 刻意用低階的 `createJwksCache` 而不是 `createLetMeUseVerifier`:
 * **快取只管金鑰, appId 是驗證政策, 兩件事不該綁在一起。** pokkit 的 appId 來自
 * `config.letmeuseAppId`(測試會傳自己的), 而不是 env —— 綁在快取上的話, 注入
 * config 的呼叫端就必須同時設 env, 那是假的相依。
 * appId 本身的 fail-closed 由 auth.ts 負責(見那邊的 `if (!appId)`)。
 */
let shared: JwksCache | null = null

function cache(): JwksCache {
  if (!shared) {
    shared = createJwksCache({
      url: process.env.LETMEUSE_JWKS_URL || 'http://localhost:4006/api/jwks',
      algorithms: ['ES256'],
      onError: (err: Error) => console.error(`[jwks] 抓取失敗: ${err.message}`),
    })
    void shared.start() // 定時刷新(計時器已 unref, 不卡 process 結束)
  }
  return shared
}

/** 同步取公鑰; kid 不在 (可能輪換) → 背景重抓 (有獨立冷卻), 這次先回 null。 */
export function getJwksPublicKey(kid: string) {
  return cache().getKey(kid)
}

/** 診斷用 — 讓健檢/日誌看得到「公鑰到底抓到了沒」。 */
export function getJwksStats(): JwksStats {
  return cache().stats()
}

/**
 * 開機預熱。**一定要在啟動時 await**: requireAuth 走同步驗證, 快取 miss 一律
 * fail-closed, 不預熱的話重啟後「第一個」請求就算帶完全有效的 token 也會 401,
 * 使用者看到的是「我的登入壞了」。
 */
export async function warmUpJwks(): Promise<JwksStats> {
  const c = cache()
  await c.start()
  return c.stats()
}

export function stopJwks(): void {
  if (shared) shared.stop()
}
