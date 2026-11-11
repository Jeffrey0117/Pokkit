# Pokkit

Drop a file, get a short link. Photos, videos and documents; decide who can open the link and for how long.

Pokkit is free and open source (MIT). There are two ways to use it:

- **Run your own** — clone this repo and start it on your own machine. Your files stay on your disk, and you can move them any time. Step-by-step guide (Traditional Chinese): [docs/self-hosting.zh-TW.md](docs/self-hosting.zh-TW.md)
- **Use the hosted version** — nothing to install. Free 2 GB, Pro 20 GB. Start from the intro page: https://jeffrey0117.github.io/pokkit/

The code is the same either way. The paid plan covers storage, bandwidth and someone else keeping the machine running.

## What it does

- **Share links** — every upload gets a `/f/{id}` page with inline preview; no login needed to view. Photos and videos open straight away; downloading any other file type asks the visitor to log in. Other sites cannot embed your files (hotlink protection).
- **Password & expiry** — protect a link with a password (10 guesses / minute) and pick 1h · 3h · 6h · 12h · 1d · 7d · 30d · forever. Expired links return 410 and the file is swept. A photo or video uploaded with a password or an expiry is kept as a share link, not added to the photo library.
- **Big files** — files over 64 MB upload in 16 MB chunks (3 in parallel, retries, resumable for 24h), so they get past proxies that cap request bodies (e.g. Cloudflare's 100 MB).
- **LAN fast mode** — on the same Wi-Fi as the server, uploads go straight over the LAN instead of out and back through the internet.
- **Photos & albums** — timeline by capture date, albums with revocable public `/a/:token` links, 30-day trash, look-alike duplicates tidied automatically. The library keeps a web-sized copy (photos: longest side 2048 px; videos: 1080p) and drops the original once that copy is ready — set `POKKIT_KEEP_ORIGINALS=1` to keep originals.
- **Plans** — Free 2 GB, Pro 20 GB (billing through PayGate; waitlist when billing isn't configured). Guest uploads: single file ≤ 64 MB, 5 files a day per address, forced expiry ≤ 24 hours.
- **Per-project API accounts** — each project gets its own `pk_…` key and only sees its own files (keys stored as hashes, rotatable).
- Also the storage backend for [MemoryGuy](https://github.com/Jeffrey0117/MemoryGuy)'s disk virtualizer.

## Quick Start

Needs Node.js 22+. ffmpeg is optional (only videos need it).

```bash
git clone https://github.com/Jeffrey0117/Pokkit.git
cd Pokkit
npm install
npm start          # http://localhost:8877
```

Set `POKKIT_API_KEY` before exposing it to anyone — without it every endpoint is public. The full walkthrough (config, per-project keys, PM2, putting it behind a domain, backups) is in [docs/self-hosting.zh-TW.md](docs/self-hosting.zh-TW.md).

## Usage (HTTP)

Send your key as `X-Pokkit-Key: pk_…` (or `Authorization: Bearer pk_…`).

```bash
# Upload (optional: password, expiresIn=1h|3h|6h|12h|1d|7d|30d — anything else is refused with 400)
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

Direct file URLs (`GET /files/:id/:filename`, and HEAD) need no key for photos, videos, audio, PDF and plain text, so viewers can stream them. Other file types need a login or a per-project key; password-protected files need the password first.

## Hosting your own

An instance without a member system configured (no `LETMEUSE_APP_ID`) runs in **self-hosted mode**:

- You log in on the web page by pasting your API key (the admin key, or a per-project `pk_…` key). You get the full dashboard — albums, photo wall, trash — with no storage cap beyond your disk.
- The pages load nothing from the author's servers: no login widget, no analytics. The only outside request is Google Fonts.
- There is no member sign-up. Visitors can still drop files without logging in (kept up to 24 hours), and anyone holding a share link can download it — set a password to restrict it.
- Plans, billing and the member-admin page are hidden.

The hosted version sets `LETMEUSE_APP_ID` and uses the author's own login and billing services; those parts are not meant to be reused.

## License

[MIT](LICENSE)
