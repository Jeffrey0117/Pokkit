/**
 * Pokkit client — a ~40-line wrapper any project can drop in to store files in
 * its own pokkit account. Node 18+ (uses global fetch / FormData / Blob).
 *
 *   import { createPokkit } from './pokkit-client.mjs'
 *   const pokkit = createPokkit({ baseUrl: process.env.POKKIT_URL, key: process.env.POKKIT_KEY })
 *   const { id } = await pokkit.upload('./photo.jpg')
 *   console.log(pokkit.url(id))            // public share link
 *   const files = await pokkit.list()
 *   await pokkit.remove(id)
 *
 * The key authenticates as one project account; you only ever see your own files.
 */
export function createPokkit({ baseUrl, key, chunkThreshold = 64 * 1024 * 1024 } = {}) {
  if (!baseUrl) throw new Error('pokkit: baseUrl required')
  if (!key) throw new Error('pokkit: key required')
  const base = baseUrl.replace(/\/$/, '')

  // Files above `chunkThreshold` go through the chunked route so no single request
  // exceeds an edge proxy's body cap (Cloudflare: 100MB). Needs the kit client:
  //   npm i github:Jeffrey0117/chunked-upload-kit
  // Set chunkThreshold: Infinity to always use the one-shot /upload.
  async function uploadChunked(blob, name, type, uploadId) {
    let mod
    try {
      mod = await import('chunked-upload-kit/client')
    } catch (err) {
      throw new Error(`pokkit: file is ${blob.size} bytes (> chunkThreshold ${chunkThreshold}); install chunked-upload-kit to upload large files (npm i github:Jeffrey0117/chunked-upload-kit): ${err.message}`)
    }
    try {
      return await mod.uploadChunked(blob, {
        endpoint: `${base}/api/upload/chunked`,
        headers: { 'X-Pokkit-Key': key },
        filename: name,
        mime: type || blob.type || 'application/octet-stream',
        uploadId,
      })
    } catch (err) {
      const wrapped = new Error(`pokkit ${err.status || 0}: ${err.message}`)
      // keep what a caller needs to resume: pokkit.upload(file, { uploadId: err.uploadId })
      wrapped.status = err.status
      wrapped.code = err.code
      wrapped.uploadId = err.resumable ? err.uploadId : null
      wrapped.resumable = !!err.resumable
      throw wrapped
    }
  }

  async function req(path, opts = {}) {
    const res = await fetch(base + path, {
      ...opts,
      headers: { 'X-Pokkit-Key': key, ...(opts.headers || {}) },
    })
    if (!res.ok) {
      let detail = res.statusText
      try { detail = (await res.json()).error || detail } catch { /* non-json */ }
      throw new Error(`pokkit ${res.status}: ${detail}`)
    }
    return res
  }

  return {
    /**
     * Upload a file. Accepts a filesystem path (string), a Buffer, or a Blob/File.
     * Files above chunkThreshold go chunked; a failed chunked upload throws an error
     * carrying { uploadId, resumable } — pass { uploadId } back in to resume.
     * @returns server response incl. { id, filename, size, ... }
     */
    async upload(file, { filename, type, uploadId } = {}) {
      const form = new FormData()
      let blob, name
      if (typeof file === 'string') {
        const fsMod = await import('node:fs')
        const { basename } = await import('node:path')
        // openAsBlob (Node 20+) reads lazily, so a 500MB video is never held in RAM;
        // older Node falls back to a one-shot read.
        blob = typeof fsMod.openAsBlob === 'function'
          ? await fsMod.openAsBlob(file, type ? { type } : {})
          : new Blob([await fsMod.promises.readFile(file)], type ? { type } : {})
        name = filename || basename(file)
      } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(file)) {
        blob = new Blob([file], type ? { type } : {})
        name = filename || 'file'
      } else {
        blob = file
        name = filename || file.name || 'file'
      }
      if (uploadId || blob.size > chunkThreshold) return uploadChunked(blob, name, type, uploadId)
      form.append('file', blob, name)
      return (await req('/upload', { method: 'POST', body: form })).json()
    },

    /** List this account's files (newest first). */
    async list({ limit = 50, offset = 0 } = {}) {
      return (await req(`/files?limit=${limit}&offset=${offset}`, {
        headers: { Accept: 'application/json' },
      })).json()
    },

    /** Delete one of this account's files. */
    async remove(id) {
      await req(`/files/${encodeURIComponent(id)}`, { method: 'DELETE' })
      return true
    },

    /** Public share URL for a file id. */
    url(id) {
      return `${base}/f/${encodeURIComponent(id)}`
    },
  }
}
