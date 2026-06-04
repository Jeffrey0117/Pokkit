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
export function createPokkit({ baseUrl, key } = {}) {
  if (!baseUrl) throw new Error('pokkit: baseUrl required')
  if (!key) throw new Error('pokkit: key required')
  const base = baseUrl.replace(/\/$/, '')

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
     * @returns server response incl. { id, filename, size, ... }
     */
    async upload(file, { filename, type } = {}) {
      const form = new FormData()
      let blob, name
      if (typeof file === 'string') {
        const { readFile } = await import('node:fs/promises')
        const { basename } = await import('node:path')
        blob = new Blob([await readFile(file)], type ? { type } : {})
        name = filename || basename(file)
      } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(file)) {
        blob = new Blob([file], type ? { type } : {})
        name = filename || 'file'
      } else {
        blob = file
        name = filename || file.name || 'file'
      }
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
