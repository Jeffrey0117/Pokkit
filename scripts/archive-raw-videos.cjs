// PHASE 2: re-encode archival raw videos to AV1 (RTX 5060 NVENC), full resolution.
// SAFETY: originals are MOVED to data/_raw-video-backup/ (not deleted) — purge later once satisfied.
// Guards: output decodable, duration within 0.5s, >=20% smaller — else original stays in place.
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const FF = process.env.FFMPEG_DIR; // dir containing ffmpeg.exe/ffprobe.exe
const ffmpeg = path.join(FF, 'ffmpeg.exe');
const ffprobe = path.join(FF, 'ffprobe.exe');

const root = path.join(__dirname, 'data', 'default');
const backupDir = path.join(__dirname, 'data', '_raw-video-backup');
fs.mkdirSync(backupDir, { recursive: true });

function probe(p) {
  const out = execFileSync(ffprobe, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', p], { encoding: 'utf8', timeout: 30000 });
  const j = JSON.parse(out);
  const v = (j.streams || []).find(s => s.codec_type === 'video');
  const a = (j.streams || []).find(s => s.codec_type === 'audio');
  return { duration: parseFloat(j.format?.duration || 0), vcodec: v?.codec_name, acodec: a?.codec_name, width: v?.width, height: v?.height };
}

const jobs = [];
for (const d of fs.readdirSync(root)) {
  const dir = path.join(root, d);
  try {
    if (!fs.statSync(dir).isDirectory()) continue;
    const rawName = fs.readdirSync(dir).find(f => /^_raw\.(mp4|mov|m4v)$/i.test(f));
    if (!rawName) continue;
    jobs.push({ id: d, rawPath: path.join(dir, rawName), ext: path.extname(rawName) });
  } catch { }
}
console.log('videos to process:', jobs.length);

let done = 0, replaced = 0, kept = 0, before = 0, after = 0;
for (const job of jobs) {
  done++;
  const tmpOut = path.join(path.dirname(job.rawPath), '_encode.tmp.mp4');
  try {
    const rawSize = fs.statSync(job.rawPath).size;
    const src = probe(job.rawPath);
    if (!src.duration || !src.vcodec) throw new Error('unprobeable');

    // audio: copy if aac, else transcode
    const audioArgs = src.acodec === 'aac' ? ['-c:a', 'copy'] : (src.acodec ? ['-c:a', 'aac', '-b:a', '160k'] : []);
    const r = spawnSync(ffmpeg, [
      '-y', '-v', 'error', '-i', job.rawPath,
      '-c:v', 'av1_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '30', '-b:v', '0',
      ...audioArgs,
      '-movflags', '+faststart',
      tmpOut,
    ], { timeout: 15 * 60 * 1000 });
    if (r.status !== 0) throw new Error('encode failed: ' + (r.stderr?.toString().slice(0, 100) || r.status));

    const outSize = fs.statSync(tmpOut).size;
    const chk = probe(tmpOut);
    const durOk = Math.abs(chk.duration - src.duration) <= 0.5;
    const sizeOk = outSize < rawSize * 0.8;
    if (!durOk) throw new Error(`duration mismatch ${chk.duration} vs ${src.duration}`);
    if (!sizeOk) throw new Error(`not smaller enough (${Math.round(outSize / rawSize * 100)}%)`);

    // move original to backup, install AV1 as the new raw
    fs.renameSync(job.rawPath, path.join(backupDir, job.id + '_raw' + job.ext));
    fs.renameSync(tmpOut, path.join(path.dirname(job.rawPath), '_raw.mp4'));
    replaced++; before += rawSize; after += outSize;
    console.log(`ok  ${job.id}  ${src.vcodec} ${(rawSize/1048576).toFixed(1)}MB -> av1 ${(outSize/1048576).toFixed(1)}MB (${Math.round(outSize/rawSize*100)}%)  ${src.duration.toFixed(0)}s`);
  } catch (e) {
    kept++;
    try { fs.unlinkSync(tmpOut); } catch { }
    console.log(`keep ${job.id}  (${e.message.slice(0, 70)})`);
  }
  if (done % 20 === 0) console.log(`--- progress ${done}/${jobs.length}  replaced=${replaced} kept=${kept}  saved ${((before-after)/1048576).toFixed(0)}MB ---`);
}
console.log('\n===== DONE =====');
console.log(`replaced: ${replaced}, kept: ${kept}, total: ${jobs.length}`);
console.log(`space: ${(before/1048576).toFixed(0)}MB -> ${(after/1048576).toFixed(0)}MB (saved ${((before-after)/1048576).toFixed(0)}MB)`);
console.log(`originals parked in: ${backupDir}  (確認品質後再清)`);
