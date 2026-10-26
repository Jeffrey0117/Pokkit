#!/usr/bin/env node
'use strict';
/**
 * 感知式重複照片清理 — iOS 每次匯出的 JPEG 位元組不同,位元組級去重抓不到。
 * 做法:每張照片的 300px 縮圖算 dHash(9x8 灰階差分,64-bit),
 * 完全相同 hash + 相同寬高 + 拍攝時間相容(相等或任一缺)= 同一張照片。
 * 同組保留「最早上傳」那張,其餘設 deleted_at 進垃圾桶(可在 Trash 還原)。
 *
 * 用法:node scripts/dedupe-perceptual.cjs --dry   (只報告)
 *       node scripts/dedupe-perceptual.cjs         (實際進垃圾桶)
 */
const path = require('node:path');
const fs = require('node:fs');
const sharp = require('sharp');
const Database = require('better-sqlite3');

const DRY = process.argv.includes('--dry');
const ROOT = path.join(__dirname, '..');
const db = new Database(path.join(ROOT, 'data', 'pokkit.db'));

const rows = db.prepare(`
  SELECT id, stored_name, thumb_stored_name, size, uploaded_at, taken_at, width, height, filename
  FROM files
  WHERE media_type='photo' AND status='ready' AND deleted_at IS NULL
  ORDER BY uploaded_at ASC
`).all();
console.log(`掃描對象: ${rows.length} 張 ready 照片`);

async function dhash(file) {
  const { data } = await sharp(file)
    .grayscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits += data[y * 9 + x] < data[y * 9 + x + 1] ? '1' : '0';
    }
  }
  return bits;
}

(async () => {
  const byHash = new Map();
  let hashed = 0, missing = 0;
  for (const r of rows) {
    const thumbRel = r.thumb_stored_name || `${r.id}/thumb.webp`;
    const thumbPath = path.join(ROOT, 'data', 'default', thumbRel.includes('/') ? thumbRel : `${r.id}/thumb.webp`);
    if (!fs.existsSync(thumbPath)) { missing++; continue; }
    let h;
    try { h = await dhash(thumbPath); } catch { missing++; continue; }
    hashed++;
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push(r);
    if (hashed % 400 === 0) console.log(`  ...已算 ${hashed}`);
  }
  console.log(`dHash 完成: ${hashed} 張 (縮圖缺失/失敗 ${missing})`);

  const toTrash = [];
  let groups = 0;
  for (const members of byHash.values()) {
    if (members.length < 2) continue;
    // 同 hash 內再按 (width,height) 分桶,拍攝時間相容才算同一張
    const buckets = new Map();
    for (const m of members) {
      const key = `${m.width}x${m.height}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(m);
    }
    for (const b of buckets.values()) {
      if (b.length < 2) continue;
      const times = new Set(b.map((m) => m.taken_at).filter(Boolean));
      if (times.size > 1) continue; // 拍攝時間互相矛盾 → 不敢動
      groups++;
      const keep = b[0]; // uploaded_at 最早
      for (let i = 1; i < b.length; i++) toTrash.push({ dup: b[i], keep });
    }
  }

  const bytes = toTrash.reduce((s, t) => s + (t.dup.size || 0), 0);
  console.log(`\n重複群組: ${groups} 組 | 可清理: ${toTrash.length} 張 | 釋放約 ${(bytes / 1048576).toFixed(1)} MB`);
  toTrash.slice(0, 8).forEach((t) => console.log(`  ${t.dup.id} (${t.dup.filename}) → 與 ${t.keep.id} 重複`));
  if (toTrash.length > 8) console.log(`  ...共 ${toTrash.length} 張`);

  if (DRY) { console.log('\n(dry-run,未動任何資料)'); db.close(); return; }

  const now = Date.now();
  const stmt = db.prepare('UPDATE files SET deleted_at=? WHERE id=? AND deleted_at IS NULL');
  const tx = db.transaction((items) => { for (const t of items) stmt.run(now, t.dup.id); });
  tx(toTrash);
  console.log(`\n已將 ${toTrash.length} 張移入垃圾桶(deleted_at=${now})。可在 Trash 頁檢視/還原。`);
  db.close();
})();
