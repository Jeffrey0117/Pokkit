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
}

main()
