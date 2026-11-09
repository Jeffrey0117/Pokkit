// 會員管理的資料層:用量統計、封鎖名單、管理紀錄。
// 管理動作一律留紀錄,之後才查得到誰在什麼時候做了什麼。
export interface MemberRow {
  userId: string
  email: string | null
  files: number
  bytes: number
  lastUpload: number | null
  blocked: boolean
  blockReason: string | null
  kind: 'member' | 'guest' | 'project' | 'admin'
}

interface Db {
  exec(sql: string): void
  prepare(sql: string): {
    run(...args: unknown[]): { changes: number }
    get(...args: unknown[]): any
    all(...args: unknown[]): any[]
  }
}

const GUEST_PREFIX = 'guest:'

export class Moderation {
  constructor(private db: Db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS blocked_users (
        user_id TEXT PRIMARY KEY,
        reason TEXT,
        blocked_at INTEGER NOT NULL,
        blocked_by TEXT
      );
      CREATE TABLE IF NOT EXISTS member_profiles (
        user_id TEXT PRIMARY KEY,
        email TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS moderation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        admin TEXT NOT NULL,
        action TEXT NOT NULL,
        target_user TEXT,
        target_file TEXT,
        detail TEXT
      );
      CREATE TABLE IF NOT EXISTS guest_file_keys (
        file_id TEXT PRIMARY KEY,
        guest_key TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)
  }

  isBlocked(userId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM blocked_users WHERE user_id = ?').get(userId)
  }

  isGuestBlocked(guestKey: string): boolean {
    return this.isBlocked(GUEST_PREFIX + guestKey)
  }

  block(userId: string, reason: string | null, admin: string): void {
    this.db.prepare(
      'INSERT INTO blocked_users (user_id, reason, blocked_at, blocked_by) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET reason = excluded.reason, blocked_at = excluded.blocked_at, blocked_by = excluded.blocked_by'
    ).run(userId, reason, Date.now(), admin)
  }

  unblock(userId: string): boolean {
    return this.db.prepare('DELETE FROM blocked_users WHERE user_id = ?').run(userId).changes > 0
  }

  blockGuest(guestKey: string, reason: string | null, admin: string): void {
    this.block(GUEST_PREFIX + guestKey, reason, admin)
  }

  rememberProfile(userId: string, email: string): void {
    if (!email) return
    this.db.prepare(
      'INSERT INTO member_profiles (user_id, email, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at'
    ).run(userId, email, Date.now())
  }

  profileEmail(userId: string): string | null {
    return this.db.prepare('SELECT email FROM member_profiles WHERE user_id = ?').get(userId)?.email ?? null
  }

  // 訪客沒有帳號,要封鎖就得知道這個檔案是哪個來源傳的。只存雜湊。
  rememberGuestFile(fileId: string, guestKey: string): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO guest_file_keys (file_id, guest_key, created_at) VALUES (?, ?, ?)'
    ).run(fileId, guestKey, Date.now())
  }

  guestKeyOf(fileId: string): string | null {
    return this.db.prepare('SELECT guest_key FROM guest_file_keys WHERE file_id = ?').get(fileId)?.guest_key ?? null
  }

  // 訪客檔案最多留 24 小時,對應紀錄留兩天就夠
  pruneGuestFiles(now = Date.now()): void {
    this.db.prepare('DELETE FROM guest_file_keys WHERE created_at < ?').run(now - 2 * 24 * 3600 * 1000)
  }

  log(admin: string, action: string, target: { user?: string | null; file?: string | null; detail?: string | null }): void {
    this.db.prepare(
      'INSERT INTO moderation_log (at, admin, action, target_user, target_file, detail) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(Date.now(), admin, action, target.user ?? null, target.file ?? null, target.detail ?? null)
  }

  readLog(limit: number, offset: number) {
    return this.db.prepare(
      'SELECT at, admin, action, target_user AS targetUser, target_file AS targetFile, detail FROM moderation_log ORDER BY id DESC LIMIT ? OFFSET ?'
    ).all(limit, offset)
  }

  listMembers(limit: number, offset: number, isOwner: (userId: string, email: string | null) => boolean): { members: MemberRow[]; total: number } {
    const total = this.db.prepare(
      'SELECT COUNT(DISTINCT user_id) AS c FROM files WHERE deleted_at IS NULL AND user_id IS NOT NULL'
    ).get().c as number
    const rows = this.db.prepare(`
      SELECT f.user_id AS userId,
             COUNT(*) AS files,
             SUM(f.size + COALESCE(f.raw_size, 0)) AS bytes,
             MAX(f.uploaded_at) AS lastUpload,
             p.email AS email,
             b.user_id AS blockedId,
             b.reason AS blockReason,
             a.id AS accountId
      FROM files f
      LEFT JOIN member_profiles p ON p.user_id = f.user_id
      LEFT JOIN blocked_users b ON b.user_id = f.user_id
      LEFT JOIN accounts a ON a.id = f.user_id
      WHERE f.deleted_at IS NULL AND f.user_id IS NOT NULL
      GROUP BY f.user_id
      ORDER BY lastUpload DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset)
    const members = rows.map((r) => ({
      userId: r.userId,
      email: r.email ?? null,
      files: r.files,
      bytes: r.bytes,
      lastUpload: r.lastUpload,
      blocked: !!r.blockedId,
      blockReason: r.blockReason ?? null,
      kind: kindOf(r, isOwner),
    }))
    return { members, total }
  }

  isProjectAccount(userId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(userId)
  }

  listMemberFiles(userId: string, limit: number, offset: number) {
    return this.db.prepare(`
      SELECT id, filename, mime, size, raw_size AS rawSize, media_type AS mediaType, status,
             uploaded_at AS uploadedAt, expires_at AS expiresAt,
             thumb_stored_name AS thumb, download_count AS downloads,
             password_hash IS NOT NULL AS hasPassword
      FROM files
      WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY uploaded_at DESC
      LIMIT ? OFFSET ?
    `).all(userId, limit, offset)
  }

  liveFileIds(userId: string): string[] {
    return this.db.prepare('SELECT id FROM files WHERE user_id = ? AND deleted_at IS NULL').all(userId).map((r) => r.id)
  }
}

function kindOf(r: { userId: string; accountId?: string | null; email?: string | null }, isOwner: (userId: string, email: string | null) => boolean): MemberRow['kind'] {
  if (r.userId === 'guest') return 'guest'
  if (r.accountId) return 'project'
  if (isOwner(r.userId, r.email ?? null)) return 'admin'
  return 'member'
}
