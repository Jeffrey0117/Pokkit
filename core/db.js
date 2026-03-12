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
    INSERT INTO files (id, bucket, filename, stored_name, mime, size, hash, is_directory, uploaded_at, metadata, password_hash, expires_at, download_count)
    VALUES (@id, @bucket, @filename, @stored_name, @mime, @size, @hash, @is_directory, @uploaded_at, @metadata, @password_hash, @expires_at, @download_count)
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
  const { bucket, limit = 100, offset = 0 } = opts;
  if (bucket) {
    return db.prepare('SELECT * FROM files WHERE bucket = ? ORDER BY uploaded_at DESC LIMIT ? OFFSET ?')
      .all(bucket, limit, offset).map(deserializeRow);
  }
  return db.prepare('SELECT * FROM files ORDER BY uploaded_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset).map(deserializeRow);
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

// ── Helpers ──

function deserializeRow(row) {
  return {
    ...row,
    is_directory: !!row.is_directory,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  };
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
  incrementDownloads,
};
