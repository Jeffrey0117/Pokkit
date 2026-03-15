'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

/** Generate a short URL-safe ID (8 chars, ~48 bits of entropy) */
function shortId() {
  return randomBytes(6).toString('base64url');
}
const db = require('./db');
const { hashBuffer, hashFile } = require('./hash');
const { createAtomicWriteStream } = require('./streams');

/**
 * @typedef {object} BucketConfig
 * @property {'flat'|'uuid-dir'} mode
 *   - flat: data/{bucket}/{filename}  (LurlHub style)
 *   - uuid-dir: data/{bucket}/{uuid}/{filename}  (Pokkit original)
 */

/**
 * @typedef {object} FileEntry
 * @property {string} id
 * @property {string} bucket
 * @property {string} filename
 * @property {string} stored_name
 * @property {string} mime
 * @property {number} size
 * @property {string|null} hash
 * @property {boolean} is_directory
 * @property {number} uploaded_at
 * @property {object|null} metadata
 * @property {string|null} password_hash
 * @property {number|null} expires_at
 * @property {number} download_count
 */

class PokkitStore {
  /**
   * @param {object} opts
   * @param {string} opts.dataDir — base data directory
   * @param {Record<string, BucketConfig>} [opts.buckets] — bucket definitions
   * @param {string} [opts.dbName] — SQLite filename (default: 'pokkit.db')
   */
  constructor(opts) {
    if (!opts || !opts.dataDir) {
      throw new Error('PokkitStore: dataDir is required');
    }

    this.dataDir = path.resolve(opts.dataDir);
    this.dbName = opts.dbName || 'pokkit.db';
    this.buckets = opts.buckets || { default: { mode: 'uuid-dir' } };

    // Ensure dataDir exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    // Ensure bucket directories exist
    for (const bucket of Object.keys(this.buckets)) {
      const bucketDir = path.join(this.dataDir, bucket);
      if (!fs.existsSync(bucketDir)) {
        fs.mkdirSync(bucketDir, { recursive: true });
      }
    }

    // Open SQLite
    const dbPath = path.join(this.dataDir, this.dbName);
    this._db = db.openDb(dbPath);
  }

  // ══════════════════════════════════════════
  //  Write Operations
  // ══════════════════════════════════════════

  /**
   * Save a buffer as a new file
   * @param {string} filename
   * @param {string} mime
   * @param {Buffer} buffer
   * @param {{ bucket?: string, tags?: string[], hash?: string, id?: string, metadata?: object, password_hash?: string, expires_at?: number }} [opts]
   * @returns {FileEntry}
   */
  save(filename, mime, buffer, opts = {}) {
    const bucket = opts.bucket || 'default';
    this._validateBucket(bucket);

    const id = opts.id || shortId();
    const hash = opts.hash || hashBuffer(buffer);
    const storedName = this._resolveStoredName(bucket, id, filename);
    const destPath = this._resolveFilePath(bucket, storedName);

    // Ensure parent dir exists
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(destPath, buffer);

    const entry = {
      id,
      bucket,
      filename,
      stored_name: storedName,
      mime,
      size: buffer.length,
      hash,
      is_directory: false,
      uploaded_at: Date.now(),
      metadata: opts.metadata || null,
      password_hash: opts.password_hash || null,
      expires_at: opts.expires_at || null,
      download_count: 0,
      user_id: opts.user_id || null,
    };

    db.insertFile(this._db, entry);

    if (opts.tags && opts.tags.length > 0) {
      db.setTags(this._db, id, opts.tags);
    }

    return { ...entry, is_directory: false };
  }

  /**
   * Create an atomic write stream for large files
   * @param {string} filename
   * @param {string} mime
   * @param {{ bucket?: string, tags?: string[], id?: string, metadata?: object }} [opts]
   * @returns {{ stream: fs.WriteStream, finalize: () => Promise<FileEntry>, abort: () => void }}
   */
  createWriteStream(filename, mime, opts = {}) {
    const bucket = opts.bucket || 'default';
    this._validateBucket(bucket);

    const id = opts.id || shortId();
    const storedName = this._resolveStoredName(bucket, id, filename);
    const destPath = this._resolveFilePath(bucket, storedName);

    const atomic = createAtomicWriteStream(destPath, { computeHash: true });

    const finalize = async () => {
      const { size, hash } = await atomic.finalize();

      const entry = {
        id,
        bucket,
        filename,
        stored_name: storedName,
        mime,
        size,
        hash,
        is_directory: false,
        uploaded_at: Date.now(),
        metadata: opts.metadata || null,
      };

      db.insertFile(this._db, entry);

      if (opts.tags && opts.tags.length > 0) {
        db.setTags(this._db, id, opts.tags);
      }

      return { ...entry, is_directory: false };
    };

    return { stream: atomic.stream, finalize, abort: atomic.abort };
  }

  /**
   * Adopt an existing file on disk (register without copying)
   * @param {string} bucket
   * @param {string} filename — actual filename on disk
   * @param {string} mime
   * @param {{ tags?: string[], id?: string, hash?: string, metadata?: object }} [opts]
   * @returns {FileEntry}
   */
  adopt(bucket, filename, mime, opts = {}) {
    this._validateBucket(bucket);

    const id = opts.id || shortId();
    const mode = this.buckets[bucket].mode;

    // For flat mode, stored_name = filename (file is at data/{bucket}/{filename})
    // For uuid-dir mode, stored_name = {id}/{filename}
    let storedName;
    if (mode === 'flat') {
      storedName = filename;
    } else {
      storedName = `${id}/${filename}`;
    }

    const filePath = this._resolveFilePath(bucket, storedName);

    if (!fs.existsSync(filePath)) {
      throw new Error(`adopt: file not found at ${filePath}`);
    }

    const stats = fs.statSync(filePath);
    const size = stats.size;

    const entry = {
      id,
      bucket,
      filename,
      stored_name: storedName,
      mime,
      size,
      hash: opts.hash || null,
      is_directory: false,
      uploaded_at: Date.now(),
      metadata: opts.metadata || null,
    };

    db.insertFile(this._db, entry);

    if (opts.tags && opts.tags.length > 0) {
      db.setTags(this._db, id, opts.tags);
    }

    return { ...entry, is_directory: false };
  }

  /**
   * Register a directory (e.g., HLS output with multiple files)
   * @param {string} id
   * @param {string} bucket
   * @param {string} dirname — directory name relative to bucket
   * @param {{ tags?: string[], metadata?: object }} [opts]
   * @returns {FileEntry}
   */
  registerDirectory(id, bucket, dirname, opts = {}) {
    this._validateBucket(bucket);

    const dirPath = path.join(this.dataDir, bucket, dirname);
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      throw new Error(`registerDirectory: not a directory at ${dirPath}`);
    }

    // Calculate total size of all files in directory
    const totalSize = this._dirSize(dirPath);

    const entry = {
      id,
      bucket,
      filename: dirname,
      stored_name: dirname,
      mime: 'inode/directory',
      size: totalSize,
      hash: null,
      is_directory: true,
      uploaded_at: Date.now(),
      metadata: opts.metadata || null,
    };

    db.insertFile(this._db, entry);

    if (opts.tags && opts.tags.length > 0) {
      db.setTags(this._db, id, opts.tags);
    }

    return { ...entry, is_directory: true };
  }

  // ══════════════════════════════════════════
  //  Read Operations
  // ══════════════════════════════════════════

  /**
   * Find a file entry by ID
   * @param {string} id
   * @returns {FileEntry|null}
   */
  find(id) {
    return db.findFile(this._db, id);
  }

  /**
   * Check if a file exists in the index
   * @param {string} id
   * @returns {boolean}
   */
  exists(id) {
    return db.findFile(this._db, id) !== null;
  }

  /**
   * Find files by tag
   * @param {string} tag
   * @param {string} [bucket]
   * @returns {FileEntry[]}
   */
  findByTag(tag, bucket) {
    return db.findByTag(this._db, tag, bucket);
  }

  /**
   * Find files by content hash
   * @param {string} hash
   * @param {string} [bucket]
   * @returns {FileEntry[]}
   */
  findByHash(hash, bucket) {
    return db.findByHash(this._db, hash, bucket);
  }

  /**
   * List files with pagination
   * @param {{ bucket?: string, limit?: number, offset?: number }} [opts]
   * @returns {FileEntry[]}
   */
  list(opts) {
    return db.listFiles(this._db, opts);
  }

  /**
   * Get absolute path for a file entry
   * @param {string} id
   * @returns {string|null}
   */
  getPath(id) {
    const entry = db.findFile(this._db, id);
    if (!entry) return null;
    return this._resolveFilePath(entry.bucket, entry.stored_name);
  }

  /**
   * Get a readable stream for a file
   * @param {string} id
   * @returns {fs.ReadStream|null}
   */
  getStream(id) {
    const filePath = this.getPath(id);
    if (!filePath || !fs.existsSync(filePath)) return null;
    return fs.createReadStream(filePath);
  }

  // ══════════════════════════════════════════
  //  Delete Operations
  // ══════════════════════════════════════════

  /**
   * Remove a file by ID (deletes from disk + DB)
   * @param {string} id
   * @returns {boolean}
   */
  remove(id) {
    const entry = db.findFile(this._db, id);
    if (!entry) return false;

    const filePath = this._resolveFilePath(entry.bucket, entry.stored_name);

    // Delete from disk
    try {
      if (entry.is_directory) {
        if (fs.existsSync(filePath)) {
          fs.rmSync(filePath, { recursive: true, force: true });
        }
      } else {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        // For uuid-dir mode, also clean up the parent UUID directory if empty
        if (this.buckets[entry.bucket]?.mode === 'uuid-dir') {
          const parentDir = path.dirname(filePath);
          try {
            const remaining = fs.readdirSync(parentDir);
            if (remaining.length === 0) {
              fs.rmdirSync(parentDir);
            }
          } catch (_) { /* ignore */ }
        }
      }
    } catch (_) {
      // File might already be gone — still clean DB
    }

    return db.deleteFile(this._db, id);
  }

  /**
   * Remove all files with a given tag (deletes from disk + DB)
   * @param {string} tag
   * @param {string} [bucket]
   * @returns {number} number of files removed
   */
  removeByTag(tag, bucket) {
    const files = db.findByTag(this._db, tag, bucket);
    if (files.length === 0) return 0;

    for (const entry of files) {
      const filePath = this._resolveFilePath(entry.bucket, entry.stored_name);
      try {
        if (entry.is_directory) {
          if (fs.existsSync(filePath)) {
            fs.rmSync(filePath, { recursive: true, force: true });
          }
        } else {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          if (this.buckets[entry.bucket]?.mode === 'uuid-dir') {
            const parentDir = path.dirname(filePath);
            try {
              const remaining = fs.readdirSync(parentDir);
              if (remaining.length === 0) fs.rmdirSync(parentDir);
            } catch (_) { /* ignore */ }
          }
        }
      } catch (_) {
        // best effort
      }
    }

    const deletedIds = db.deleteByTag(this._db, tag, bucket);
    return deletedIds.length;
  }

  // ══════════════════════════════════════════
  //  Tags
  // ══════════════════════════════════════════

  /**
   * Increment download count
   * @param {string} id
   */
  incrementDownloads(id) {
    db.incrementDownloads(this._db, id);
  }

  addTag(id, tag) { db.addTag(this._db, id, tag); }
  removeTag(id, tag) { db.removeTag(this._db, id, tag); }
  getTags(id) { return db.getTags(this._db, id); }

  // ══════════════════════════════════════════
  //  Stats
  // ══════════════════════════════════════════

  /**
   * Get storage statistics
   * @param {string} [bucket]
   * @returns {{ totalFiles: number, totalBytes: number, buckets?: object }}
   */
  stats(bucket) {
    return db.getStats(this._db, bucket);
  }

  userStats(userId) {
    return db.getUserStats(this._db, userId);
  }

  backfillUserId(userId) {
    return db.backfillUserId(this._db, userId);
  }

  // ══════════════════════════════════════════
  //  Internal
  // ══════════════════════════════════════════

  /**
   * Resolve stored_name based on bucket mode
   */
  _resolveStoredName(bucket, id, filename) {
    const mode = this.buckets[bucket].mode;
    if (mode === 'flat') {
      return filename;
    }
    // uuid-dir: {uuid}/{filename}
    return `${id}/${filename}`;
  }

  /**
   * Resolve absolute file path from bucket + stored_name
   */
  _resolveFilePath(bucket, storedName) {
    return path.join(this.dataDir, bucket, storedName);
  }

  /**
   * Validate that a bucket is configured
   */
  _validateBucket(bucket) {
    if (!this.buckets[bucket]) {
      throw new Error(`PokkitStore: unknown bucket "${bucket}". Configured: ${Object.keys(this.buckets).join(', ')}`);
    }
  }

  /**
   * Calculate total size of files in a directory (recursive)
   */
  _dirSize(dirPath) {
    let total = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += this._dirSize(fullPath);
      } else {
        total += fs.statSync(fullPath).size;
      }
    }
    return total;
  }

  // ══════════════════════════════════════════
  //  Photo Operations
  // ══════════════════════════════════════════

  /**
   * Save raw photo buffer for deferred processing.
   * Returns immediately with status='processing' (or deduped entry).
   */
  saveRawPhoto(filename, mime, buffer, opts = {}) {
    const bucket = opts.bucket || 'default';
    this._validateBucket(bucket);

    const hash = hashBuffer(buffer);

    // Dedup: check if identical photo already exists
    const existing = db.findByHash(this._db, hash, bucket);
    const ready = existing.find(e => e.status === 'ready');
    if (ready) {
      return { ...ready, deduplicated: true };
    }

    const id = shortId();
    const ext = path.extname(filename) || '.jpg';
    const rawName = `_raw${ext}`;
    const storedName = `${id}/${rawName}`;
    const destPath = this._resolveFilePath(bucket, storedName);

    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(destPath, buffer);

    const entry = {
      id,
      bucket,
      filename,
      stored_name: storedName,
      mime,
      size: buffer.length,
      hash,
      is_directory: false,
      uploaded_at: Date.now(),
      metadata: null,
      password_hash: opts.password_hash || null,
      expires_at: opts.expires_at || null,
      download_count: 0,
      album_id: opts.album_id || null,
      status: 'processing',
      user_id: opts.user_id || null,
    };

    db.insertFile(this._db, entry);

    const rawPath = destPath;
    return { ...entry, is_directory: false, deduplicated: false, rawPath };
  }

  /**
   * Finalize photo after worker processing.
   * Writes compressed + thumb, deletes raw, updates DB.
   */
  finalizePhoto(id, { webpBuffer, thumbBuffer, width, height, takenAt }) {
    const entry = db.findFile(this._db, id);
    if (!entry) return false;

    const bucket = entry.bucket;
    const photoName = `${id}/photo.webp`;
    const thumbName = `${id}/thumb.webp`;

    const photoPath = this._resolveFilePath(bucket, photoName);
    const thumbPath = this._resolveFilePath(bucket, thumbName);

    fs.writeFileSync(photoPath, webpBuffer);
    fs.writeFileSync(thumbPath, thumbBuffer);

    // Delete raw temp file
    const rawPath = this._resolveFilePath(bucket, entry.stored_name);
    try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath); } catch {}

    db.updateFilePhoto(this._db, id, {
      status: 'ready',
      stored_name: photoName,
      thumb_stored_name: thumbName,
      mime: 'image/webp',
      size: webpBuffer.length,
      width,
      height,
      taken_at: takenAt,
    });

    return true;
  }

  /**
   * Mark photo processing as failed
   */
  failPhoto(id, error) {
    db.updateFilePhoto(this._db, id, {
      status: 'failed',
      metadata: { error: String(error) },
    });
  }

  /**
   * Get absolute path for a thumbnail
   */
  getThumbPath(id) {
    const entry = db.findFile(this._db, id);
    if (!entry || !entry.thumb_stored_name) return null;
    return this._resolveFilePath(entry.bucket, entry.thumb_stored_name);
  }

  /**
   * Find photos stuck in 'processing' state (for crash recovery)
   */
  listStuckProcessing() {
    return db.listStuckProcessing(this._db);
  }

  // ══════════════════════════════════════════
  //  Album Operations
  // ══════════════════════════════════════════

  createAlbum(name) {
    const id = shortId();
    const now = Date.now();
    const album = { id, name, created_at: now, updated_at: now };
    db.insertAlbum(this._db, album);
    return album;
  }

  getAlbum(id) {
    return db.findAlbum(this._db, id);
  }

  listAlbums() {
    return db.listAlbums(this._db);
  }

  updateAlbum(id, updates) {
    return db.updateAlbum(this._db, id, updates);
  }

  deleteAlbum(id) {
    return db.deleteAlbum(this._db, id);
  }

  listPhotosByAlbum(albumId, opts) {
    return db.listPhotosByAlbum(this._db, albumId, opts);
  }

  moveToAlbum(fileId, albumId) {
    return db.updateFilePhoto(this._db, fileId, { album_id: albumId });
  }

  bulkMoveToAlbum(photoIds, albumId) {
    return db.bulkMoveToAlbum(this._db, photoIds, albumId);
  }

  listAllPhotos(opts) {
    return db.listAllPhotos(this._db, opts);
  }

  /**
   * Close the database connection
   */
  close() {
    db.closeDb();
  }
}

module.exports = PokkitStore;
