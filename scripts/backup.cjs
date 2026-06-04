'use strict';
/*
 * Pokkit backup — safe, incremental.
 *
 *   node scripts/backup.cjs "D:\\pokkit-backup"
 *
 * Into <dest>:
 *   db/pokkit-<timestamp>.db   consistent DB snapshot (WAL included, keeps history)
 *   media/                     mirror of the stored files (only changed files copied)
 *
 * Run it on a schedule and point <dest> at an EXTERNAL drive or synced cloud folder
 * so a dead disk doesn't take everything with it.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Database = require('../core/node_modules/better-sqlite3');

const projectDir = path.join(__dirname, '..');
const dataDir = path.join(projectDir, 'data');
const dest = process.argv[2] || path.join(projectDir, '..', 'pokkit-backup');

const now = new Date();
const stamp = now.toISOString().replace(/[:T]/g, '-').replace(/\..+/, '');

const dbDir = path.join(dest, 'db');
const mediaDir = path.join(dest, 'media');
fs.mkdirSync(dbDir, { recursive: true });
fs.mkdirSync(mediaDir, { recursive: true });

async function main() {
  // 1. Consistent DB snapshot — better-sqlite3 .backup() checkpoints the WAL into
  //    the copy, so the snapshot has every committed change. Safe while pokkit runs.
  const dbPath = path.join(dataDir, 'pokkit.db');
  const snap = path.join(dbDir, `pokkit-${stamp}.db`);
  const db = new Database(dbPath, { readonly: true });
  await db.backup(snap);
  db.close();
  const mb = (fs.statSync(snap).size / 1048576).toFixed(2);
  console.log(`[backup] DB snapshot -> ${snap} (${mb} MB)`);

  // 2. Mirror the stored media (incremental — robocopy only copies changes).
  const src = path.join(dataDir, 'default');
  try {
    execFileSync(
      'robocopy',
      [src, path.join(mediaDir, 'default'), '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/R:1', '/W:1'],
      { stdio: 'inherit' },
    );
  } catch (e) {
    // robocopy exits non-zero (1 = files copied) even on success; only >=8 is a real error
    if (e.status >= 8) throw e;
  }
  console.log(`[backup] media mirrored -> ${path.join(mediaDir, 'default')}`);

  // 3. Prune DB snapshots older than the last 30
  const snaps = fs.readdirSync(dbDir).filter((f) => f.endsWith('.db')).sort();
  for (const old of snaps.slice(0, -30)) fs.unlinkSync(path.join(dbDir, old));

  console.log('[backup] done.');
}

main().catch((err) => {
  console.error('[backup] FAILED:', err.message);
  process.exit(1);
});
