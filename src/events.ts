import { EventEmitter } from 'node:events'

// Process-wide bus for media-processing completion. Workers (photo/video) emit
// here from their main-thread message handlers; the SSE route fans events out
// to connected browsers so the SPA stops polling every 2 seconds.

export interface ProcessedEvent {
  id: string
  status: 'done' | 'failed'
  kind: 'photo' | 'video'
}

const emitter = new EventEmitter()
emitter.setMaxListeners(0) // one listener per open SSE connection

export function emitProcessed(ev: ProcessedEvent): void {
  emitter.emit('processed', ev)
}

export function onProcessed(fn: (ev: ProcessedEvent) => void): () => void {
  emitter.on('processed', fn)
  return () => emitter.off('processed', fn)
}
