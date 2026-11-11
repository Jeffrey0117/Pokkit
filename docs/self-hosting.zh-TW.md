# 自己架一台 Pokkit

照著做大約十分鐘。每一步都用一份全新下載的程式實際跑過（Windows、Node 22）。

## 你會得到什麼

- 一個上傳網址：丟檔案進去，拿回一條分享連結。
- 連結可以設密碼、設期限（1 小時到 30 天，或永久）。
- 照片和影片會自動產生縮圖與網頁用的版本。
- 每個專案一把自己的金鑰，只看得到自己的檔案。

自己架的那台是完整的：網頁用你的金鑰登入，進去就是相簿、照片牆、垃圾桶那一整套，容量沒有上限（看你的硬碟）。頁面不會載入作者的登入元件或流量統計，也不會連回作者的任何主機。

跟代管版的差別只有一個：**沒有會員註冊**。登入的人就是你（或你發金鑰的對象）；訪客不用登入也能丟檔案，但最多留 24 小時。分享連結誰拿到都能直接下載，要擋人就設密碼。

## 需要準備

- Node.js 22 以上
- Git
- ffmpeg（選用。沒裝的話照片和一般檔案都正常，只有影片不能進相片庫）

## 1. 下載並安裝

```bash
git clone https://github.com/Jeffrey0117/Pokkit.git
cd Pokkit
npm install
```

## 2. 設定

在專案根目錄新增一個 `.env` 檔：

```
POKKIT_PORT=8877
POKKIT_API_KEY=換成一串你自己的長亂碼
POKKIT_PUBLIC_URL=http://localhost:8877
```

- `POKKIT_API_KEY` 是管理金鑰，拿著它什麼都能做，不要外流。**不設的話任何人都能列出與刪除檔案**，對外開放前一定要設。
- `POKKIT_PUBLIC_URL` 是分享連結開頭的網址。之後掛上自己的網域，就改成 `https://你的網域`。

## 3. 啟動

```bash
npm start
```

看到 `Pokkit running on http://0.0.0.0:8877` 和 `Self-hosted mode` 兩行就是起來了。

瀏覽器打開 `http://localhost:8877`，按右上角「登入」，貼上你在 `.env` 設的管理金鑰，再按「後台」就進去了。

## 4. 傳第一個檔案

```bash
curl -H "Authorization: Bearer 你的管理金鑰" -F "file=@photo.jpg" http://localhost:8877/upload
```

回來的 `url` 就是分享連結，貼給別人就能看。

要設期限或密碼：

```bash
curl -H "Authorization: Bearer 你的管理金鑰" -F "file=@報價單.pdf" -F "expiresIn=7d" -F "password=1234" http://localhost:8877/upload
```

`expiresIn` 只收 `1h` `3h` `6h` `12h` `1d` `7d` `30d`，其他值會被拒絕。

## 5. 幫每個專案開一把金鑰

管理金鑰不要到處放。每個要用 Pokkit 的專案各開一個帳號：

```bash
node scripts/create-account.cjs "我的部落格"
```

會印出一把 `pk_` 開頭的金鑰，**只顯示這一次**，馬上存起來。之後那個專案這樣用：

```bash
# 上傳
curl -H "X-Pokkit-Key: pk_…" -F "file=@photo.jpg" http://localhost:8877/upload

# 列出自己的檔案
curl -H "X-Pokkit-Key: pk_…" -H "Accept: application/json" "http://localhost:8877/files?limit=50"

# 刪除
curl -H "X-Pokkit-Key: pk_…" -X DELETE http://localhost:8877/files/檔案ID
```

用 Node 的話可以直接拿 `sdk/pokkit-client.mjs`，用法在 README。

## 6. 讓它一直開著

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
```

注意：`ecosystem.config.cjs` 會把埠號固定成 **4009**，蓋掉 `.env` 裡的 `POKKIT_PORT`。要用別的埠就改那個檔案裡的 `PORT`。

## 7. 對外開放

Pokkit 自己不處理 HTTPS，前面要放一層反向代理（Caddy、nginx、Cloudflare Tunnel 都可以），把你的網域指到 Pokkit 的埠。掛好之後：

1. 把 `.env` 的 `POKKIT_PUBLIC_URL` 改成 `https://你的網域`，重啟。
2. 用 Cloudflare 的話，單次請求超過 100 MB 會被擋。Pokkit 超過 64 MB 的檔案會自動切塊上傳，所以不用另外處理。
3. 首頁的介紹文案是作者寫的，想換成自己的就改 `public/index.html`。頁面唯一會連到外面的東西是 Google Fonts 的字型。

## 檔案放在哪、怎麼備份

全部在 `data/` 資料夾：檔案本體加一個 SQLite 資料庫（`data/pokkit.db`）。備份就是把整個 `data/` 複製走；要換機器，把 `data/` 和 `.env` 搬過去就好。想放到別的硬碟，設 `POKKIT_DATA_DIR`。

相片庫預設只留網頁用的版本（照片長邊 2048、影片 1080p），原檔在轉好之後會刪掉。要保留原檔，在 `.env` 加 `POKKIT_KEEP_ORIGINALS=1`。

## 常用設定

| 設定 | 預設 | 用途 |
|------|------|------|
| `POKKIT_PORT` | `8877` | 埠號 |
| `POKKIT_API_KEY` | 無 | 管理金鑰 |
| `POKKIT_PUBLIC_URL` | 無 | 分享連結用的網址 |
| `POKKIT_DATA_DIR` | `./data` | 檔案存放位置 |
| `POKKIT_MAX_FILE_SIZE` | 500 MB | 單檔上限（位元組） |
| `POKKIT_KEEP_ORIGINALS` | 關 | 設 `1` 保留照片與影片原檔 |
| `GLOBAL_CAPACITY_GB` | `500` | 整台的容量上限，超過就拒收 |
| `FFMPEG_DIR` | 無 | ffmpeg 不在 PATH 時指定它的資料夾 |

## 遇到問題

- **影片傳了沒有縮圖**：沒裝 ffmpeg，或它不在 PATH。裝好後重啟，卡住的影片會自動重跑。
- **分享連結是 `localhost`**：`POKKIT_PUBLIC_URL` 沒改。
- **埠號跟 `.env` 寫的不一樣**：用 PM2 啟動時埠號由 `ecosystem.config.cjs` 決定。

自己架的版本不提供客服；發現程式有問題歡迎開 issue。
