#!/usr/bin/env node
'use strict';
// 單張 AVIF 歸檔編碼(子程序):sweeper 用獨立 process 跑編碼,記憶體完全隔離
// (全解析度 AVIF 編碼吃數百 MB 原生記憶體,放主程序會頂到 PM2 記憶體上限)。
// 用法: node avif-encode-one.cjs <rawPath> <tmpOutPath>
// stdout 輸出一行 JSON: {ok, width, height, inBytes, outBytes} 或 {ok:false, error}
const fs = require('node:fs');
const sharp = require('sharp');

const [rawPath, tmpOut] = process.argv.slice(2);

(async () => {
  try {
    sharp.cache(false);
    sharp.concurrency(2);
    const inBytes = fs.statSync(rawPath).size;
    const meta = await sharp(rawPath, { failOn: 'none' }).metadata();
    const avifBuffer = await sharp(rawPath, { failOn: 'none' })
      .keepMetadata()
      .avif({ quality: 50 })
      .toBuffer();
    const chk = await sharp(avifBuffer).metadata();
    if (chk.width !== meta.width || chk.height !== meta.height) {
      console.log(JSON.stringify({ ok: false, error: 'dims mismatch' }));
      return;
    }
    fs.writeFileSync(tmpOut, avifBuffer);
    console.log(JSON.stringify({ ok: true, width: meta.width, height: meta.height, inBytes, outBytes: avifBuffer.length }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String(e.message || e) }));
  }
})();
