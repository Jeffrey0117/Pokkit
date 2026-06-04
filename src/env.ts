// Zero-dependency .env loader. Imported first in index.ts so the app picks up
// .env on EVERY start, regardless of how the process was launched. (A plain
// `pm2 restart` keeps a stale env snapshot, so relying on ecosystem.config.cjs
// alone means new .env keys never take effect without a full re-create.)
//
// Real environment variables win: we only fill keys that aren't already set,
// so values injected by pm2 / CloudPipe / the shell are never overridden.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

try {
  const envPath = resolve(import.meta.dirname, '../.env')
  const raw = readFileSync(envPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2]
    }
  }
} catch {
  /* no .env — fine, defaults apply */
}
