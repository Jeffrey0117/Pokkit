# Pokkit Multi-Tenant Storage — Design

Date: 2026-06-04
Status: Approved (design + key decisions confirmed)

## Goal

Turn pokkit into a multi-tenant storage backend so other projects can store
files in their own isolated account (account name = project name), while the
owner's admin view can see across all accounts. Provide a low-friction way for
projects to integrate (HTTP API + tiny client + a `integrate-pokkit` skill).

## Why this is low-risk

The auth + data model already supports this:

- `requireAuth` already resolves `Authorization: Bearer <token>` to either the
  global `POKKIT_API_KEY` (admin) or a decoded LetMeUse JWT (a real user).
- Every file/photo/video row already carries `user_id`, so per-tenant isolation
  is already enforced everywhere that filters by user.

So multi-tenancy = one new `accounts` table + key resolution in auth + admin
endpoints/UI. The `files` table is **not** modified — project files simply use
`user_id = account.id`. Migration is purely additive; zero risk to existing data.

## Confirmed decisions

1. **Key storage:** store only a SHA-256 hash; show the plaintext key once at
   creation. Lost key → rotate. Admin UI shows only the prefix (`pk_xxx…`).
2. **Personal files:** unchanged. The owner's LetMeUse login (and the global
   `POKKIT_API_KEY`) are treated as admin and can browse across all accounts.
   No data migration of existing personal files.

## 1. Account model

New table (added idempotently in `core/db.js` `openDb`, same pattern as existing
migrations):

```sql
CREATE TABLE IF NOT EXISTS accounts (
  id           TEXT PRIMARY KEY,   -- account id == project slug, e.g. 'coursebloom'
  name         TEXT NOT NULL,      -- display name (project name)
  key_hash     TEXT NOT NULL,      -- sha-256(plaintext key)
  key_prefix   TEXT NOT NULL,      -- e.g. 'pk_coursebloom_a83f' for display only
  is_admin     INTEGER DEFAULT 0,  -- 1 = may browse all accounts
  quota_files  INTEGER,            -- null = default tier
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_accounts_key_hash ON accounts(key_hash);
```

Project files reuse `files.user_id = account.id`. No change to `files`.

## 2. Auth: per-project API keys

Key format: `pk_<accountSlug>_<32-hex-random>`.

Accepted on either `Authorization: Bearer <token>` or `X-Pokkit-Key: <token>`.

Resolution order in `requireAuth`:

1. token === `config.apiKey` (global) → `{ userId: 'admin', email: 'admin', isAdmin: true }` (unchanged).
2. sha-256(token) matches an account → `{ userId: account.id, email: account.name, isProject: true, isAdmin: !!account.is_admin }`; bump `last_used_at`.
3. LetMeUse JWT decodes → real user (unchanged); owner ids are admin.
4. else 401.

Keys are never stored or logged in plaintext.

## 3. Admin API

New `src/routes/admin.ts`, all gated on `isAdmin`:

- `GET    /api/admin/accounts` — list accounts + usage (file count, bytes, last_used).
- `POST   /api/admin/accounts` `{ name }` — create (id = slug(name)); returns the plaintext key **once**.
- `POST   /api/admin/accounts/:id/rotate` — new key; returns once.
- `DELETE /api/admin/accounts/:id?force=1` — delete; refuses if account still has files unless `force=1` (which also wipes them).
- `GET    /api/admin/files?account=:id` — browse any account's files (admin bypasses the user_id filter).

Admin = global API key, owner LetMeUse login, or an account with `is_admin=1`.

## 4. Admin UI

New sidebar item **"Projects"**, visible only to admin:

- Accounts table: name, key prefix, file count, storage used, last used.
- "+ New Project" → name → modal shows the generated key **once** (copy button +
  ready-to-paste snippet).
- Click a project → browse its files via the existing grid, scoped by `?account=`.
- Rotate / delete actions (delete confirms, force-wipe is explicit).

## 5. Project integration

- **HTTP API** (already exists) is the contract: `POST /upload` (multipart) with
  `Authorization: Bearer pk_…` or `X-Pokkit-Key: pk_…`. Language-agnostic.
- **`pokkit-client.mjs`** (~40 lines): `createPokkit({ baseUrl, key })` →
  `.upload(file)`, `.list()`, `.delete(id)`, `.url(id)`.
- **`integrate-pokkit` skill** (`~/.claude/skills/integrate-pokkit/`): given a
  project, (a) creates the pokkit account named after the project via the admin
  API, (b) drops `pokkit-client.mjs` + a `.env` entry `POKKIT_KEY=…`, (c) prints
  a 3-line usage example, (d) verifies with a test upload and confirms it appears
  in the account.
- **MCP** (lower priority): extend existing `pokkit_*` tools to accept an optional
  `account_key` so AI-driven projects upload to their own account.

## 6. Security & compatibility

- Keys hashed at rest, shown once, prefix-only in UI, never logged.
- Admin endpoints gated on `isAdmin`; project accounts can only see their own
  files (existing `user_id` scoping) and cannot call admin endpoints.
- Account deletion requires explicit `force` to wipe files.
- Existing global `POKKIT_API_KEY` and LetMeUse login keep working unchanged.
- Migration is additive (new `accounts` table only).

## Build order (staged, each tested)

1. `accounts` table + key gen/hash helpers (`core/db.js`, `core/store.js`, account module).
2. Auth: resolve project keys + `X-Pokkit-Key` (`src/auth.ts`).
3. Admin API (`src/routes/admin.ts`).
4. Admin UI: Projects page (`index.html`, `app.js`, `style.css`).
5. `pokkit-client.mjs` + `integrate-pokkit` skill.
6. MCP `account_key` extension (if MCP source reachable).
