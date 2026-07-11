'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');

/** Generate a short URL-safe ID (8 chars, ~48 bits of entropy) */
function shortId() {
  return randomBytes(6).toString('base64url');
}

/** Slugify a project name into a stable account id (lowercase, a-z0-9-). */
function slugify(name) {
  const s = String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'project';
}

/** sha-256 hex of an API key — only the hash is ever persisted. */
function hashKey(key) {
  return createHash('sha256').update(String(key)).digest('hex');
}

/**
 * Atomically persist a buffer: write to a sibling temp file, fsync, then rename
 * into place (rename within a dir is atomic on POSIX + NTFS). A crash / ENOSPC
 * mid-write leaves only the temp file — never a truncated file at the canonical
 * path that a DB row already marks "ready".
 */
function atomicWriteFileSync(destPath, buffer) {
  const tmp = `${destPath}.tmp-${randomBytes(4).toString('hex')}`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, buffer, 0, buffer.length, 0);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, destPath);
  } catch (err) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }
}

/** Atomically move a file already on disk into place (same volume). */
function atomicMoveSync(srcPath, destPath) {
  const tmp = `${destPath}.tmp-${randomBytes(4).toString('hex')}`;
  try {
    fs.copyFileSync(srcPath, tmp);
    const fd = fs.openSync(tmp, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, destPath);
    try { fs.unlinkSync(srcPath); } catch {}
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }
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

    // Dedup: identical content already stored. Skip when this upload sets a
    // password or expiry, so protected/temporary copies stay independent.
    if (!opts.password_hash && !opts.expires_at) {
      const existing = db.findByHash(this._db, hash, bucket);
      const match = existing.find(e => !e.is_directory && !e.expires_at && !e.password_hash);
      if (match) {
        return { ...match, deduplicated: true };
      }
    }

    const storedName = this._resolveStoredName(bucket, id, filename);
    const destPath = this._resolveFilePath(bucket, storedName);

    // Ensure parent dir exists
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    atomicWriteFileSync(destPath, buffer);

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
   * Delete every file whose expiry has passed (disk + DB). Called periodically
   * so expired shares stop being served AND stop occupying disk/quota.
   * @returns {number} how many were removed
   */
  sweepExpired(now = Date.now()) {
    let removed = 0;
    for (const id of db.listExpiredIds(this._db, now)) {
      try {
        if (this.remove(id)) removed++;
      } catch (_) { /* keep sweeping the rest */ }
    }
    return removed;
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

  userMediaCounts(userId) {
    return db.userMediaCounts(this._db, userId);
  }

  backfillUserId(userId) {
    return db.backfillUserId(this._db, userId);
  }

  // ══════════════════════════════════════════
  //  Accounts (multi-tenant)
  // ══════════════════════════════════════════

  /**
   * Create a project account. The account id is a slug of the name (uniqued).
   * Returns the account plus the plaintext key — the key is shown ONCE and only
   * its hash is stored.
   * @param {string} name
   * @param {{ isAdmin?: boolean }} [opts]
   * @returns {{ account: object, key: string }}
   */
  createAccount(name, opts = {}) {
    const base = slugify(name);
    let id = base;
    let n = 2;
    while (db.findAccount(this._db, id)) {
      id = `${base}-${n++}`;
    }

    const key = `pk_${id}_${randomBytes(16).toString('hex')}`;
    const account = {
      id,
      name: String(name),
      key_hash: hashKey(key),
      key_prefix: key.slice(0, 14),
      is_admin: opts.isAdmin ? 1 : 0,
      quota_files: null,
      created_at: Date.now(),
      last_used_at: null,
    };
    db.insertAccount(this._db, account);
    return { account, key };
  }

  /** Resolve an API key to its account, bumping last_used_at. Null if unknown. */
  resolveAccountByKey(key) {
    if (!key) return null;
    const account = db.findAccountByKeyHash(this._db, hashKey(key));
    if (account) db.touchAccount(this._db, account.id, Date.now());
    return account;
  }

  getAccount(id) {
    return db.findAccount(this._db, id);
  }

  listAccounts() {
    return db.listAccounts(this._db);
  }

  /** Issue a fresh key for an account (invalidates the old one). Returns { key }. */
  rotateAccountKey(id) {
    const account = db.findAccount(this._db, id);
    if (!account) return null;
    const key = `pk_${id}_${randomBytes(16).toString('hex')}`;
    db.updateAccountKey(this._db, id, hashKey(key), key.slice(0, 14));
    return { key };
  }

  countFilesByUser(userId) {
    return db.countFilesByUser(this._db, userId);
  }

  listFilesByUser(userId, opts) {
    return db.listFilesByUser(this._db, userId, opts);
  }

  /**
   * Delete an account. When wipeFiles is set, every file owned by the account is
   * removed from disk + DB first; otherwise the account's files are left intact.
   */
  deleteAccount(id, opts = {}) {
    if (opts.wipeFiles) {
      for (const fid of db.listFileIdsByUser(this._db, id)) {
        this.remove(fid);
      }
    }
    return db.deleteAccount(this._db, id);
  }

  // ══════════════════════════════════════════
  //  Internal
  // ══════════════════════════════════════════

  /**
   * Resolve stored_name based on bucket mode
   */
  _resolveStoredName(bucket, id, filename) {
    // 🔒 Never let a caller-supplied filename influence the directory: strip any
    // path separators/traversal so `../../public/app.js` can't escape the bucket.
    // The original (display) name is stored separately in entry.filename.
    const safe = path.basename(String(filename || '')).replace(/^\.+/, '') || 'file';
    const mode = this.buckets[bucket].mode;
    if (mode === 'flat') {
      return safe;
    }
    // uuid-dir: {uuid}/{filename}
    return `${id}/${safe}`;
  }

  /**
   * Resolve absolute file path from bucket + stored_name.
   * 🔒 Defense-in-depth: assert the resolved path stays inside the bucket dir so
   * a crafted stored_name (or legacy bad row) can never read/write outside data/.
   */
  _resolveFilePath(bucket, storedName) {
    const base = path.join(this.dataDir, bucket);
    const full = path.join(base, storedName);
    const rel = path.relative(base, full);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
      throw new Error(`PokkitStore: path escapes bucket "${bucket}": ${storedName}`);
    }
    return full;
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

    // Dedup: check if identical photo/video already exists.
    // 也要認 'processing' — 佇列堵塞時第一份還沒 ready,正是使用者最容易重傳的時刻
    // (2026-07-11 實案:IMG_5902.mov 在 452MB 佇列堵塞期間被重傳成兩份)。
    // failed 不算重複(讓重新上傳能重試)。以 user 隔離,租戶之間不共用條目。
    const existing = db.findByHash(this._db, hash, bucket);
    const owner = opts.user_id || null;
    const match = existing.find(e =>
      (e.status === 'ready' || e.status === 'processing') && (e.user_id || null) === owner
    );
    if (match) {
      return { ...match, deduplicated: true };
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
    atomicWriteFileSync(destPath, buffer);

    const mediaType = opts.media_type || 'photo';
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
      media_type: mediaType,
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

    atomicWriteFileSync(photoPath, webpBuffer);
    atomicWriteFileSync(thumbPath, thumbBuffer);

    // Keep raw file — user can access originals at data/{bucket}/{id}/_raw.*

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
   * Finalize video after worker processing.
   * Writes compressed video + thumb, deletes raw, updates DB.
   */
  finalizeVideo(id, { videoPath: compressedPath, thumbBuffer, width, height, duration, takenAt }) {
    const entry = db.findFile(this._db, id);
    if (!entry) return false;

    const bucket = entry.bucket;
    const videoName = `${id}/video.mp4`;
    const thumbName = `${id}/thumb.webp`;

    const destVideoPath = this._resolveFilePath(bucket, videoName);
    const thumbPath = this._resolveFilePath(bucket, thumbName);

    // Move compressed video (already on disk from ffmpeg) into place atomically
    atomicMoveSync(compressedPath, destVideoPath);
    atomicWriteFileSync(thumbPath, thumbBuffer);

    // Keep raw file — user can access originals at data/{bucket}/{id}/_raw.*

    const videoSize = fs.statSync(destVideoPath).size;
    db.updateFilePhoto(this._db, id, {
      status: 'ready',
      stored_name: videoName,
      thumb_stored_name: thumbName,
      mime: 'video/mp4',
      size: videoSize,
      width,
      height,
      duration,
      taken_at: takenAt,
      media_type: 'video',
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

  /**
   * 轉檔失敗的影片(_raw 還在就能重跑)——供開機恢復撿回 ffmpeg 缺席時期的 failed。
   */
  listFailedVideos() {
    return db.listFailedVideos(this._db);
  }

  // ══════════════════════════════════════════
  //  Album Operations
  // ══════════════════════════════════════════

  createAlbum(name, userId = null) {
    const id = shortId();
    const now = Date.now();
    const album = { id, name, created_at: now, updated_at: now, user_id: userId };
    db.insertAlbum(this._db, album);
    return album;
  }

  getAlbum(id) {
    return db.findAlbum(this._db, id);
  }

  listAlbums(opts = {}) {
    return db.listAlbums(this._db, opts);
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

  bulkMoveToAlbum(photoIds, albumId, opts = {}) {
    return db.bulkMoveToAlbum(this._db, photoIds, albumId, opts);
  }

  listAllPhotos(opts) {
    return db.listAllPhotos(this._db, opts);
  }

  updatePhotoNotes(id, notes) {
    return db.updateFilePhoto(this._db, id, { notes });
  }

  /**
   * Close the database connection
   */
  close() {
    db.closeDb();
  }
}

module.exports = PokkitStore;
