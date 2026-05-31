'use strict';

/**
 * Recompress existing videos to the current pipeline settings
 * (H.264 CRF 30, medium, orientation-aware 1080p cap).
 *
 *   node scripts/recompress-videos.cjs            # analyze only (no changes)
 *   node scripts/recompress-videos.cjs --apply    # replace in place + update DB size
 *
 * Data dir resolves from POKKIT_DATA_DIR (defaults to F:/pokkit-data).
 * In --apply mode each file is encoded to a temp first, then atomically
 * swapped in and the DB size updated. Originals are only removed after a
 * successful encode. Re-running is safe (idempotent-ish: already-small
 * files just shrink less).
 */

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.POKKIT_DATA_DIR || 'F:/pokkit-data';
const DB_PATH = path.join(DATA_DIR, 'pokkit.db');
const APPLY = process.argv.includes('--apply');

const VF = "scale=w='if(gt(iw\\,ih)\\,1920\\,1080)':h='if(gt(iw\\,ih)\\,1080\\,1920)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2";

function encode(src, out) {
  execFileSync('ffmpeg', [
    '-y', '-i', src,
    '-c:v', 'libx264', '-crf', '30', '-preset', 'medium',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    '-vf', VF,
    out,
  ], { timeout: 600000, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
}

function fmt(bytes) {
  return (bytes / 1048576).toFixed(2) + ' MB';
}

const db = new Database(DB_PATH);
const videos = db.prepare(
  "SELECT id, bucket, filename, stored_name, size FROM files WHERE media_type='video' OR mime LIKE 'video/%'"
).all();

console.log(`\nMode: ${APPLY ? 'APPLY (will modify files + DB)' : 'ANALYZE (no changes)'}`);
console.log(`Data dir: ${DATA_DIR}`);
console.log(`Videos: ${videos.length}\n`);

let oldTotal = 0;
let newTotal = 0;
let done = 0;

for (const v of videos) {
  const src = path.join(DATA_DIR, v.bucket, v.stored_name);
  if (!fs.existsSync(src)) {
    console.log(`  SKIP (missing): ${v.filename}`);
    continue;
  }
  const oldSize = fs.statSync(src).size;
  const tmp = src + '.recompress.tmp.mp4';
  try {
    encode(src, tmp);
  } catch (e) {
    console.log(`  FAIL: ${v.filename} — ${String(e.message).split('\n')[0]}`);
    try { fs.unlinkSync(tmp); } catch (_) {}
    continue;
  }
  const newSize = fs.statSync(tmp).size;
  oldTotal += oldSize;
  newTotal += newSize;
  done++;

  const pct = oldSize > 0 ? Math.round((1 - newSize / oldSize) * 100) : 0;
  const note = newSize >= oldSize ? '  (already optimal — keeping original)' : '';
  console.log(`  ${v.filename}: ${fmt(oldSize)} -> ${fmt(newSize)}  (${pct}% smaller)${note}`);

  if (APPLY) {
    if (newSize < oldSize) {
      fs.renameSync(tmp, src);
      db.prepare('UPDATE files SET size = ? WHERE id = ?').run(newSize, v.id);
    } else {
      // No gain — don't degrade quality for nothing
      fs.unlinkSync(tmp);
      newTotal -= newSize;
      newTotal += oldSize;
    }
  } else {
    fs.unlinkSync(tmp);
  }
}

db.close();

const saved = oldTotal - newTotal;
const pct = oldTotal > 0 ? Math.round((saved / oldTotal) * 100) : 0;
console.log(`\n── Summary (${done} encoded) ──`);
console.log(`  Before: ${fmt(oldTotal)}`);
console.log(`  After:  ${fmt(newTotal)}`);
console.log(`  Saved:  ${fmt(saved)} (${pct}%)`);
if (!APPLY) console.log(`\n  Run with --apply to actually replace files.\n`);
