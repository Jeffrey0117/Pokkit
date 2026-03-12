'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * Create an atomic write stream.
 * Writes to `destPath.tmp`, then renames to `destPath` on finalize.
 *
 * @param {string} destPath - Final file path
 * @param {{ computeHash?: boolean }} [opts]
 * @returns {{ stream: fs.WriteStream, finalize: () => Promise<{ size: number, hash: string|null }>, abort: () => void }}
 */
function createAtomicWriteStream(destPath, opts = {}) {
  const tmpPath = destPath + '.tmp';
  const dir = path.dirname(destPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const stream = fs.createWriteStream(tmpPath);
  const hash = opts.computeHash !== false ? crypto.createHash('sha256') : null;
  let size = 0;

  stream.on('data', () => {}); // keep flowing

  const origWrite = stream.write.bind(stream);
  stream.write = function(chunk, encoding, cb) {
    if (Buffer.isBuffer(chunk)) {
      size += chunk.length;
      if (hash) hash.update(chunk);
    } else if (typeof chunk === 'string') {
      const buf = Buffer.from(chunk, encoding);
      size += buf.length;
      if (hash) hash.update(buf);
    }
    return origWrite(chunk, encoding, cb);
  };

  async function finalize() {
    return new Promise((resolve, reject) => {
      stream.end(() => {
        try {
          const stats = fs.statSync(tmpPath);
          fs.renameSync(tmpPath, destPath);
          resolve({
            size: stats.size,
            hash: hash ? hash.digest('hex') : null,
          });
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  function abort() {
    stream.destroy();
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch (_) {
      // best effort
    }
  }

  return { stream, finalize, abort };
}

module.exports = { createAtomicWriteStream };
