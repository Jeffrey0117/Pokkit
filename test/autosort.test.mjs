import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAutosort } from '../src/autosort.ts'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const owners = { a1: 'me', a2: 'me', b1: 'other' }

function make(runImpl) {
  const calls = []
  const sorter = createAutosort({
    cmd: 'sort', args: ['x'], users: new Set(['me']), delayMs: 40,
    ownerOf: (id) => owners[id],
    run: async (cmd, args) => { calls.push([cmd, ...args]); if (runImpl) await runImpl() },
  })
  return { sorter, calls }
}

test('a burst of uploads runs the sorter once, after the quiet period', async () => {
  const { sorter, calls } = make()
  sorter.handle({ id: 'a1', status: 'done', kind: 'photo' })
  await sleep(20)
  sorter.handle({ id: 'a2', status: 'done', kind: 'photo' })
  await sleep(25)
  assert.equal(calls.length, 0, 'second upload pushed the timer back')
  await sleep(40)
  assert.deepEqual(calls, [['sort', 'x']])
  sorter.halt()
})

test('other accounts, videos and failures never trigger it', async () => {
  const { sorter, calls } = make()
  sorter.handle({ id: 'b1', status: 'done', kind: 'photo' })
  sorter.handle({ id: 'a1', status: 'done', kind: 'video' })
  sorter.handle({ id: 'a1', status: 'failed', kind: 'photo' })
  sorter.handle({ id: 'zz', status: 'done', kind: 'photo' })
  assert.equal(sorter.pending(), false)
  await sleep(60)
  assert.equal(calls.length, 0)
  sorter.halt()
})

test('uploads during a run queue exactly one more run, never an overlap', async () => {
  let release
  const { sorter, calls } = make(() => new Promise((r) => { release = r }))
  sorter.handle({ id: 'a1', status: 'done', kind: 'photo' })
  await sleep(60)
  assert.equal(calls.length, 1)
  sorter.handle({ id: 'a2', status: 'done', kind: 'photo' })
  sorter.handle({ id: 'a1', status: 'done', kind: 'photo' })
  await sleep(60)
  assert.equal(calls.length, 1, 'no overlap while the first run is busy')
  release()
  await sleep(80)
  assert.equal(calls.length, 2)
  release()
  await sleep(80)
  assert.equal(calls.length, 2)
  sorter.halt()
})
