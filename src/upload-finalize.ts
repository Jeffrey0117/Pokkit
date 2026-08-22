import type { FastifyRequest } from 'fastify'
import type { Storage } from './storage.js'
import type { PokkitConfig } from './config.js'
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

// Count-based quota via PayGate subscription. Returns a ready-made 413 when the
// user is at their limit, null when they may upload. Shared by /upload (at
// finalize) and the chunked route (at init, before any byte lands).
export async function checkQuota(
  user: AuthUser,
  storage: Storage,
  config: PokkitConfig,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const sub = await checkPremium(user.email, user.userId, config.premiumUserIds)
  const userStats = storage.userStats(user.userId)
  if (userStats.totalFiles < sub.maxPhotos) return null
  return {
    status: 413,
    body: {
      error: `Photo limit reached. ${sub.tier} plan: ${sub.maxPhotos.toLocaleString()} photos. Upgrade for more.`,
      tier: sub.tier,
      photoCount: userStats.totalFiles,
      maxPhotos: sub.maxPhotos,
    },
  }
}

export async function finalizeUpload(
  input: FinalizeInput,
  user: AuthUser,
  request: FastifyRequest,
  storage: Storage,
  config: PokkitConfig,
): Promise<FinalizeResult> {
  const { filename, mime, buffer, fields } = input

  let albumId: string | undefined
  if (fields.album_id) {
    const album = storage.getAlbum(fields.album_id)
    // Tenants may only file into their own albums (admins anywhere).
    if (!album || !canAccessAlbum(user, album)) return { status: 400, body: { error: 'Album not found' } }
    albumId = fields.album_id
  }

  const quota = await checkQuota(user, storage, config)
  if (quota) return quota

  const baseUrl = resolveBaseUrl(request, config)

  // Photo branch: images get deferred processing
  if (storage.isImage(mime)) {
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
  if (storage.isVideo(mime)) {
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
