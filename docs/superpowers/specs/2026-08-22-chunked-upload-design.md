# 分塊上傳（chunked-upload-kit × pokkit）設計

> 2026-08-22。起因：Cloudflare 邊緣擋單一請求 body > 100MB（實測 120MB → `413 cloudflare`，request 完全不進 origin），
> pokkit 的 `/upload` 是單一 multipart 一口氣送整檔 → 一分鐘手機影片必卡。

## 目標

1. pokkit 網頁端上傳任何大小（≤ `POKKIT_MAX_FILE_SIZE`，預設 500MB）的檔案都能穿過 Cloudflare。
2. 分塊上傳的協定與實作抽成零依賴 kit `chunked-upload-kit`（GitHub `Jeffrey0117/chunked-upload-kit`），
   其他專案之後可直接接。
3. 既有 `/upload` 行為不變（小檔仍走單一請求；所有既有測試維持綠燈）。

## 非目標（YAGNI）

- 跨頁面重新整理後續傳（localStorage 持久化 uploadId）— 協定支援（`GET status` 回已收塊），client 不做持久化。
- tus 協定相容。
- 改 pokkit 的 storage 層（組好的檔案讀成 Buffer 走現有 `save/savePhoto/saveVideo`，與 `/upload` 相同記憶體上限）。
- 回套其他專案（kit 正本先上 repo，之後要組再套）。

## 協定（HTTP，JSON）

Prefix 由 app 決定（pokkit：`/api/upload/chunked`）。

| 動作 | 路由 | Body | 回應 |
|---|---|---|---|
| 開始 | `POST {p}/init` | `{filename,size,mime,chunkSize?,sha256?,meta?}` | `{uploadId,chunkSize,totalChunks,received:[]}` |
| 傳塊 | `PUT {p}/{uploadId}/{index}` | raw bytes（`application/octet-stream`） | `{received:number[],done:boolean}` |
| 狀態 | `GET {p}/{uploadId}` | – | `{uploadId,filename,size,mime,chunkSize,totalChunks,received}` |
| 完成 | `POST {p}/{uploadId}/complete` | – | app `onComplete` 的回傳（pokkit：與 `/upload` 同形） |
| 放棄 | `DELETE {p}/{uploadId}` | – | `{ok:true}` |

規則：
- `chunkSize` 預設 16MB、上限 `maxChunkSize`（預設 32MB，**必須 < 100MB**）；`size ≤ maxFileSize`；`totalChunks ≤ maxChunks`（預設 4096）。
- 每塊長度必須等於 `chunkSize`（最後一塊 = 餘數），不符 → 400。重送同一 index 是冪等（覆寫）。
- `init` 時綁 `owner`（由 app 的 auth 決定，pokkit = `user.userId`）；之後所有操作 owner 不符 → 403，不存在 → 404。
- `complete`：缺塊 → 409 `{missing:[...]}`；全到齊 → 串流串接成單檔；若 init 有給 `sha256` 則驗，不符 → 422 並清掉 session；
  呼叫 `onComplete({path,filename,mime,size,meta,owner})`，app 回傳的物件即 HTTP 回應；無論成敗 session 目錄最後都清掉。
- session 寫在 `{dir}/{uploadId}/meta.json` + `{index}.part`；server 重啟後仍可續傳（lookup 時從磁碟回讀）。
- `ttlMs`（預設 24h）過期的 session 由 `sweep()` 清除（開機 + 每小時）。
- uploadId = 16 bytes random base64url；目錄名只允許 `[A-Za-z0-9_-]`，index 只允許整數 — 防 path traversal。

## Kit 結構（`chunked-upload-kit`，ESM，zero runtime deps）

```
index.js              re-export { createChunkStore } + adapters
src/store.js          核心：createChunkStore({dir,maxFileSize,maxChunkSize,defaultChunkSize,maxChunks,ttlMs})
                      → init / putChunk / status / complete / abort / sweep / startSweeper
src/adapters/fastify.js  registerChunkedUpload(app,{prefix,store,auth,onComplete})（encapsulated plugin，自掛 octet-stream parser）
src/adapters/express.js  chunkedUploadRouter({store,auth,onComplete}) → express.Router 相容的 handler
client/index.js       uploadChunked(file,{endpoint,headers|getHeaders,chunkSize,concurrency,retries,onProgress,signal,meta,sha256})
                      瀏覽器用 XHR（有 upload progress）、Node 用 fetch；回傳 complete 的 JSON
index.d.ts            型別（pokkit 是 TS）
test/store.test.mjs   核心行為（node:test）
test/fastify.test.mjs 端到端（fastify 為 devDependency）
example.js            `node example.js` 起一個 fastify demo server
README.md / SKILL.md  接線與地雷（CF 100MB、chunkSize 必須 <100MB、owner、rate limit）
```

錯誤處理：store 丟 `ChunkError(status, code, message, extra)`，adapter 轉成 `{error,code,...}` JSON；非 ChunkError → 500 並 log。

## pokkit 接線

- `npm i github:Jeffrey0117/chunked-upload-kit`；`public/vendor/chunked-upload-client.js` 放 client 副本（index.html 以
  `<script type="module">` 載入並掛 `window.ChunkedUpload`，走既有 `__*_HASH__` cache-bust）。
- `src/upload-finalize.ts`：從 `routes/upload.ts` 抽出「quota 檢查 + photo/video/file 三分支」為 `finalizeUpload()`，`/upload` 與 chunked `onComplete` 共用。
- `src/routes/chunked-upload.ts`：`registerChunkedUpload(app,{prefix:'/api/upload/chunked', store:createChunkStore({dir:join(dataDir,'chunks'),maxFileSize:config.maxFileSize}), auth:requireAuth→userId, onComplete:finalizeUpload})`。
- `public/app.js`：`uploadFile()` 在 `file.size > CHUNK_THRESHOLD (64MB)` 時改走 `ChunkedUpload.uploadChunked()`，進度/成功/失敗/重試接回既有 queue UI；meta 帶 `password/expiresIn/album_id`。
- 測試：`test/chunked.test.mjs`（inject）：init→put→complete 成功落檔；owner 不符 403；塊長度錯 400；缺塊 409；status 可續傳。

## 驗收

- 本機：pokkit `npm test` 全綠；kit `npm test` 全綠。
- 線上：push 後從瀏覽器上傳 >100MB 影片到正式站成功（或 curl 模擬 init/put/complete 120MB）。
