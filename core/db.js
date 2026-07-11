'use strict';

const path = require('node:path');

/** @type {import('better-sqlite3').Database | null} */
let _db = null;
let _dbPath = null;

/**
 * Open (or return existing) SQLite database
 * @param {string} dbPath
 * @returns {import('better-sqlite3').Database}
 */
function openDb(dbPath) {
  if (_db && _dbPath === dbPath) return _db;

  const Database = require('better-sqlite3');
  _db = new Database(dbPath);
  _dbPath = dbPath;

  _db.pragma('journal_mode = WAL');
  _db.pragma('busy_timeout = 5000');
  _db.pragma('foreign_keys = ON');
  // Under WAL, NORMAL is safe (only a power-loss can drop the last txn — never
  // corruption) and skips an fsync on every commit: big win on the write-heavy
  // upload-finalize / download-count / touchAccount paths.
  _db.pragma('synchronous = NORMAL');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      bucket TEXT NOT NULL,
      filename TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      hash TEXT,
      is_directory INTEGER DEFAULT 0,
      uploaded_at INTEGER NOT NULL,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS file_tags (
      file_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (file_id, tag),
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_files_bucket ON files(bucket);
    CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);
    CREATE INDEX IF NOT EXISTS idx_file_tags_tag ON file_tags(tag);
  `);

  // ── Migrations ──
  const cols = _db.prepare("PRAGMA table_info(files)").all().map(c => c.name);
  if (!cols.includes('password_hash')) {
    _db.exec('ALTER TABLE files ADD COLUMN password_hash TEXT');
  }
  if (!cols.includes('expires_at')) {
    _db.exec('ALTER TABLE files ADD COLUMN expires_at INTEGER');
  }
  if (!cols.includes('download_count')) {
    _db.exec('ALTER TABLE files ADD COLUMN download_count INTEGER DEFAULT 0');
  }
  if (!cols.includes('album_id')) {
    _db.exec('ALTER TABLE files ADD COLUMN album_id TEXT');
    _db.exec('CREATE INDEX IF NOT EXISTS idx_files_album ON files(album_id)');
  }
  if (!cols.includes('taken_at')) {
    _db.exec('ALTER TABLE files ADD COLUMN taken_at INTEGER');
  }
  if (!cols.includes('width')) {
    _db.exec('ALTER TABLE files ADD COLUMN width INTEGER');
  }
  if (!cols.includes('height')) {
    _db.exec('ALTER TABLE files ADD COLUMN height INTEGER');
  }
  if (!cols.includes('thumb_stored_name')) {
    _db.exec('ALTER TABLE files ADD COLUMN thumb_stored_name TEXT');
  }
  if (!cols.includes('status')) {
    _db.exec("ALTER TABLE files ADD COLUMN status TEXT DEFAULT 'ready'");
    _db.exec('CREATE INDEX IF NOT EXISTS idx_files_status ON files(status)');
  }
  if (!cols.includes('user_id')) {
    _db.exec('ALTER TABLE files ADD COLUMN user_id TEXT');
    _db.exec('CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id)');
  }
  if (!cols.includes('duration')) {
    _db.exec('ALTER TABLE files ADD COLUMN duration INTEGER');
  }
  if (!cols.includes('media_type')) {
    _db.exec("ALTER TABLE files ADD COLUMN media_type TEXT DEFAULT 'file'");
    // Backfill existing photos
    _db.exec("UPDATE files SET media_type = 'photo' WHERE mime LIKE 'image/%' AND media_type = 'file'");
  }
  if (!cols.includes('notes')) {
    _db.exec('ALTER TABLE files ADD COLUMN notes TEXT');
  }

  // Albums table
  _db.exec(`
    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cover_file_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_albums_created ON albums(created_at);
  `);
  // Albums are per-tenant: user_id scopes them the same way files.user_id does.
  // Legacy albums (created before this column) are user_id NULL → owner-only.
  const albumCols = _db.prepare('PRAGMA table_info(albums)').all().map(c => c.name);
  if (!albumCols.includes('user_id')) {
    _db.exec('ALTER TABLE albums ADD COLUMN user_id TEXT');
    _db.exec('CREATE INDEX IF NOT EXISTS idx_albums_user ON albums(user_id)');
  }

  // ── Timeline indexes ──
  // The photo/video grids sort by COALESCE(taken_at, uploaded_at). Without an
  // index on that expression, every paginated query does a full scan + sort
  // (and OFFSET makes deeper scrolls progressively slower). These expression
  // indexes let SQLite satisfy the WHERE filter + ORDER BY directly.
  _db.exec(`
    CREATE INDEX IF NOT EXISTS idx_files_media_time
      ON files(media_type, COALESCE(taken_at, uploaded_at));
    CREATE INDEX IF NOT EXISTS idx_files_album_time
      ON files(album_id, COALESCE(taken_at, uploaded_at));
    CREATE INDEX IF NOT EXISTS idx_files_user_uploaded
      ON files(user_id, uploaded_at);
  `);

  // ── Accounts (multi-tenant) ──
  // Each project that stores files in pokkit is an account. Its id doubles as
  // the files.user_id, so existing per-user scoping isolates tenants for free.
  // Only the sha-256 of the API key is stored — the plaintext is shown once.
  _db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      key_hash     TEXT NOT NULL,
      key_prefix   TEXT NOT NULL,
      is_admin     INTEGER DEFAULT 0,
      quota_files  INTEGER,
      created_at   INTEGER NOT NULL,
      last_used_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_accounts_key_hash ON accounts(key_hash);
  `);

  return _db;
}

/**
 * Close the database (for graceful shutdown)
 */
function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
    _dbPath = null;
  }
}

// ── File CRUD ──

/**
 * @param {import('better-sqlite3').Database} db
 * @param {object} entry
 */
function insertFile(db, entry) {
  const stmt = db.prepare(`
    INSERT INTO files (id, bucket, filename, stored_name, mime, size, hash, is_directory, uploaded_at, metadata, password_hash, expires_at, download_count, album_id, taken_at, width, height, thumb_stored_name, status, user_id, duration, media_type)
    VALUES (@id, @bucket, @filename, @stored_name, @mime, @size, @hash, @is_directory, @uploaded_at, @metadata, @password_hash, @expires_at, @download_count, @album_id, @taken_at, @width, @height, @thumb_stored_name, @status, @user_id, @duration, @media_type)
  `);
  stmt.run({
    id: entry.id,
    bucket: entry.bucket,
    filename: entry.filename,
    stored_name: entry.stored_name,
    mime: entry.mime,
    size: entry.size,
    hash: entry.hash || null,
    is_directory: entry.is_directory ? 1 : 0,
    uploaded_at: entry.uploaded_at,
    metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
    password_hash: entry.password_hash || null,
    expires_at: entry.expires_at || null,
    download_count: entry.download_count || 0,
    album_id: entry.album_id || null,
    taken_at: entry.taken_at || null,
    width: entry.width || null,
    height: entry.height || null,
    thumb_stored_name: entry.thumb_stored_name || null,
    status: entry.status || 'ready',
    user_id: entry.user_id || null,
    duration: entry.duration || null,
    media_type: entry.media_type || 'file',
  });
}

/**
 * Increment download count for a file
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 */
function incrementDownloads(db, id) {
  db.prepare('UPDATE files SET download_count = download_count + 1 WHERE id = ?').run(id);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @returns {object|null}
 */
function findFile(db, id) {
  const row = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
  return row ? deserializeRow(row) : null;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} hash
 * @param {string} [bucket]
 * @returns {object[]}
 */
function findByHash(db, hash, bucket) {
  if (bucket) {
    return db.prepare('SELECT * FROM files WHERE hash = ? AND bucket = ?')
      .all(hash, bucket).map(deserializeRow);
  }
  return db.prepare('SELECT * FROM files WHERE hash = ?')
    .all(hash).map(deserializeRow);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} tag
 * @param {string} [bucket]
 * @returns {object[]}
 */
function findByTag(db, tag, bucket) {
  if (bucket) {
    return db.prepare(`
      SELECT f.* FROM files f
      JOIN file_tags t ON f.id = t.file_id
      WHERE t.tag = ? AND f.bucket = ?
    `).all(tag, bucket).map(deserializeRow);
  }
  return db.prepare(`
    SELECT f.* FROM files f
    JOIN file_tags t ON f.id = t.file_id
    WHERE t.tag = ?
  `).all(tag).map(deserializeRow);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ bucket?: string, limit?: number, offset?: number }} opts
 * @returns {object[]}
 */
function listFiles(db, opts = {}) {
  const { bucket, limit = 100, offset = 0, order, excludeAccounts, userId } = opts;
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  const params = [];
  let where = '1=1';
  if (bucket) { where += ' AND bucket = ?'; params.push(bucket); }
  // Scope by account, or exclude project-account files from the owner's view.
  if (userId) {
    where += ' AND user_id = ?';
    params.push(userId);
  } else if (excludeAccounts) {
    where += " AND (user_id IS NULL OR user_id NOT IN (SELECT id FROM accounts))";
  }
  return db.prepare(`SELECT * FROM files WHERE ${where} ORDER BY uploaded_at ${dir} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset).map(deserializeRow);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @returns {boolean}
 */
function deleteFile(db, id) {
  // file_tags cascade-deleted by FK
  const result = db.prepare('DELETE FROM files WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} tag
 * @param {string} [bucket]
 * @returns {string[]} deleted file IDs
 */
function deleteByTag(db, tag, bucket) {
  const files = findByTag(db, tag, bucket);
  const ids = files.map(f => f.id);
  if (ids.length === 0) return [];

  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM files WHERE id IN (${placeholders})`).run(...ids);
  return ids;
}

// ── Tags ──

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} fileId
 * @param {string} tag
 */
function addTag(db, fileId, tag) {
  db.prepare('INSERT OR IGNORE INTO file_tags (file_id, tag) VALUES (?, ?)')
    .run(fileId, tag);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} fileId
 * @param {string} tag
 */
function removeTag(db, fileId, tag) {
  db.prepare('DELETE FROM file_tags WHERE file_id = ? AND tag = ?')
    .run(fileId, tag);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} fileId
 * @returns {string[]}
 */
function getTags(db, fileId) {
  return db.prepare('SELECT tag FROM file_tags WHERE file_id = ?')
    .all(fileId).map(r => r.tag);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} fileId
 * @param {string[]} tags
 */
function setTags(db, fileId, tags) {
  const insert = db.prepare('INSERT OR IGNORE INTO file_tags (file_id, tag) VALUES (?, ?)');
  const tx = db.transaction((fid, tagList) => {
    for (const tag of tagList) {
      insert.run(fid, tag);
    }
  });
  tx(fileId, tags);
}

// ── Stats ──

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} [bucket]
 * @returns {{ totalFiles: number, totalBytes: number, buckets?: object }}
 */
function getStats(db, bucket) {
  if (bucket) {
    const row = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(size),0) as bytes FROM files WHERE bucket = ?')
      .get(bucket);
    return { totalFiles: row.count, totalBytes: row.bytes };
  }

  const overall = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(size),0) as bytes FROM files').get();
  const bucketRows = db.prepare(
    'SELECT bucket, COUNT(*) as count, COALESCE(SUM(size),0) as bytes FROM files GROUP BY bucket'
  ).all();

  const buckets = {};
  for (const r of bucketRows) {
    buckets[r.bucket] = { totalFiles: r.count, totalBytes: r.bytes };
  }

  return { totalFiles: overall.count, totalBytes: overall.bytes, buckets };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @returns {{ totalFiles: number, totalBytes: number }}
 */
function getUserStats(db, userId) {
  const row = db.prepare(
    'SELECT COUNT(*) as count, COALESCE(SUM(size),0) as bytes FROM files WHERE user_id = ?'
  ).get(userId);
  return { totalFiles: row.count, totalBytes: row.bytes };
}

/**
 * Per-media-type counts for a user.
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @returns {Array<{ media_type: string, c: number, b: number }>}
 */
function userMediaCounts(db, userId) {
  return db.prepare(
    'SELECT media_type, COUNT(*) as c, COALESCE(SUM(size),0) as b FROM files WHERE user_id = ? GROUP BY media_type'
  ).all(userId);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @returns {number} number of rows updated
 */
function backfillUserId(db, userId) {
  const result = db.prepare('UPDATE files SET user_id = ? WHERE user_id IS NULL').run(userId);
  return result.changes;
}

// ── Albums ──

function insertAlbum(db, album) {
  db.prepare(`
    INSERT INTO albums (id, name, cover_file_id, created_at, updated_at, user_id)
    VALUES (@id, @name, @cover_file_id, @created_at, @updated_at, @user_id)
  `).run({
    id: album.id,
    name: album.name,
    cover_file_id: album.cover_file_id || null,
    created_at: album.created_at,
    updated_at: album.updated_at,
    user_id: album.user_id || null,
  });
}

function findAlbum(db, id) {
  return db.prepare('SELECT * FROM albums WHERE id = ?').get(id) || null;
}

// A tenant (userId set) sees only its own albums; the owner/admin (userId
// undefined) sees all. Legacy NULL-owner albums surface only for the owner.
function listAlbums(db, opts = {}) {
  const scoped = opts.userId != null;
  return db.prepare(`
    SELECT a.id, a.name, a.created_at, a.updated_at,
      COALESCE(a.cover_file_id, (
        SELECT id FROM files
        WHERE album_id = a.id AND status = 'ready' AND media_type IN ('photo', 'video')
        ORDER BY COALESCE(taken_at, uploaded_at) ASC
        LIMIT 1
      )) as cover_file_id,
      COUNT(f.id) as photo_count,
      COALESCE(SUM(f.size), 0) as total_size
    FROM albums a
    LEFT JOIN files f ON f.album_id = a.id AND f.status = 'ready'
    ${scoped ? 'WHERE a.user_id = @userId' : ''}
    GROUP BY a.id
    ORDER BY a.created_at DESC
  `).all(scoped ? { userId: opts.userId } : {});
}

function updateAlbum(db, id, updates) {
  const fields = [];
  const values = {};
  if (updates.name !== undefined) {
    fields.push('name = @name');
    values.name = updates.name;
  }
  if (updates.cover_file_id !== undefined) {
    fields.push('cover_file_id = @cover_file_id');
    values.cover_file_id = updates.cover_file_id;
  }
  if (fields.length === 0) return false;
  fields.push('updated_at = @updated_at');
  values.updated_at = Date.now();
  values.id = id;
  const result = db.prepare(`UPDATE albums SET ${fields.join(', ')} WHERE id = @id`).run(values);
  return result.changes > 0;
}

function deleteAlbum(db, id) {
  // Set album_id to null on photos (keep photos)
  db.prepare('UPDATE files SET album_id = NULL WHERE album_id = ?').run(id);
  const result = db.prepare('DELETE FROM albums WHERE id = ?').run(id);
  return result.changes > 0;
}

// ── Photo Queries ──

function listPhotosByAlbum(db, albumId, opts = {}) {
  const { limit = 200, offset = 0, order } = opts;
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  return db.prepare(`
    SELECT * FROM files
    WHERE album_id = ? AND status IN ('ready', 'processing')
    ORDER BY uploaded_at ${dir}
    LIMIT ? OFFSET ?
  `).all(albumId, limit, offset).map(deserializeRow);
}

function updateFilePhoto(db, id, updates) {
  const fields = [];
  const values = { id };
  for (const key of ['status', 'width', 'height', 'taken_at', 'thumb_stored_name', 'stored_name', 'mime', 'size', 'album_id', 'duration', 'media_type', 'notes']) {
    if (updates[key] !== undefined) {
      fields.push(`${key} = @${key}`);
      values[key] = updates[key];
    }
  }
  if (updates.metadata !== undefined) {
    fields.push('metadata = @metadata');
    values.metadata = updates.metadata ? JSON.stringify(updates.metadata) : null;
  }
  if (fields.length === 0) return false;
  const result = db.prepare(`UPDATE files SET ${fields.join(', ')} WHERE id = @id`).run(values);
  return result.changes > 0;
}

function countByAlbum(db, albumId) {
  const row = db.prepare("SELECT COUNT(*) as count FROM files WHERE album_id = ? AND status = 'ready'").get(albumId);
  return row.count;
}

function listStuckProcessing(db) {
  return db.prepare("SELECT * FROM files WHERE status = 'processing'").all().map(deserializeRow);
}

/** 轉檔失敗的影片(_raw 還在就能重跑)——ffmpeg 缺席那批 failed 不會自己復活,開機時撿回來。 */
function listFailedVideos(db) {
  return db.prepare(
    "SELECT * FROM files WHERE status = 'failed' AND (media_type = 'video' OR mime LIKE 'video/%')"
  ).all().map(deserializeRow);
}

/** Ids of files whose expiry has passed (for the periodic sweep). */
function listExpiredIds(db, now) {
  return db.prepare(
    'SELECT id FROM files WHERE expires_at IS NOT NULL AND expires_at < ?'
  ).all(now).map((r) => r.id);
}

// ── Helpers ──

function deserializeRow(row) {
  return {
    ...row,
    is_directory: !!row.is_directory,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  };
}

// A tenant (userId set) can only move photos it owns; the owner/admin can move
// any. The user_id filter stops a project account relocating another's photos.
function bulkMoveToAlbum(db, photoIds, albumId, opts = {}) {
  const placeholders = photoIds.map(() => '?').join(',');
  const scoped = opts.userId != null;
  return db.prepare(
    `UPDATE files SET album_id = ? WHERE id IN (${placeholders})${scoped ? ' AND user_id = ?' : ''}`
  ).run(albumId, ...photoIds, ...(scoped ? [opts.userId] : []));
}

function listAllPhotos(db, opts = {}) {
  const { limit = 200, offset = 0, mediaType, order, excludeAccounts, userId } = opts;
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  // Scope: a specific account (userId) sees only its own; otherwise the owner's
  // grid excludes project-account files so tenant uploads don't pollute the
  // personal library. Null-safe: orphan (NULL) files still show for the owner.
  const params = [];
  let scope = '';
  if (userId) {
    scope = 'AND user_id = ?';
    params.push(userId);
  } else if (excludeAccounts) {
    scope = "AND (user_id IS NULL OR user_id NOT IN (SELECT id FROM accounts))";
  }
  const typeFilter = mediaType ? 'AND media_type = ?' : "AND media_type IN ('photo', 'video')";
  if (mediaType) params.push(mediaType);
  return db.prepare(`
    SELECT * FROM files
    WHERE status IN ('ready', 'processing') ${typeFilter} ${scope}
    ORDER BY uploaded_at ${dir}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset).map(deserializeRow);
}

// ── Accounts (multi-tenant) ──

function insertAccount(db, acc) {
  db.prepare(`
    INSERT INTO accounts (id, name, key_hash, key_prefix, is_admin, quota_files, created_at, last_used_at)
    VALUES (@id, @name, @key_hash, @key_prefix, @is_admin, @quota_files, @created_at, @last_used_at)
  `).run({
    id: acc.id,
    name: acc.name,
    key_hash: acc.key_hash,
    key_prefix: acc.key_prefix,
    is_admin: acc.is_admin ? 1 : 0,
    quota_files: acc.quota_files ?? null,
    created_at: acc.created_at,
    last_used_at: acc.last_used_at ?? null,
  });
}

function findAccount(db, id) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) || null;
}

function findAccountByKeyHash(db, keyHash) {
  return db.prepare('SELECT * FROM accounts WHERE key_hash = ?').get(keyHash) || null;
}

/** List accounts with per-account usage (file count + bytes). */
function listAccounts(db) {
  return db.prepare(`
    SELECT a.id, a.name, a.key_prefix, a.is_admin, a.quota_files, a.created_at, a.last_used_at,
      (SELECT COUNT(*) FROM files f WHERE f.user_id = a.id) AS file_count,
      (SELECT COALESCE(SUM(size), 0) FROM files f WHERE f.user_id = a.id) AS total_bytes
    FROM accounts a
    ORDER BY a.created_at DESC
  `).all();
}

function updateAccountKey(db, id, keyHash, keyPrefix) {
  return db.prepare('UPDATE accounts SET key_hash = ?, key_prefix = ? WHERE id = ?')
    .run(keyHash, keyPrefix, id).changes > 0;
}

function touchAccount(db, id, ts) {
  db.prepare('UPDATE accounts SET last_used_at = ? WHERE id = ?').run(ts, id);
}

function deleteAccount(db, id) {
  return db.prepare('DELETE FROM accounts WHERE id = ?').run(id).changes > 0;
}

function countFilesByUser(db, userId) {
  return db.prepare('SELECT COUNT(*) AS c FROM files WHERE user_id = ?').get(userId).c;
}

function listFileIdsByUser(db, userId) {
  return db.prepare('SELECT id FROM files WHERE user_id = ?').all(userId).map(r => r.id);
}

/** Browse one account's files (admin view), newest first by default. */
function listFilesByUser(db, userId, opts = {}) {
  const { limit = 200, offset = 0, order } = opts;
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  return db.prepare(`
    SELECT * FROM files
    WHERE user_id = ?
    ORDER BY uploaded_at ${dir}
    LIMIT ? OFFSET ?
  `).all(userId, limit, offset).map(deserializeRow);
}

module.exports = {
  openDb,
  closeDb,
  insertFile,
  findFile,
  findByHash,
  findByTag,
  listFiles,
  deleteFile,
  deleteByTag,
  addTag,
  removeTag,
  getTags,
  setTags,
  getStats,
  getUserStats,
  userMediaCounts,
  backfillUserId,
  incrementDownloads,
  insertAlbum,
  findAlbum,
  listAlbums,
  updateAlbum,
  deleteAlbum,
  listPhotosByAlbum,
  updateFilePhoto,
  countByAlbum,
  listStuckProcessing,
  listFailedVideos,
  listExpiredIds,
  bulkMoveToAlbum,
  listAllPhotos,
  insertAccount,
  findAccount,
  findAccountByKeyHash,
  listAccounts,
  updateAccountKey,
  touchAccount,
  deleteAccount,
  countFilesByUser,
  listFileIdsByUser,
  listFilesByUser,
};
