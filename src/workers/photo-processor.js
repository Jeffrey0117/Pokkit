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

    // 5. Finalize: write files, delete raw, update DB
    store.finalizePhoto(id, {
      webpBuffer,
      thumbBuffer,
      width: origWidth,
      height: origHeight,
      takenAt,
    });

    parentPort.postMessage({ type: 'done', id });
  } catch (err) {
    console.error(`[PhotoWorker] Failed to process ${id}:`, err.message);
    store.failPhoto(id, err.message);
    parentPort.postMessage({ type: 'error', id, error: err.message });
  }
});

parentPort.postMessage({ type: 'ready' });
