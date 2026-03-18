'use strict';

/**
 * Video Processing Worker (worker_threads)
 *
 * Receives { id, rawPath, dataDir } messages.
 * Uses ffmpeg to: extract metadata, generate thumbnail, compress video.
 */

const { parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const PokkitStore = require('../../core/index.js');

const store = new PokkitStore({
  dataDir: workerData.dataDir,
  buckets: { default: { mode: 'uuid-dir' } },
});

function exec(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 600000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

async function ffprobe(filePath) {
  const out = await exec('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  return JSON.parse(out);
}

parentPort.on('message', async (msg) => {
  const { id, rawPath } = msg;
  const dir = path.dirname(rawPath);
  const thumbRawPath = path.join(dir, '_thumb.jpg');
  const compressedPath = path.join(dir, '_compressed.mp4');

  try {
    // 1. Probe metadata
    const probe = await ffprobe(rawPath);
    const videoStream = (probe.streams || []).find(s => s.codec_type === 'video');
    const width = videoStream ? (videoStream.width || 0) : 0;
    const height = videoStream ? (videoStream.height || 0) : 0;
    const duration = probe.format ? Math.round(parseFloat(probe.format.duration) || 0) : 0;

    // Try to extract creation_time
    let takenAt = Date.now();
    const creationTime = probe.format?.tags?.creation_time;
    if (creationTime) {
      const ts = new Date(creationTime).getTime();
      if (!isNaN(ts)) takenAt = ts;
    }

    // 2. Extract thumbnail at ~10% of duration (avoids black intro frames)
    const seekTime = duration > 10 ? String(Math.floor(duration * 0.1)) : duration > 1 ? '1' : '0';
    await exec('ffmpeg', [
      '-y', '-ss', seekTime, '-i', rawPath,
      '-vframes', '1', '-q:v', '2',
      thumbRawPath,
    ]);

    // 3. Convert thumbnail to WebP via sharp
    const sharp = (await import('sharp')).default;
    const thumbBuffer = await sharp(thumbRawPath)
      .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();
    try { fs.unlinkSync(thumbRawPath); } catch {}

    // 4. Compress video (H.264 CRF 28, AAC 128k, faststart)
    await exec('ffmpeg', [
      '-y', '-i', rawPath,
      '-c:v', 'libx264', '-crf', '28', '-preset', 'fast',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      compressedPath,
    ]);

    // 5. Finalize: write files, update DB
    store.finalizeVideo(id, {
      videoPath: compressedPath,
      thumbBuffer,
      width,
      height,
      duration,
      takenAt,
    });

    parentPort.postMessage({ type: 'done', id });
  } catch (err) {
    // Cleanup temp files
    try { fs.unlinkSync(thumbRawPath); } catch {}
    try { fs.unlinkSync(compressedPath); } catch {}

    console.error(`[VideoWorker] Failed to process ${id}:`, err.message);
    store.failPhoto(id, err.message);
    parentPort.postMessage({ type: 'error', id, error: err.message });
  }
});

parentPort.postMessage({ type: 'ready' });
