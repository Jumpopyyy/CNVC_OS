import assert from 'node:assert/strict'
import test from 'node:test'
import { dueDiligenceAsrMaxBytes, getDueDiligenceAsrCapability, transcribeDueDiligenceBuffer } from '../src/services/dueDiligenceAsrService.js'
import { validateProjectAudioBuffer } from '../src/security/projectFileValidation.js'

const env = { ASR_BASE_URL: 'https://speech.example/v1/', ASR_API_KEY: ' synthetic-test-only ', ASR_MODEL: ' test-transcriber ' }
const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(32)])
const recording = { buffer: wav, fileName: '测试访谈.wav', mimeType: 'audio/wav', env }

function errorCode(code: string) {
  return (error: unknown) => error instanceof Error && (error as { code?: string }).code === code
}

test('ASR requires explicit audio provider, key and model, not a text model configuration', () => {
  assert.equal(getDueDiligenceAsrCapability({ AI_BASE_URL: 'https://chat.example/v1', AI_API_KEY: 'synthetic', AI_MODEL: 'chat' }).configured, false)
  assert.equal(getDueDiligenceAsrCapability(env).configured, true)
  for (const baseUrl of ['file:///tmp/recording', 'ftp://speech.example', 'https://user:password@speech.example', 'https://speech.example?token=synthetic', 'https://speech.example#fragment', 'not-a-url']) {
    assert.equal(getDueDiligenceAsrCapability({ ...env, ASR_BASE_URL: baseUrl }).configured, false)
  }
})

test('unconfigured ASR returns a truthful error without calling any model', async () => {
  let calls = 0
  await assert.rejects(transcribeDueDiligenceBuffer({ ...recording, env: {}, fetchImpl: (async () => { calls += 1; return new Response('{}') }) as typeof fetch }), errorCode('ASR_NOT_CONFIGURED'))
  assert.equal(calls, 0)
})

test('ASR sends the canonical audio MIME, trimmed model and credential and disallows redirects', async () => {
  const result = await transcribeDueDiligenceBuffer({ ...recording, mimeType: 'application/octet-stream', fetchImpl: (async (url, init) => {
    assert.equal(url, 'https://speech.example/v1/audio/transcriptions')
    assert.equal(init?.redirect, 'error')
    assert.deepEqual(init?.headers, { Authorization: 'Bearer synthetic-test-only' })
    assert.ok(init?.body instanceof FormData)
    const form = init.body
    assert.equal(form.get('model'), 'test-transcriber')
    assert.equal(form.get('language'), 'zh')
    const file = form.get('file') as File
    assert.equal(file.name, '测试访谈.wav')
    assert.equal(file.type, 'audio/wav')
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), wav)
    return Response.json({ text: '  公司客户分布已核验。  ' })
  }) as typeof fetch })
  assert.deepEqual(result, { text: '公司客户分布已核验。', provider: 'speech.example', model: 'test-transcriber' })
})

test('ASR accepts a full transcription endpoint without duplicating its path', async () => {
  await transcribeDueDiligenceBuffer({ ...recording, env: { ...env, ASR_BASE_URL: ' https://speech.example/v1/audio/transcriptions/// ' }, fetchImpl: (async url => {
    assert.equal(url, 'https://speech.example/v1/audio/transcriptions')
    return Response.json({ text: '测试转写' })
  }) as typeof fetch })
})

test('ASR rejects unsupported, empty and extension-mismatched recordings before network access', async () => {
  let calls = 0
  const fetchImpl = (async () => { calls += 1; return Response.json({ text: '不应调用' }) }) as typeof fetch
  await assert.rejects(transcribeDueDiligenceBuffer({ ...recording, fileName: 'note.txt', fetchImpl }), errorCode('INVALID_RECORDING_FILE'))
  await assert.rejects(transcribeDueDiligenceBuffer({ ...recording, buffer: Buffer.alloc(0), fetchImpl }), errorCode('EMPTY_FILE'))
  await assert.rejects(transcribeDueDiligenceBuffer({ ...recording, fileName: 'wrong.webm', fetchImpl }), errorCode('FILE_SIGNATURE_MISMATCH'))
  assert.equal(calls, 0)
})

test('ASR bounds audio size and refuses invalid capacity configuration', async () => {
  assert.equal(dueDiligenceAsrMaxBytes({}), 25 * 1024 * 1024)
  assert.throws(() => dueDiligenceAsrMaxBytes({ ASR_MAX_AUDIO_BYTES: '0' }), errorCode('ASR_INVALID_CONFIGURATION'))
  assert.throws(() => dueDiligenceAsrMaxBytes({ ASR_MAX_AUDIO_BYTES: String(101 * 1024 * 1024) }), errorCode('ASR_INVALID_CONFIGURATION'))
  let calls = 0
  await assert.rejects(transcribeDueDiligenceBuffer({ ...recording, env: { ...env, ASR_MAX_AUDIO_BYTES: '4' }, fetchImpl: (async () => { calls += 1; return Response.json({ text: '不应调用' }) }) as typeof fetch }), errorCode('ASR_AUDIO_TOO_LARGE'))
  assert.equal(calls, 0)
})

test('persisted audio signature checks cover all four supported recording formats', async () => {
  assert.equal(await validateProjectAudioBuffer('speech.wav', wav), 'audio/wav')
  assert.equal(await validateProjectAudioBuffer('speech.mp3', Buffer.from('ID3synthetic')), 'audio/mpeg')
  assert.equal(await validateProjectAudioBuffer('speech.m4a', Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A '), Buffer.alloc(4)])), 'audio/mp4')
  assert.equal(await validateProjectAudioBuffer('speech.webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86])), 'audio/webm')
})

test('ASR errors do not disclose provider response bodies or credentials', async () => {
  for (const [status, fragment] of [[401, '认证失败'], [403, '认证失败'], [429, '额度不足'], [413, '容量限制'], [500, 'HTTP 500']] as const) {
    await assert.rejects(transcribeDueDiligenceBuffer({ ...recording, fetchImpl: (async () => new Response('private-provider-payload', { status })) as typeof fetch }), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.ok(error.message.includes(fragment))
      assert.equal(error.message.includes('private-provider-payload'), false)
      assert.equal(error.message.includes('synthetic-test-only'), false)
      return (error as { code?: string }).code === 'ASR_HTTP_ERROR'
    })
  }
})

test('ASR maps timeout and network failure into recoverable recording-preserved messages', async () => {
  for (const [name, code] of [['TimeoutError', 'ASR_TIMEOUT'], ['AbortError', 'ASR_TIMEOUT'], ['TypeError', 'ASR_CONNECTION_FAILED']] as const) {
    await assert.rejects(transcribeDueDiligenceBuffer({ ...recording, fetchImpl: (async () => { throw Object.assign(new Error('sensitive-network-detail'), { name }) }) as typeof fetch }), (error: unknown) => {
      assert.ok(error instanceof Error && error.message.includes('录音已保留'))
      assert.equal(error.message.includes('sensitive-network-detail'), false)
      return (error as { code?: string }).code === code
    })
  }
})

test('ASR rejects invalid, empty and overlong output rather than returning fake text', async () => {
  await assert.rejects(transcribeDueDiligenceBuffer({ ...recording, fetchImpl: (async () => new Response('not json')) as typeof fetch }), errorCode('ASR_INVALID_RESPONSE'))
  for (const payload of [{}, { text: 42 }, { text: ' ' }, null]) {
    await assert.rejects(transcribeDueDiligenceBuffer({ ...recording, fetchImpl: (async () => Response.json(payload)) as typeof fetch }), errorCode('ASR_EMPTY_RESPONSE'))
  }
  await assert.rejects(transcribeDueDiligenceBuffer({ ...recording, fetchImpl: (async () => Response.json({ text: '字'.repeat(200_001) })) as typeof fetch }), errorCode('ASR_OUTPUT_TOO_LARGE'))
})
