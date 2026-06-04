# Pokkit

Self-hosted file / photo / video storage server. Upload via HTTP, get a public share link, browse a built-in photo-gallery SPA. Multi-tenant: each consuming project gets its own account key and only sees its own files.

## Stack
- **Runtime**: Node.js (ESM, `"type": "module"`), run via `tsx` (no build step)
- **Language**: TypeScript (strict) in `src/`; the storage core (`core/`) is plain CommonJS `.js`
- **Server**: Fastify v5 (`@fastify/multipart`, `static`, `cors`, `compress`, `rate-limit`, `cookie`, `formbody`)
- **DB**: SQLite via `better-sqlite3` (synchronous, file-backed in the data dir)
- **Media**: `sharp` (image resize/thumbs/webp), `exif-reader` (EXIF), ffmpeg (videos, spawned externally — degrades gracefully if absent)
- **Auth**: `bcryptjs` (file passwords + account keys)
- **Process mgmt**: PM2 (`ecosystem.config.cjs`, prod port 4009)

## Directory structure

```
src/                  ← TypeScript app (Fastify)
  index.ts            ← Entry: load .env → loadConfig → createServer → listen
  env.ts              ← Minimal .env loader (no dotenv dep)
  config.ts           ← Config from CLI args + env; STORAGE_TIERS
  server.ts           ← Builds Fastify app, registers plugins + all routes, workers
  storage.ts          ← Storage class — typed TS wrapper over core/ store
  auth.ts             ← requireAuth/requireAdmin: global API key | pk_ account key | LetMeUse JWT
  subscription.ts     ← Premium/quota checks
  photo-worker.ts     ← Worker-thread pool (4) for image processing
  video-worker.ts     ← Video transcode (ffmpeg) worker
  workers/            ← *.cjs worker thread scripts (photo-processor, video-processor)
  routes/             ← upload, files (download + range), photos/albums, status, admin
core/                 ← CommonJS storage engine (its own node_modules)
  index.js → store.js ← PokkitStore: save/list/find, SQLite schema, accounts, albums
  db.js, hash.js, streams.js  ← SQLite handle, content hashing, atomic write streams
public/               ← Front-end SPA shell (index.html + app.js + i18n.js + style.css)
sdk/pokkit-client.mjs ← ~40-line drop-in client for consuming projects
scripts/              ← backup, create-account, recompress-videos (.cjs)
data/                 ← Runtime storage: data/<bucket>/<id>/{photo,thumb,video,_raw}
docs/                 ← Design specs (e.g. multi-tenant storage)
```

## Architecture / key concepts

- **No build step**: `tsx` runs TS directly. TS imports use `.js` extensions (NodeNext resolution) even for `.ts` files.
- **TS app over JS core**: `core/` is the standalone storage engine (buckets, SQLite, dedup by hash, accounts, albums). `src/storage.ts` is a typed facade; loaded via `createRequire`. `core/` has its own `node_modules` (native better-sqlite3 binary).
- **Storage layout**: bucket `default` uses `uuid-dir` mode → `data/default/<shortId>/`. Per file: `_raw.<ext>` (original), `photo.webp` (processed), `thumb.webp`, `video.mp4`.
- **Async media pipeline**: upload saves the raw file immediately and returns; worker-thread pools generate thumbnails / transcode video in the background. Clients poll status (`processing` → `done`).
- **Auth precedence** (`auth.ts`): global `POKKIT_API_KEY` ⇒ admin; `pk_`-prefixed key ⇒ project account (sees only its own `user_id`); LetMeUse JWT ⇒ human user. `canAccessEntry` enforces per-file ownership; admins bypass.
- **SPA fallback**: `setNotFoundHandler` serves the app shell for GET html navigations so client-side routes (`/photos`, `/account`, …) work on direct load; API/XHR 404s return JSON.
- **Cache-busting**: `index.html` is rebuilt on disk-mtime change, injecting content-hash `?v=` for css/js/i18n; HTML served `no-store`.
- **HTTP range support**: `routes/files.ts` honours the `Range` header for video/large-file streaming.
- **JSON→SQLite migration**: on init, an existing `data/index.json` is migrated into SQLite then renamed `.bak`.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server with watch (`tsx watch src/index.ts`) |
| `npm start` | Run server (`tsx src/index.ts`) |
| `pm2 start ecosystem.config.cjs` | Production (port 4009, autorestart) |
| `node scripts/create-account.cjs` | Provision a new project account + key |
| `node scripts/backup.cjs` | Back up the data dir |

No test suite is configured.

## Config (env / CLI)

Read in `config.ts` (env, or `--flag` overrides). No zod; plain parsing.

- `PORT` / `POKKIT_PORT` (default 8877; PM2 forces 4009) · `POKKIT_HOST` (default 0.0.0.0)
- `POKKIT_DATA_DIR` (default `./data`) · `POKKIT_API_KEY` (admin; empty = all endpoints public)
- `POKKIT_MAX_FILE_SIZE` (default 500 MB) · `POKKIT_PUBLIC_URL` · `POKKIT_PREMIUM_USERS` · `POKKIT_ADMIN_USERS`

## Coding rules

- **Immutability**: build new objects, don't mutate.
- **Small, feature-focused files**; functions short with clear names.
- **Errors**: wrap risky ops in try/catch, return user-friendly messages; optional deps (e.g. `@fastify/compress`) loaded defensively so a stale `node_modules` never blocks startup.
- **No `console.log`** for normal flow (`console.error` for real errors only).
- TS import paths keep the `.js` extension; `core/` stays CommonJS — don't ESM-ify it.
