'use strict';

/**
 * Photo Processing Worker (worker_threads)
 *
 * Receives { id, rawPath, dataDir } messages.
 * Compresses to WebP, generates thumbnail, extracts EXIF, finalizes in DB.
 */

const { parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');
const fs = require('node:fs');
const PokkitStore = require('../../core/index.js');

// Cross-worker mutex for the AVIF archival step. Full-resolution AVIF encodes
// are the dominant native-memory cost (hundreds of MB per 12MP image); with 4
// workers encoding concurrently a 90-photo burst OOM-kills the whole process
// (2026-10-25 incident, silent abort — no V8 heap trace). Serialize to one
// encode at a time across all workers; the fast path (webp/thumb) is untouched.
const AVIF_LOCK = path.join(workerData.dataDir, '.avif-encode-lock');
async function acquireAvifLock(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { fs.mkdirSync(AVIF_LOCK); return true; } catch {}
    try {
      // Stale lock (crashed holder) — steal after 5 minutes.
      if (Date.now() - fs.statSync(AVIF_LOCK).mtimeMs > 300000) { fs.rmdirSync(AVIF_LOCK); continue; }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
function releaseAvifLock() { try { fs.rmdirSync(AVIF_LOCK); } catch {} }

// Initialize store with same config as main thread
const store = new PokkitStore({
  dataDir: workerData.dataDir,
  buckets: { default: { mode: 'uuid-dir' } },
});

parentPort.on('message', async (msg) => {
  const { id, rawPath } = msg;

  try {
    // Dynamic import for ESM-only modules
    const sharp = (await import('sharp')).default;
    // Bound libvips native memory: small op cache, 2 vips threads per op
    // (default = all cores × 4 workers → native memory/CPU blowup on bursts).
    sharp.cache({ memory: 32, files: 0, items: 50 });
    sharp.concurrency(2);

    // 1. Read metadata (EXIF, dimensions)
    const metadata = await sharp(rawPath).metadata();
    const origWidth = metadata.width || 0;
    const origHeight = metadata.height || 0;

    // 2. Extract EXIF DateTimeOriginal
    let takenAt = Date.now();
    if (metadata.exif) {
      try {
        const exifReader = (await import('exif-reader')).default;
        const exifData = exifReader(metadata.exif);
        if (exifData?.Photo?.DateTimeOriginal) {
          takenAt = new Date(exifData.Photo.DateTimeOriginal).getTime();
        } else if (exifData?.Image?.DateTime) {
          takenAt = new Date(exifData.Image.DateTime).getTime();
        }
      } catch {
        // EXIF parsing failed, keep upload time
      }
    }

    // 3. Compress to WebP (max 2048px on longest side)
    const webpBuffer = await sharp(rawPath)
      .rotate() // auto-rotate based on EXIF orientation
      .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    // 4. Generate thumbnail (300px on longest side)
    const thumbBuffer = await sharp(rawPath)
      .rotate()
      .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();

    // 5. Finalize: write files, update DB (raw is kept as the original-quality copy)
    store.finalizePhoto(id, {
      webpBuffer,
      thumbBuffer,
      width: origWidth,
      height: origHeight,
      takenAt,
    });

    // 5b. 入庫感知去重:thumb 算 dHash,同 user+同尺寸+同指紋的既有照片存在
    // → 這張自動進垃圾桶(iOS 每次匯出位元組不同,byte-dedup 抓不到同圖多份)。
    let isDup = false;
    try {
      const { data: dh } = await sharp(thumbBuffer).grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
      let bits = '';
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += dh[y * 9 + x] < dh[y * 9 + x + 1] ? '1' : '0';
      const dup = store.setDhashAndAutoDedup(id, bits);
      if (dup.duplicate) {
        isDup = true;
        console.log(`[PhotoWorker] Auto-dedup ${id}: 與 ${dup.keptId} 感知重複,已自動進垃圾桶`);
      }
    } catch (dhErr) {
      console.error(`[PhotoWorker] dHash skip ${id}: ${dhErr.message}`);
    }

    // 6. Archival recompress (POKKIT_ARCHIVE_RECOMPRESS=off to disable):
    //    replace the bulky raw with a FULL-RESOLUTION AVIF — every pixel kept,
    //    EXIF kept, typically 60-99% smaller. Guards: decodable, same dimensions,
    //    meaningfully smaller. Any doubt → keep the original raw untouched.
    //    DB hash/dedup is untouched (hash refers to the uploaded bytes).
    if (!isDup && process.env.POKKIT_ARCHIVE_RECOMPRESS !== 'off' && !/\.avif$/i.test(rawPath) && /\.(jpe?g|png|webp)$/i.test(rawPath)) {
      // One AVIF encode at a time process-wide; can't get the lock → keep raw.
      const gotLock = await acquireAvifLock(90000);
      if (!gotLock) {
        console.error(`[PhotoWorker] Archive skip ${id}: avif lock busy (raw kept)`);
      } else {
        try {
          const rawSize = fs.statSync(rawPath).size;
          const avifBuffer = await sharp(rawPath, { failOn: 'none' })
            .keepMetadata()
            .avif({ quality: 50 })
            .toBuffer();
          const chk = await sharp(avifBuffer).metadata();
          const dimsOk = chk.width === origWidth && chk.height === origHeight;
          if (dimsOk && avifBuffer.length < rawSize * 0.95) {
            const avifPath = path.join(path.dirname(rawPath), '_raw.avif');
            const tmpPath = avifPath + '.tmp';
            fs.writeFileSync(tmpPath, avifBuffer);
            fs.renameSync(tmpPath, avifPath);
            fs.unlinkSync(rawPath);
            console.log(`[PhotoWorker] Archived ${id}: raw ${(rawSize / 1048576).toFixed(2)}MB -> avif ${(avifBuffer.length / 1048576).toFixed(2)}MB`);
          }
        } catch (archiveErr) {
          // Never fail the photo over archival — original raw stays.
          console.error(`[PhotoWorker] Archive skip ${id}: ${archiveErr.message}`);
        } finally {
          releaseAvifLock();
        }
      }
    }

    parentPort.postMessage({ type: 'done', id });
  } catch (err) {
    console.error(`[PhotoWorker] Failed to process ${id}:`, err.message);
    store.failPhoto(id, err.message);
    parentPort.postMessage({ type: 'error', id, error: err.message });
  }
});

parentPort.postMessage({ type: 'ready' });
