import './env.js' // load .env into process.env before config is read
import { loadConfig } from './config.js'
import { createServer } from './server.js'

async function main() {
  const config = loadConfig()
  const app = await createServer(config)

  try {
    await app.listen({ port: config.port, host: config.host })
    console.log(`Pokkit running on http://${config.host}:${config.port}`)
    if (config.apiKey) {
      console.log('API key auth enabled')
    } else {
      console.log('No API key set — all endpoints are public')
    }
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }

  // Graceful shutdown: PM2 blue-green restarts (every deploy) signal then SIGKILL.
  // app.close() runs the onClose hook (drains in-flight requests, stops the
  // worker pools, closes SQLite) so nothing is killed mid-write.
  let closing = false
  const shutdown = async (signal: string) => {
    if (closing) return
    closing = true
    console.log(`Received ${signal}, shutting down gracefully…`)
    try {
      await app.close()
      process.exit(0)
    } catch (err) {
      console.error('Error during shutdown:', err)
      process.exit(1)
    }
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main()
