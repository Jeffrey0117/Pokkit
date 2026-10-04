# Pokkit 個人雲端化 — 體驗衝刺 + 商業化結構

> 2026-10-04,Jeff 口頭核准(「GO 我要出門 做完」)。定位拍板:**個人雲端相簿/檔案庫**
> (Google Photos 路線);pk_ 開發者後端 = Jeff 自用不外賣;匿名快傳降為試用入口。
> 金流先緩(PayUni 商店未定),先蓋牆和店面,結帳鏈路留空位。

## 1. 三層會員結構

| 層 | 誰 | 容量 | 檔案壽命 | 其他 |
|---|---|---|---|---|
| Guest | 未登入 | 單檔 ≤64MB(走單發 /upload,不開 chunked) | 強制 ≤7 天過期 | 密碼可用;上傳後顯示連結 + 註冊 CTA |
| Free | LetMeUse 登入 | **2GB** 總量 | 永久(可自選過期) | 相簿、相片庫、管理 |
| Pro | 付費(金流未接,先收集意願) | **100GB** | 永久 | 4K/原畫質影片、大檔(chunked 上限內)、優先轉檔(文案先行,轉檔優先權實作延後) |

- 定價佔位:Pro NT$149/月。金額與 PayGate plan 對齊的事等金流接上再做。
- Tier 單一來源:`src/config.ts` 的 `STORAGE_TIERS` 改為 bytes 制
  (`maxBytes`),前端經 `GET /api/tiers`(公開)拿同一份資料渲染方案頁。
  paywall-kit 的完整接入(gate 模板/結帳)等金流確定後做,屆時 tiers 定義遷入 kit 的 config 形狀。
- Admin / premiumUserIds env override 照舊 = Pro 待遇。
- PayGate `has_subscription`(product=pokkit)照舊 = Pro;其 quotas.maxPhotos 舊欄位忽略。

## 2. 容量制 quota(取代件數制)

- `checkQuota`(upload-finalize,兩條上傳路徑共用咽喉):
  `userStats.totalBytes + incomingSize > tier.maxBytes` → 413,
  body 帶 `usedBytes / maxBytes / tier`,錯誤文案引導升級。
- chunked init 時就擋(declaredSize 已知),單發路徑在 finalize 擋。
- Guest:不走 totalBytes(無帳號)、只擋單檔 64MB + 強制 expiry。
- **全站保險絲**:`GLOBAL_CAPACITY_GB` env(預設 500)。全站 files 總 bytes
  超過 → 非 admin 上傳一律 507 + console.error 大聲叫。總量查詢 60s 記憶體快取。
- `/api/user/storage` 回應加 `usedBytes / maxBytes / usedPercent`(bytes 基準),
  舊欄位(photoCount/maxPhotos)保留一版相容。

## 3. Guest 快傳(試用入口)

- `/upload` 未帶認證 → 視為 guest:`user_id='guest'`,expiresIn 強制收斂到
  ≤7d('30d'/'forever' → '7d';未填 → '7d')。chunked 路徑維持必須登入。
- 前端:登出狀態 dropzone 不再隱藏,顯示「免登入快傳・7 天後自動過期・註冊解鎖永久保存」;
  expiry 選單對 guest 隱藏 30 天/永久;上傳成功卡片帶註冊 CTA。
- 濫用護欄:既有 rate-limit + 64MB 單檔上限 + 7 天自動清掃(sweepExpired 既有)。

## 4. SSE 取代處理狀態輪詢

- 新 `src/events.ts`:process 內 EventEmitter。photo/video worker 完成(或失敗)時
  `emit(userId, {id, status})`。
- `GET /api/events?token=`(SSE;EventSource 帶不了 header,token 走 query,
  驗證邏輯同 Bearer)。心跳 25s 防 proxy 斷線。
- 前端:有 EventSource 就訂閱,收到事件更新該卡片;EventSource error → 回退既有
  2s 批次輪詢(保底,也服務舊瀏覽器)。輪詢碼保留。

## 5. Account 儀表板強化(首頁)

- 容量條改 bytes:「1.2 GB / 2 GB」,>75% 黃、>90% 紅(樣式既有)。
- 新「最近上傳」區:最近 8 筆,縮圖 + 檔名 + 一鍵複製連結。
- 升級誘導卡:Free 顯示「升級 Pro:100GB・4K 影片」→ `/pricing`;Pro 隱藏。

## 6. /pricing 方案頁

- SPA 新路由 `pricing`(DASH_ROUTES + section),登出也可看(landing nav + 側欄 + account 升級鈕都指向)。
- 三欄比較表(資料來自 /api/tiers)。Free 欄 CTA=登入;Pro 欄 CTA=**搶先體驗登記**:
  email 輸入 → `POST /api/pro-interest` → SQLite `pro_interest(email, created_at)` 去重落庫,
  嘗試經本機 mailer(localhost:4018,best-effort,失敗靜默)寄確認信。
  金流接上後此按鈕原地換結帳。
- Admin 可 `GET /api/admin/pro-interest` 看名單。

## 7. 首頁(landing)文案重寫

- 定位從「匿名快傳」→「你的個人雲端」。Hero 方向:
  「你的照片,放在你信得過的地方」/ 副標:原畫質保存照片與影片,不掃描、不訓練 AI、不賣數據。
  免費 2GB 開始。(EN key + ZH 翻譯,i18n 既有機制)
- Features 區改:原畫質備份・相簿分享・影片也行・隱私不外流。
- Guest dropzone 保留在 landing(試用入口,見 §3)。
- 文案為初稿,Jeff 回來過目可改字。

## 8. OG 補強

- `/f/` 分享頁 OG 既有;補:影片檔 og:image 用 thumb.webp(存在時)。
- Powered by 回鏈既有,不動。

## 不做(本輪)

- 結帳/金流(等商店確定)、paywall-kit 完整接入、轉檔優先權佇列、
  相簿公開分享頁 OG、EXIF 時間軸、檔名搜尋(次優先池,另輪)。

## 測試

- 既有 node --test 全綠為基線。新增:quota bytes 判定(含 guest/fuse)單元測試、
  guest 上傳強制過期 http 測試、/api/tiers 形狀、pro-interest 去重。
- 部署後線上指紋:/api/tiers 200、guest 上傳回 expiresAt、account 頁容量條 bytes 顯示。
