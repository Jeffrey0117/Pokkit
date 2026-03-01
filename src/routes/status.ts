import type { FastifyInstance } from 'fastify'
import type { Storage } from '../storage.js'
import type { PokkitConfig } from '../config.js'

export function statusRoute(app: FastifyInstance, storage: Storage, config: PokkitConfig) {
  app.get('/status', async (request, reply) => {
    if (config.apiKey) {
      const auth = request.headers.authorization
      if (auth !== `Bearer ${config.apiKey}`) {
        return reply.status(401).send({ error: 'Unauthorized' })
      }
    }
    return storage.stats()
  })
}
