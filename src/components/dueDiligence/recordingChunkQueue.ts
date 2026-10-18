type ChunkTarget = { sessionId: string; epoch: number }

// Retain only uncommitted data. A rejected write must not consume a sequence
// number or poison the next retry; acknowledged chunks are released promptly.
export function createRecordingChunkQueue(chunkBytes: number) {
  const pending: Array<ChunkTarget & { blob: Blob; offset: number }> = []
  let active: Promise<void> | null = null
  return {
    add(blob: Blob, target: ChunkTarget) { if (blob.size) pending.push({ ...target, blob, offset: 0 }) },
    get pendingBytes() { return pending.reduce((total, item) => total + item.blob.size - item.offset, 0) },
    clear() { if (active) throw new Error('录音片段仍在保存，请稍后重试。'); pending.length = 0 },
    flush(write: (blob: Blob, target: ChunkTarget) => Promise<void>) {
      if (active) return active
      const task = (async () => {
        while (pending.length) {
          const item = pending[0]
          const end = Math.min(item.offset + chunkBytes, item.blob.size)
          await write(item.blob.slice(item.offset, end), { sessionId: item.sessionId, epoch: item.epoch })
          item.offset = end
          if (end === item.blob.size) pending.shift()
        }
      })()
      active = task.finally(() => { active = null })
      return active
    },
  }
}
