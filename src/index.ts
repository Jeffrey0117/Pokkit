import './env.js' // load .env into process.env before config is read
import { loadConfig } from './config.js'
import { createServer } from './server.js'
import { warmUpJwks } from './jwks-cache.js'

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
    // 🆕 2026-11-08: JWKS 開機預熱。必須做 —— requireAuth 走同步驗證, 快取 miss
    // 一律 fail-closed, 不預熱的話重啟後「第一個」請求就算帶完全有效的 token 也
    // 會 401, 使用者看到的是「我的登入壞了」。
    //
    // 而且一定要印出來: LetMeUse 的 signAccessToken 在 env 掉了的時候會無聲退回
    // HS256, 那時候全生態同時 401 且零線索, 這一行是唯一的早期訊號。
    if (!config.letmeuseAppId) {
      console.error('[jwks] ⚠️ 沒設 LETMEUSE_APP_ID — 所有 LetMeUse 登入會被拒絕 (app claim 是唯一的租戶邊界)')
    }
    const jwks = await warmUpJwks()
    if (!jwks.keys) {
      console.error(`[jwks] ⚠️ 預熱沒拿到金鑰 — 所有登入會 401: ${jwks.lastError}`)
    } else {
      console.log(`[jwks] ready (${jwks.keys} key(s), kid=${jwks.kids.join(',')})`)
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
