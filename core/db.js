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
    INSERT INTO files (id, bucket, filename, stored_name, mime, size, hash, is_directory, uploaded_at, metadata, password_hash, expires_at, download_count, album_id, taken_at, width, height, thumb_stored_name, status)
    VALUES (@id, @bucket, @filename, @stored_name, @mime, @size, @hash, @is_directory, @uploaded_at, @metadata, @password_hash, @expires_at, @download_count, @album_id, @taken_at, @width, @height, @thumb_stored_name, @status)
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

// ── Albums ──

function insertAlbum(db, album) {
  db.prepare(`
    INSERT INTO albums (id, name, cover_file_id, created_at, updated_at)
    VALUES (@id, @name, @cover_file_id, @created_at, @updated_at)
  `).run({
    id: album.id,
    name: album.name,
    cover_file_id: album.cover_file_id || null,
    created_at: album.created_at,
    updated_at: album.updated_at,
  });
}

function findAlbum(db, id) {
  return db.prepare('SELECT * FROM albums WHERE id = ?').get(id) || null;
}

function listAlbums(db) {
  return db.prepare(`
    SELECT a.*,
      COUNT(f.id) as photo_count,
      COALESCE(SUM(f.size), 0) as total_size
    FROM albums a
    LEFT JOIN files f ON f.album_id = a.id AND f.status = 'ready'
    GROUP BY a.id
    ORDER BY a.created_at DESC
  `).all();
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
  const { limit = 200, offset = 0 } = opts;
  return db.prepare(`
    SELECT * FROM files
    WHERE album_id = ? AND status = 'ready'
    ORDER BY COALESCE(taken_at, uploaded_at) ASC
    LIMIT ? OFFSET ?
  `).all(albumId, limit, offset).map(deserializeRow);
}

function updateFilePhoto(db, id, updates) {
  const fields = [];
  const values = { id };
  for (const key of ['status', 'width', 'height', 'taken_at', 'thumb_stored_name', 'stored_name', 'mime', 'size', 'album_id']) {
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
  insertAlbum,
  findAlbum,
  listAlbums,
  updateAlbum,
  deleteAlbum,
  listPhotosByAlbum,
  updateFilePhoto,
  countByAlbum,
  listStuckProcessing,
};
