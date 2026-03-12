'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

/**
 * SHA-256 hash of a Buffer
 * @param {Buffer} buf
 * @returns {string} hex digest
 */
function hashBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * SHA-256 hash of a Readable stream
 * @param {import('node:stream').Readable} stream
 * @returns {Promise<string>} hex digest
 */
function hashStream(stream) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * SHA-256 hash of a file on disk
 * @param {string} filePath
 * @returns {Promise<string>} hex digest
 */
function hashFile(filePath) {
  return hashStream(fs.createReadStream(filePath));
}

module.exports = { hashBuffer, hashStream, hashFile };
