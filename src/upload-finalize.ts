import type { FastifyRequest } from 'fastify'
import type { Storage } from './storage.js'
import { GUEST_MAX_FILE_BYTES, GUEST_USER_ID, type PokkitConfig } from './config.js'
import { canAccessAlbum, type AuthUser } from './auth.js'
import { processPhoto } from './photo-worker.js'
import { processVideo, hasFfmpeg } from './video-worker.js'
import { checkPremium } from './subscription.js'

// Shared "last mile" for every upload path (single-request /upload and the
// chunked route): quota check, then photo / video / plain-file branching.
// Both routes return exactly this shape so the front-end handles one format.

export interface UploadFields {
  password?: string
  expiresIn?: string
  album_id?: string
}

export interface FinalizeInput {
  filename: string
  mime: string
  buffer: Buffer
  fields: UploadFields
}

export type FinalizeResult =
  | { status: number; body: Record<string, unknown> }

const VALID_EXPIRY = ['1h', '1d', '7d', '30d', 'forever']

export function normalizeFields(raw: Record<string, unknown> | null | undefined): UploadFields {
  const out: UploadFields = {}
  if (!raw) return out
  if (typeof raw.password === 'string' && raw.password.length > 0) out.password = raw.password
  if (typeof raw.expiresIn === 'string' && VALID_EXPIRY.includes(raw.expiresIn)) out.expiresIn = raw.expiresIn
  if (typeof raw.album_id === 'string' && raw.album_id.length > 0) out.album_id = raw.album_id
  return out
}

export function resolveBaseUrl(request: FastifyRequest, config: PokkitConfig): string {
  if (config.publicUrl) return config.publicUrl
  const host = request.headers.host ?? `${request.hostname}:${config.port}`
  const proto = (request.headers['x-forwarded-proto'] as string) ?? 'http'
  return `${proto}://${host}`
}

// Bytes-based quota (2026-10-04 容量制). Shared by /upload (finalize, knows the
// buffer) and the chunked route (init, knows the declared size — refuse before
// a single byte lands). Items stay as a sanity ceiling only.
// Guest: per-file cap, no account quota — guest files force-expire in ≤7 days.
// Global fuse: the home box's disk is finite; past the line every non-admin
// upload 507s LOUDLY instead of quietly filling the disk to death.

const FUSE_CACHE_TTL = 60 * 1000
// Keyed per Storage instance (not module-global) so tests with fake storages
// and any future multi-store setup can't read each other's cached totals.
const fuseCache = new WeakMap<object, { totalBytes: number; at: number }>()

function globalBytes(storage: Storage): number {
  const hit = fuseCache.get(storage)
  if (hit && Date.now() - hit.at < FUSE_CACHE_TTL) return hit.totalBytes
  const stats = storage.stats() as { totalBytes?: number }
  const entry = { totalBytes: stats.totalBytes ?? 0, at: Date.now() }
  fuseCache.set(storage, entry)
  return entry.totalBytes
}

function fmtGB(bytes: number): string {
  return (bytes / (1024 * 1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 * 1024 ? 0 : 1) + ' GB'
}

export async function checkQuota(
  user: AuthUser,
  storage: Storage,
  config: PokkitConfig,
  incomingBytes = 0,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  // Admin (LetMeUse admin / global key) = unlimited — the owner must never be
  // locked out of their own box by the per-user quota (2026-10-04 實案: Jeff
  // 4.3GB 既有資料被新 Free 2GB 制當場鎖死)。
  if (user.isAdmin) return null
  const globalCap = config.globalCapacityBytes ?? Number.POSITIVE_INFINITY
  if (globalBytes(storage) + incomingBytes > globalCap) {
    console.error(`[Pokkit] ⛔ GLOBAL CAPACITY FUSE: ${fmtGB(globalBytes(storage))} stored, cap ${fmtGB(config.globalCapacityBytes)} — rejecting uploads`)
    return {
      status: 507,
      body: { error: 'Server storage is full — uploads are temporarily paused. Please try again later.' },
    }
  }

  if (user.userId === GUEST_USER_ID) {
    if (incomingBytes > GUEST_MAX_FILE_BYTES) {
      return {
        status: 413,
        body: { error: `Guest uploads are limited to ${fmtGB(GUEST_MAX_FILE_BYTES)} per file. Sign up free for more.`, guest: true },
      }
    }
    return null
  }

  const sub = await checkPremium(user.email, user.userId, config.premiumUserIds)
  const userStats = storage.userStats(user.userId)
  if (userStats.totalBytes + incomingBytes > sub.maxBytes) {
    return {
      status: 413,
      body: {
        error: `Storage full. ${sub.tier} plan: ${fmtGB(sub.maxBytes)}. Upgrade for more space.`,
        tier: sub.tier,
        usedBytes: userStats.totalBytes,
        maxBytes: sub.maxBytes,
      },
    }
  }
  if (userStats.totalFiles >= sub.maxPhotos) {
    return {
      status: 413,
      body: {
        error: `Item limit reached. ${sub.tier} plan: ${sub.maxPhotos.toLocaleString()} items.`,
        tier: sub.tier,
        photoCount: userStats.totalFiles,
        maxPhotos: sub.maxPhotos,
      },
    }
  }
  return null
}

// Guest files must never outlive 7 days — clamp whatever the form sent.
const GUEST_ALLOWED_EXPIRY = new Set(['1h', '1d', '7d'])
export function clampGuestExpiry(expiresIn: string | undefined): string {
  return expiresIn && GUEST_ALLOWED_EXPIRY.has(expiresIn) ? expiresIn : '7d'
}

export async function finalizeUpload(
  input: FinalizeInput,
  user: AuthUser,
  request: FastifyRequest,
  storage: Storage,
  config: PokkitConfig,
): Promise<FinalizeResult> {
  const { filename, mime, buffer, fields } = input
  const isGuest = user.userId === GUEST_USER_ID
  if (isGuest) {
    // Guests: no albums, forced expiry, and ALWAYS the plain-file branch below —
    // no thumbnail/transcode worker time for anonymous uploads (the /f/ share
    // page previews images and videos from the raw file just fine).
    fields.album_id = undefined
    fields.expiresIn = clampGuestExpiry(fields.expiresIn)
  }

  let albumId: string | undefined
  if (fields.album_id) {
    const album = storage.getAlbum(fields.album_id)
    // Tenants may only file into their own albums (admins anywhere).
    if (!album || !canAccessAlbum(user, album)) return { status: 400, body: { error: 'Album not found' } }
    albumId = fields.album_id
  }

  const quota = await checkQuota(user, storage, config, buffer.length)
  if (quota) return quota

  const baseUrl = resolveBaseUrl(request, config)

  // Photo branch: images get deferred processing
  if (!isGuest && storage.isImage(mime)) {
    const entry = storage.savePhoto(filename, mime, buffer, { album_id: albumId, userId: user.userId })
    if (!entry.deduplicated && entry.rawPath) {
      processPhoto(entry.id, entry.rawPath)
    }
    return {
      status: 200,
      body: {
        id: entry.id,
        filename: entry.filename,
        mime: entry.mime,
        size: entry.size,
        status: entry.status,
        deduplicated: !!entry.deduplicated,
        photoUrl: `${baseUrl}/photos/${entry.id}/photo.webp`,
        thumbUrl: `${baseUrl}/photos/${entry.id}/thumb.webp`,
        statusUrl: `${baseUrl}/api/photos/${entry.id}/status`,
      },
    }
  }

  // Video branch: videos get deferred processing (ffmpeg)
  if (!isGuest && storage.isVideo(mime)) {
    if (!hasFfmpeg()) {
      return { status: 400, body: { error: 'Video upload not available — ffmpeg not installed on server' } }
    }
    const entry = storage.saveVideo(filename, mime, buffer, { album_id: albumId, userId: user.userId })
    if (entry.rawPath) {
      try {
        processVideo(entry.id, entry.rawPath)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        request.log.error(`Failed to queue video ${entry.id}: ${msg}`)
      }
    }
    return {
      status: 200,
      body: {
        id: entry.id,
        filename: entry.filename,
        mime: entry.mime,
        size: entry.size,
        status: entry.status,
        videoUrl: `${baseUrl}/photos/${entry.id}/video.mp4`,
        thumbUrl: `${baseUrl}/photos/${entry.id}/thumb.webp`,
        statusUrl: `${baseUrl}/api/photos/${entry.id}/status`,
      },
    }
  }

  // Normal file branch
  const entry = await storage.save(filename, mime, buffer, {
    password: fields.password,
    expiresIn: fields.expiresIn,
    userId: user.userId,
  })
  return {
    status: 200,
    body: {
      url: `${baseUrl}/f/${entry.id}`,
      directUrl: `${baseUrl}/files/${entry.id}/${encodeURIComponent(entry.filename)}`,
      id: entry.id,
      filename: entry.filename,
      mime: entry.mime,
      size: entry.size,
      uploaded_at: entry.uploaded_at,
      has_password: !!entry.password_hash,
      expires_at: entry.expires_at,
    },
  }
}
