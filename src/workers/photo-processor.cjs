'use strict';

/**
 * Photo Processing Worker (worker_threads)
 *
 * Receives { id, rawPath, dataDir } messages.
 * Compresses to WebP, generates thumbnail, extracts EXIF, finalizes in DB.
 */

const { parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');
const PokkitStore = require('../../core/index.js');

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

    // 6. Archival recompress (POKKIT_ARCHIVE_RECOMPRESS=off to disable):
    //    replace the bulky raw with a FULL-RESOLUTION AVIF — every pixel kept,
    //    EXIF kept, typically 60-99% smaller. Guards: decodable, same dimensions,
    //    meaningfully smaller. Any doubt → keep the original raw untouched.
    //    DB hash/dedup is untouched (hash refers to the uploaded bytes).
    if (process.env.POKKIT_ARCHIVE_RECOMPRESS !== 'off' && !/\.avif$/i.test(rawPath) && /\.(jpe?g|png|webp)$/i.test(rawPath)) {
      try {
        const fs = require('node:fs');
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
