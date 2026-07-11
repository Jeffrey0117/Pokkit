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
    execFile(cmd, args, { timeout: 600000, windowsHide: true }, (err, stdout, stderr) => {
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

    // 4. Compress video (H.264 CRF 23, medium preset, AAC 128k, faststart)
    //    + cap to ~1080p (orientation-aware): landscape fits 1920x1080,
    //    portrait fits 1080x1920, preserves aspect, even dims.
    //    CRF 23(原 30):螢幕錄影/教學片的小字在 CRF 30 會糊掉(2026-07-11 蝦皮課實案,
    //    1080p 只剩 132kbps)——檔案約大 2-2.5 倍,但文字可讀性是底線。
    //    min(target, i?) 擋放大:force_original_aspect_ratio=decrease 只保證「不超過目標」,
    //    小於目標的輸入仍會被放大(360p 源被吹成 1080p 的實案就是這裡)。
    //    Commas inside if()/min() are escaped (\\,) so ffmpeg's filtergraph parser
    //    doesn't read them as filter separators.
    //    NVENC first: GPU H.264 (h264_nvenc cq23 ≈ x264 crf23 品質) 快 10-50 倍,
    //    大檔不再堵住整條佇列(2026-07-11 實案:452MB 影片 libx264 以 0.13x 爬,
    //    後面的影片全卡 processing、縮圖出不來)。沒有 NVIDIA 卡 / 驅動不支援時
    //    自動退回 libx264 —— 別台機器部署不會壞。
    const SCALE_VF = "scale=w='if(gt(iw\\,ih)\\,min(1920\\,iw)\\,min(1080\\,iw))':h='if(gt(iw\\,ih)\\,min(1080\\,ih)\\,min(1920\\,ih))':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2";
    const NVENC_ARGS = ['-c:v', 'h264_nvenc', '-preset', 'p6', '-rc', 'vbr', '-cq', '23', '-b:v', '0'];
    const X264_ARGS = ['-c:v', 'libx264', '-crf', '23', '-preset', 'medium'];
    const buildArgs = (videoArgs) => [
      '-y', '-i', rawPath,
      ...videoArgs,
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-vf', SCALE_VF,
      compressedPath,
    ];
    // NVENC 偶發 "incompatible client key" 在多支影片同時開 session 時出現(暫時性,
    // 2026-07-11 requeue burst 實案) — 重試一次(帶抖動)再退回 libx264。
    try {
      await exec('ffmpeg', buildArgs(NVENC_ARGS));
    } catch (nvencErr1) {
      await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2000));
      try {
        await exec('ffmpeg', buildArgs(NVENC_ARGS));
      } catch (nvencErr2) {
        console.log(`[VideoWorker] NVENC unavailable for ${id} (after retry), falling back to libx264: ${String(nvencErr2).slice(0, 80)}`);
        await exec('ffmpeg', buildArgs(X264_ARGS));
      }
    }

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
