// PM2 config for pokkit — durable, reboot-proof process management.
//
// Start (in an Administrator terminal, same pm2 that runs the other projects):
//   pm2 start ecosystem.config.cjs
//   pm2 save
//
// The app reads config straight from process.env (no dotenv loader), so we load
// .env here and force PORT=4009 + NODE_ENV=production to match production.
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const env = { NODE_ENV: 'production', PORT: '4009' }
try {
  const raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2]
  }
} catch {
  /* no .env — fine, defaults apply */
}

module.exports = {
  apps: [
    {
      name: 'pokkit',
      script: './src/index.ts',
      interpreter: 'node',
      interpreter_args: '--import tsx',
      cwd: __dirname,
      env,
      autorestart: true,
      max_restarts: 15,
      // Don't thrash-restart on a fast crash loop; back off instead.
      restart_delay: 2000,
      exp_backoff_restart_delay: 200,
    },
  ],
}
