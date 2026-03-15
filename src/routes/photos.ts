import { createReadStream } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import type { Storage } from '../storage.js'
import type { PokkitConfig } from '../config.js'
import { requireAuth } from '../auth.js'

export function photosRoute(app: FastifyInstance, storage: Storage, config: PokkitConfig) {
  // ── Albums ──

  // POST /api/albums — create album
  app.post<{ Body: { name: string } }>('/api/albums', async (request, reply) => {
    const user = requireAuth(request, reply, config)
    if (!user) return
    const { name } = request.body || {}
    if (!name || typeof name !== 'string') {
      return reply.status(400).send({ error: 'name is required' })
    }
    const album = storage.createAlbum(name.trim())
    return reply.status(201).send(album)
  })

  // GET /api/albums — list albums
  app.get('/api/albums', async (request, reply) => {
    const user = requireAuth(request, reply, config)
    if (!user) return
    return storage.listAlbums()
  })

  // GET /api/albums/:id — album detail + photo list
  app.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string } }>(
    '/api/albums/:id',
    async (request, reply) => {
      const user = requireAuth(request, reply, config)
      if (!user) return
      const album = storage.getAlbum(request.params.id)
      if (!album) {
        return reply.status(404).send({ error: 'Album not found' })
      }
      const limit = Math.min(parseInt(request.query.limit || '200', 10) || 200, 1000)
      const offset = parseInt(request.query.offset || '0', 10) || 0
      const photos = storage.listPhotosByAlbum(album.id, { limit, offset })
      return { ...album, photos }
    },
  )

  // PUT /api/albums/:id — update album
  app.put<{ Params: { id: string }; Body: { name?: string; cover_file_id?: string } }>(
    '/api/albums/:id',
    async (request, reply) => {
      const user = requireAuth(request, reply, config)
      if (!user) return
      const updates: { name?: string; cover_file_id?: string } = {}
      if (request.body?.name) updates.name = request.body.name.trim()
      if (request.body?.cover_file_id) updates.cover_file_id = request.body.cover_file_id
      const ok = storage.updateAlbum(request.params.id, updates)
      if (!ok) {
        return reply.status(404).send({ error: 'Album not found or no changes' })
      }
      return { ok: true }
    },
  )

  // DELETE /api/albums/:id — delete album (photos kept)
  app.delete<{ Params: { id: string } }>('/api/albums/:id', async (request, reply) => {
    const user = requireAuth(request, reply, config)
    if (!user) return
    const ok = storage.deleteAlbum(request.params.id)
    if (!ok) {
      return reply.status(404).send({ error: 'Album not found' })
    }
    return { ok: true }
  })

  // ── Photo Serving ──

  // GET /photos/:id/photo.webp — serve compressed photo
  app.get<{ Params: { id: string } }>('/photos/:id/photo.webp', async (request, reply) => {
    const entry = storage.find(request.params.id)
    if (!entry) {
      return reply.status(404).send({ error: 'Photo not found' })
    }
    const filePath = storage.getPath(entry.id)
    if (!filePath) {
      return reply.status(404).send({ error: 'File not found on disk' })
    }
    return reply
      .header('Content-Type', 'image/webp')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(createReadStream(filePath))
  })

  // GET /photos/:id/thumb.webp — serve thumbnail
  app.get<{ Params: { id: string } }>('/photos/:id/thumb.webp', async (request, reply) => {
    const thumbPath = storage.getThumbPath(request.params.id)
    if (!thumbPath) {
      return reply.status(404).send({ error: 'Thumbnail not found' })
    }
    return reply
      .header('Content-Type', 'image/webp')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(createReadStream(thumbPath))
  })

  // GET /api/photos/:id/status — processing status
  app.get<{ Params: { id: string } }>('/api/photos/:id/status', async (request, reply) => {
    const user = requireAuth(request, reply, config)
    if (!user) return
    const status = storage.getPhotoStatus(request.params.id)
    if (!status) {
      return reply.status(404).send({ error: 'Photo not found' })
    }
    return { id: request.params.id, status }
  })

  // PUT /api/photos/:id/album — move photo to album
  app.put<{ Params: { id: string }; Body: { album_id: string | null } }>(
    '/api/photos/:id/album',
    async (request, reply) => {
      const user = requireAuth(request, reply, config)
      if (!user) return
      const entry = storage.find(request.params.id)
      if (!entry) {
        return reply.status(404).send({ error: 'Photo not found' })
      }
      const albumId = request.body?.album_id ?? null
      if (albumId) {
        const album = storage.getAlbum(albumId)
        if (!album) {
          return reply.status(404).send({ error: 'Album not found' })
        }
      }
      storage.moveToAlbum(request.params.id, albumId)
      return { ok: true }
    },
  )
}
