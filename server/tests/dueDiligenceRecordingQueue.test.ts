import test from 'node:test'
import assert from 'node:assert/strict'
import { createRecordingChunkQueue } from '../../src/components/dueDiligence/recordingChunkQueue.js'
import { shanghaiDateTimeInputValue } from '../../src/lib/dateTime.js'

test('editing an interview preserves the business timezone instead of shifting eight hours', () => {
  assert.equal(shanghaiDateTimeInputValue('2026-10-13T01:30:00.000Z').replace(' ', 'T'), '2026-10-13T09:30')
})

test('failed checkpoint retries the same bytes without skipping or duplicating chunks', async () => {
  const queue = createRecordingChunkQueue(3)
  queue.add(new Blob(['abcdefgh']), { sessionId: 'first', epoch: 0 })
  const saved: string[] = []
  let failOnce = true
  const write = async (blob: Blob) => {
    if (saved.length === 1 && failOnce) { failOnce = false; throw new Error('quota') }
    saved.push(await blob.text())
  }
  await assert.rejects(queue.flush(write), /quota/)
  assert.deepEqual(saved, ['abc']); assert.equal(queue.pendingBytes, 5)
  await queue.flush(write)
  assert.deepEqual(saved, ['abc', 'def', 'gh']); assert.equal(queue.pendingBytes, 0)
})

test('parallel flushes share one writer and preserve the original recording epoch', async () => {
  const queue = createRecordingChunkQueue(4)
  queue.add(new Blob(['ab']), { sessionId: 'first', epoch: 0 })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const saved: string[] = []
  const write = async (blob: Blob, target: {sessionId: string; epoch: number}) => { await gate; saved.push(`${target.epoch}:${await blob.text()}`) }
  const first = queue.flush(write)
  queue.add(new Blob(['cd']), { sessionId: 'first', epoch: 1 })
  assert.equal(queue.flush(write), first)
  assert.throws(() => queue.clear(), /保存/)
  release(); await first
  assert.deepEqual(saved, ['0:ab', '1:cd'])
  queue.clear(); assert.equal(queue.pendingBytes, 0)
})

test('discard after storage failure clears retained bytes and allows a new session', async () => {
  const queue = createRecordingChunkQueue(3)
  queue.add(new Blob(['old']), { sessionId: 'old', epoch: 0 })
  await assert.rejects(queue.flush(async () => { throw new Error('quota') }))
  queue.clear()
  queue.add(new Blob(['new']), { sessionId: 'new', epoch: 0 })
  await queue.flush(async (blob, target) => { assert.equal(target.sessionId, 'new'); assert.equal(await blob.text(), 'new') })
  assert.equal(queue.pendingBytes, 0)
})
