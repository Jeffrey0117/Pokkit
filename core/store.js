'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
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
   * @param {{ bucket?: string, tags?: string[], hash?: string, id?: string, metadata?: object }} [opts]
   * @returns {FileEntry}
   */
  save(filename, mime, buffer, opts = {}) {
    const bucket = opts.bucket || 'default';
    this._validateBucket(bucket);

    const id = opts.id || randomUUID();
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

    const id = opts.id || randomUUID();
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

    const id = opts.id || randomUUID();
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

  /**
   * Close the database connection
   */
  close() {
    db.closeDb();
  }
}

module.exports = PokkitStore;
