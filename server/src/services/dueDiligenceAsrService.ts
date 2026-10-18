import { inspectProjectFile, readProjectFileBuffer } from './projectFileStorageService.js'
import { validateProjectAudioBuffer } from '../security/projectFileValidation.js'

export type AsrCapability = {
  configured: boolean
  provider: string | null
  model: string | null
}

export function getDueDiligenceAsrCapability(env: NodeJS.ProcessEnv = process.env): AsrCapability {
  const baseUrl = env.ASR_BASE_URL?.trim()
  const apiKey = env.ASR_API_KEY?.trim()
  const model = env.ASR_MODEL?.trim()
  let provider: string | null = null
  try {
    const url = baseUrl ? new URL(baseUrl) : null
    provider = url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash ? url.hostname : null
  } catch { provider = null }
  return {
    configured: Boolean(baseUrl && provider && apiKey && model),
    provider,
    model: model || null,
  }
}

export function dueDiligenceAsrMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const bytes = Number(env.ASR_MAX_AUDIO_BYTES || 25 * 1024 * 1024)
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 100 * 1024 * 1024) {
    throw Object.assign(new Error('后台转写文件容量配置无效'), { status: 503, code: 'ASR_INVALID_CONFIGURATION' })
  }
  return bytes
}

function assertAudioSize(bytes: number, env: NodeJS.ProcessEnv) {
  const maximum = dueDiligenceAsrMaxBytes(env)
  if (!bytes) throw Object.assign(new Error('录音文件没有内容'), { status: 400, code: 'EMPTY_FILE' })
  if (bytes > maximum) throw Object.assign(new Error(`录音超过后台转写容量限制（${Math.ceil(maximum / 1024 / 1024)} MB），请拆分后提交`), { status: 413, code: 'ASR_AUDIO_TOO_LARGE' })
}

export async function transcribeDueDiligenceRecording(input: {
  storagePath: string
  fileName: string
  mimeType: string
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
}) {
  const metadata = await inspectProjectFile(input.storagePath)
  assertAudioSize(metadata.size, input.env ?? process.env)
  const buffer = await readProjectFileBuffer(input.storagePath)
  return transcribeDueDiligenceBuffer({ buffer, fileName: input.fileName, mimeType: input.mimeType, env: input.env, signal: input.signal })
}

export async function transcribeDueDiligenceBuffer(input: {
  buffer: Buffer
  fileName: string
  mimeType: string
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}) {
  const env = input.env ?? process.env
  const capability = getDueDiligenceAsrCapability(env)
  if (!capability.configured) {
    throw Object.assign(new Error('未配置后台转写服务'), { status: 503, code: 'ASR_NOT_CONFIGURED' })
  }
  assertAudioSize(input.buffer.length, env)
  const mimeType = await validateProjectAudioBuffer(input.fileName, input.buffer)
  const form = new FormData()
  form.append('model', capability.model!)
  form.append('language', 'zh')
  form.append('response_format', 'json')
  form.append('file', new File([input.buffer], input.fileName, { type: mimeType }))
  const baseUrl = env.ASR_BASE_URL!.trim().replace(/\/+$/, '')
  const url = baseUrl.endsWith('/audio/transcriptions') ? baseUrl : `${baseUrl}/audio/transcriptions`
  let response: Response
  try {
    response = await (input.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.ASR_API_KEY!.trim()}` },
      body: form,
      redirect: 'error',
      signal: AbortSignal.any([...(input.signal ? [input.signal] : []), AbortSignal.timeout(Math.min(600_000, Math.max(30_000, Number(env.ASR_TIMEOUT_MS) || 180_000)))]),
    })
  } catch (error) {
    const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
    throw Object.assign(new Error(timeout ? '后台转写超时，录音已保留，可稍后重试' : '无法连接后台转写服务，录音已保留，可稍后重试'), { status: 502, code: timeout ? 'ASR_TIMEOUT' : 'ASR_CONNECTION_FAILED' })
  }
  if (!response.ok) {
    const reason = response.status === 401 || response.status === 403 ? '后台转写服务认证失败，请联系管理员检查配置'
      : response.status === 429 ? '后台转写服务额度不足或请求过多，可稍后重试'
      : response.status === 413 ? '录音超过转写服务的容量限制，请拆分后提交'
      : `后台转写失败（HTTP ${response.status}）`
    throw Object.assign(new Error(reason), { status: 502, code: 'ASR_HTTP_ERROR' })
  }
  let payload: { text?: unknown }
  try { payload = await response.json() as { text?: unknown } }
  catch { throw Object.assign(new Error('后台转写返回格式无效，录音已保留'), { status: 502, code: 'ASR_INVALID_RESPONSE' }) }
  const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
  if (!text) throw Object.assign(new Error('后台转写未返回文字'), { status: 502, code: 'ASR_EMPTY_RESPONSE' })
  if (text.length > 200_000) throw Object.assign(new Error('后台转写文字过长，请拆分录音后提交'), { status: 502, code: 'ASR_OUTPUT_TOO_LARGE' })
  return { text, provider: capability.provider || 'openai-compatible', model: capability.model! }
}
