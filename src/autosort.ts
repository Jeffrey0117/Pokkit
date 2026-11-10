import { execFile } from 'node:child_process'
import { onProcessed, type ProcessedEvent } from './events.js'

// Upload-triggered photo sorting. When a photo from an opted-in account finishes
// processing, wait for uploads to go quiet, then run an external command once
// (for example a local CLIP classifier). Nothing polls: with no uploads this
// module does nothing at all. The command runs in its own process, so a crash or
// a slow GPU never touches request handling.
//
// POKKIT_AUTOSORT_CMD      executable to run (unset = feature off)
// POKKIT_AUTOSORT_ARGS     JSON array of arguments
// POKKIT_AUTOSORT_USERS    comma-separated user ids that opt in
// POKKIT_AUTOSORT_DELAY_MS quiet period before running (default 2 minutes)

export interface AutosortOptions {
  cmd: string
  args: string[]
  users: Set<string>
  delayMs: number
  ownerOf: (id: string) => string | null | undefined
  run?: (cmd: string, args: string[]) => Promise<void>
}

function defaultRun(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 30 * 60 * 1000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      const last = String(stdout || '').trim().split('\n').pop() || ''
      if (err) console.error(`[autosort] failed: ${err.message.slice(0, 200)}`)
      else console.info(`[autosort] done ${last.slice(0, 300)}`)
      resolve()
    })
  })
}

export function createAutosort(opts: AutosortOptions) {
  const run = opts.run ?? defaultRun
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let again = false
  let halted = false

  const fire = async (): Promise<void> => {
    timer = null
    if (halted) return
    if (running) { again = true; return }
    running = true
    try {
      await run(opts.cmd, opts.args)
    } finally {
      running = false
      if (again && !halted) { again = false; schedule() }
    }
  }

  const schedule = (): void => {
    if (halted) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void fire(), opts.delayMs)
  }

  const handle = (ev: ProcessedEvent): void => {
    if (ev.kind !== 'photo' || ev.status !== 'done') return
    const owner = opts.ownerOf(ev.id)
    if (!owner || !opts.users.has(owner)) return
    if (running) { again = true; return }
    schedule()
  }

  return {
    handle,
    pending: () => timer !== null,
    halt: () => { halted = true; if (timer) clearTimeout(timer); timer = null },
  }
}

export function startAutosort(ownerOf: (id: string) => string | null | undefined): (() => void) | null {
  const cmd = process.env.POKKIT_AUTOSORT_CMD
  const users = new Set((process.env.POKKIT_AUTOSORT_USERS || '').split(',').map((s) => s.trim()).filter(Boolean))
  if (!cmd || users.size === 0) return null
  let args: string[] = []
  try {
    const parsed = JSON.parse(process.env.POKKIT_AUTOSORT_ARGS || '[]')
    if (Array.isArray(parsed)) args = parsed.map(String)
  } catch {
    console.error('[autosort] POKKIT_AUTOSORT_ARGS is not a JSON array, feature off')
    return null
  }
  const delayMs = Number(process.env.POKKIT_AUTOSORT_DELAY_MS) || 2 * 60 * 1000
  const sorter = createAutosort({ cmd, args, users, delayMs, ownerOf })
  const off = onProcessed(sorter.handle)
  console.info(`[autosort] on for ${users.size} account(s), ${Math.round(delayMs / 1000)}s after the last upload`)
  return () => { off(); sorter.halt() }
}
