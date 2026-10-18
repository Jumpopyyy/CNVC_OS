import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDueDiligenceRecordingStorage, splitTranscriptForSummary, RECORDING_SESSION_MAX_SECONDS, RECORDING_CHUNK_MAX_BYTES } from '../src/services/dueDiligenceRecordingStorageService.js'
import { nextInterviewSummaryStep, parseInterviewSummaryModelResult } from '../src/services/dueDiligenceSummaryService.js'

test('8-hour synthetic WAV checkpoints assemble with bounded buffers and retry checksums', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dd-recording-isolated-'))
  try {
    const storage = createDueDiligenceRecordingStorage(root), id = randomUUID()
    const byteRate = 8000, duration = RECORDING_SESSION_MAX_SECONDS, hashes: string[] = []
    const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(36 + duration * byteRate, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(8000, 24); header.writeUInt32LE(byteRate, 28); header.writeUInt16LE(1, 32); header.writeUInt16LE(8, 34); header.write('data',36); header.writeUInt32LE(duration * byteRate,40)
    const initialMemory = process.memoryUsage().rss; let peak = initialMemory
    const fullHash = createHash('sha256')
    for (let sequence = 0; sequence < 960; sequence++) {
      const body = sequence ? Buffer.alloc(byteRate * 30, 128) : Buffer.concat([header,Buffer.alloc(byteRate * 30,128)])
      assert.ok(body.length < RECORDING_CHUNK_MAX_BYTES)
      const hash = createHash('sha256').update(body).digest('hex'); hashes.push(hash); fullHash.update(body)
      await storage.putChunk(id,0,sequence,body,hash)
      if (sequence === 479) assert.equal((await storage.putChunk(id,0,sequence,body,hash)).duplicate,true)
      peak = Math.max(peak,process.memoryUsage().rss)
    }
    await assert.rejects(() => storage.putChunk(id,0,0,Buffer.from('wrong'),hashes[0]), /校验失败/)
    const archive = await storage.assemble({sessionId:id,epoch:0,chunkCount:960,hashes,projectId:randomUUID(),fileId:randomUUID(),mimeType:'audio/wav'})
    assert.equal(archive.byteSize, duration * byteRate + 44)
    assert.equal(archive.sha256,fullHash.digest('hex'))
    assert.equal((await stat(path.join(root,archive.storagePath))).size,archive.byteSize)
    peak = Math.max(peak,process.memoryUsage().rss)
    assert.ok(peak-initialMemory < 160 * 1024 * 1024, 'does not retain the whole 230 MB recording in memory')
    console.log(JSON.stringify({syntheticHours:8,checkpoints:960,bytes:archive.byteSize,peakRssGrowth:peak-initialMemory,realMicrophoneTest:false}))
  } finally { await rm(root,{recursive:true,force:true}) }
})

test('recovered recorder starts a new independently valid media epoch', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'dd-epoch-isolated-'))
  try {
    const storage=createDueDiligenceRecordingStorage(root), sessionId=randomUUID()
    for (const epoch of [0,1]) {
      const body=Buffer.from([0x1a,0x45,0xdf,0xa3,epoch]); const hash=createHash('sha256').update(body).digest('hex')
      await storage.putChunk(sessionId,epoch,0,body,hash)
      const archive=await storage.assemble({sessionId,epoch,chunkCount:1,hashes:[hash],projectId:randomUUID(),fileId:randomUUID(),mimeType:'audio/webm'})
      assert.equal(archive.byteSize,5)
    }
    await assert.rejects(() => storage.inspectChunk(sessionId,0,1),/尚未保存/)
    await assert.rejects(() => storage.inspectChunk('../outside',0,0),/标识无效/)
  } finally { await rm(root,{recursive:true,force:true}) }
})

test('long minutes cover every character and resume without repeating completed segments', async () => {
  const source=('合成访谈：受访者表示尚待核实。🙂\n').repeat(6000)
  const parts=splitTranscriptForSummary(source)
  assert.equal(parts.map(part=>part.text).join(''),source)
  let input: Parameters<typeof nextInterviewSummaryStep>[0]={sourceText:source,chunkResults:[]}
  let calls=0; let ready=false
  while (!ready) {
    if (input.chunkResults.length===2 && calls===2) await assert.rejects(() => nextInterviewSummaryStep(input,async()=>{throw new Error('synthetic timeout')}),/timeout/)
    const result=await nextInterviewSummaryStep(input,async prompt=>{calls++; assert.match(prompt,/陈述|待核验/); return {summary:`访谈陈述：第${calls}段；已提供证据：无；待核验事项：核实数据；补充材料：原始凭证。`} })
    input={...input,chunkResults:result.chunkResults,mergeState:result.mergeState}; ready=result.ready
    assert.ok(calls<parts.length*3)
    if (ready) assert.equal(result.chunkResults.length,parts.length)
  }
  assert.throws(()=>parseInterviewSummaryModelResult({summary:''}),/为空/)
})
