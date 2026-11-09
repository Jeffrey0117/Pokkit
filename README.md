# Pokkit

Your own cloud drive, self-hosted. Upload photos, videos and documents, get a share link, decide who can open it and for how long.

📖 Intro page: https://jeffrey0117.github.io/pokkit/

## What it does

- **Share links** — every upload gets a `/f/{id}` page with inline preview; no login needed to view.
- **Password & expiry** — protect a link with a password (10 guesses / minute) and pick 1h · 1d · 7d · 30d · forever. Expired links return 410 and the file is swept.
- **Big files** — files over 64 MB upload in 16 MB chunks (3 in parallel, retries, resumable for 24h), so they get past proxies that cap request bodies (e.g. Cloudflare's 100 MB).
- **LAN fast mode** — on the same Wi-Fi as the server, uploads go straight over the LAN instead of out and back through the internet.
- **Photos & albums** — timeline by capture date, albums with revocable public `/a/:token` links, 30-day trash.
- **Plans** — Free 2 GB, Pro 100 GB (billing through PayGate; waitlist when billing isn't configured). Guest uploads: single file ≤ 64 MB, 5 files a day per address, forced expiry ≤ 24 hours.
- **Per-project API accounts** — each project gets its own `pk_…` key and only sees its own files (keys stored as hashes, rotatable).
- Also the storage backend for [MemoryGuy](https://github.com/Jeffrey0117/MemoryGuy)'s disk virtualizer.

## Quick Start

```bash
npm install
npm start
```

## Usage (HTTP)

Send your key as `X-Pokkit-Key: pk_…` (or `Authorization: Bearer pk_…`).

```bash
# Upload (optional: password, expiresIn=1h|1d|7d|30d)
curl -H "X-Pokkit-Key: pk_…" -F "file=@photo.jpg" -F "expiresIn=7d" https://your-pokkit.example/upload
# → { "id": "...", "url": "https://your-pokkit.example/f/{id}", "directUrl": ".../files/{id}/photo.jpg" }

# List your files / delete one
curl -H "X-Pokkit-Key: pk_…" -H "Accept: application/json" "https://your-pokkit.example/files?limit=50"
curl -H "X-Pokkit-Key: pk_…" -X DELETE https://your-pokkit.example/files/{id}
```

## Usage (JS SDK)

`sdk/pokkit-client.mjs` — zero dependencies, Node 18+. Files over 64 MB switch to chunked upload automatically (install `github:Jeffrey0117/chunked-upload-kit` for that path).

```js
import { createPokkit } from './pokkit-client.mjs'
const pokkit = createPokkit({ baseUrl: 'https://your-pokkit.example', key: process.env.POKKIT_KEY })
const { id } = await pokkit.upload('./video.mp4')
pokkit.url(id)          // share link
await pokkit.list()     // only this account's files
await pokkit.remove(id)
```

## Configuration

| Method | Example |
|--------|---------|
| CLI args | `npm start -- --port 9000 --data-dir ./storage` |
| Env vars | `POKKIT_PORT=9000 POKKIT_API_KEY=secret npm start` |

| Option | Default | Description |
|--------|---------|-------------|
| `--port` / `POKKIT_PORT` | `8877` | Server port |
| `--host` / `POKKIT_HOST` | `0.0.0.0` | Bind address |
| `--data-dir` / `POKKIT_DATA_DIR` | `./data` | File storage directory |
| `--api-key` / `POKKIT_API_KEY` | _(none)_ | Bearer token for protected endpoints |
| `--max-file-size` / `POKKIT_MAX_FILE_SIZE` | `524288000` (500MB) | Max upload size in bytes |

## Auth

When `apiKey` is set, these endpoints require `Authorization: Bearer <key>`:
- `POST /upload`
- `GET /files` (list)
- `GET /status`
- `DELETE /files/:id`

File download (`GET /files/:id/:filename`) and HEAD are always public, so REPIC/REVID viewers can stream directly.

## License

MIT
