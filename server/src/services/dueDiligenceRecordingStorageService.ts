import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { link, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export const RECORDING_CHUNK_MAX_BYTES = 2 * 1024 * 1024
export const RECORDING_SESSION_MAX_BYTES = 1024 * 1024 * 1024
export const RECORDING_SESSION_MAX_SECONDS = 8 * 60 * 60
export const RECORDING_LEASE_MS = 90_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const recordingError = (code: string, message: string, status = 409) => Object.assign(new Error(message), { code, status })

export function recordingContainer(mimeType: string): { extension: string; mimeType: string } {
  const type = mimeType.split(';')[0].trim().toLowerCase()
  if (type === 'audio/webm' || type === 'video/webm') return { extension: 'webm', mimeType: 'audio/webm' }
  if (['audio/mp4', 'audio/x-m4a', 'video/mp4'].includes(type)) return { extension: 'm4a', mimeType: 'audio/mp4' }
  if (['audio/mpeg', 'audio/mp3'].includes(type)) return { extension: 'mp3', mimeType: 'audio/mpeg' }
  if (['audio/wav', 'audio/x-wav', 'audio/wave'].includes(type)) return { extension: 'wav', mimeType: 'audio/wav' }
  throw recordingError('INVALID_RECORDING_FORMAT', '录音仅支持 MP3、WAV、M4A 或 WebM', 415)
}

export function assertRecordingContainerHeader(buffer: Buffer, mimeType: string) {
  const { extension } = recordingContainer(mimeType)
  const valid = extension === 'webm' ? buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    : extension === 'm4a' ? buffer.subarray(4, 8).toString('ascii') === 'ftyp'
    : extension === 'wav' ? buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE'
    : buffer.subarray(0, 3).toString('ascii') === 'ID3' || buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0
  if (!valid) throw recordingError('RECORDING_CONTAINER_INVALID', '录音容器头无效；分片已保留，请检查原始格式', 415)
}

function identifier(value: string) {
  if (!UUID.test(value)) throw recordingError('INVALID_RECORDING_ID', '录音标识无效', 400)
  return value.toLowerCase()
}
function ordinal(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100_000) throw recordingError('INVALID_RECORDING_SEQUENCE', '录音分片序号无效', 400)
  return String(value).padStart(6, '0')
}

/** The root override is for isolated tests, never accepted from an HTTP request. */
export function createDueDiligenceRecordingStorage(root = process.env.PROJECT_FILE_ROOT || path.join(process.cwd(), 'server', 'project-files')) {
  const storageRoot = path.resolve(root)
  async function safeDirectory(directory: string) {
    if (!directory.startsWith(`${storageRoot}${path.sep}`)) throw recordingError('INVALID_STORAGE_PATH', '录音存储路径越界', 500)
    await mkdir(storageRoot, { recursive: true, mode: 0o700 })
    let cursor = storageRoot
    for (const part of path.relative(storageRoot, directory).split(path.sep)) {
      cursor = path.join(cursor, part)
      await mkdir(cursor, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error })
      const info = await lstat(cursor)
      if (info.isSymbolicLink() || !info.isDirectory()) throw recordingError('INVALID_STORAGE_PATH', '录音存储不允许符号链接', 500)
    }
    const [rootReal, targetReal] = await Promise.all([realpath(storageRoot), realpath(directory)])
    if (!targetReal.startsWith(`${rootReal}${path.sep}`)) throw recordingError('INVALID_STORAGE_PATH', '录音真实路径越界', 500)
  }
  const chunkPath = (sessionId: string, epoch: number, sequence: number) => path.join(storageRoot, '.dd-recordings', identifier(sessionId), ordinal(epoch), `${ordinal(sequence)}.chunk`)
  async function inspectChunk(sessionId: string, epoch: number, sequence: number) {
    const target = chunkPath(sessionId, epoch, sequence)
    const info = await lstat(target).catch(() => null)
    if (!info?.isFile() || info.isSymbolicLink()) throw recordingError('RECORDING_CHUNK_MISSING', `录音第 ${sequence + 1} 块尚未保存`, 409)
    if (info.size < 1 || info.size > RECORDING_CHUNK_MAX_BYTES) throw recordingError('RECORDING_CHUNK_INVALID', '录音分片容量异常', 409)
    const [rootReal, targetReal] = await Promise.all([realpath(storageRoot), realpath(target)])
    if (!targetReal.startsWith(`${rootReal}${path.sep}`)) throw recordingError('INVALID_STORAGE_PATH', '录音真实路径越界', 500)
    return { target, byteSize: info.size }
  }
  async function putChunk(sessionId: string, epoch: number, sequence: number, buffer: Buffer, expectedHash: string) {
    if (!buffer.length || buffer.length > RECORDING_CHUNK_MAX_BYTES) throw recordingError('RECORDING_CHUNK_TOO_LARGE', '每个录音分片必须在 1 字节至 2 MB 之间', 413)
    const sha256 = createHash('sha256').update(buffer).digest('hex')
    if (!/^[a-f0-9]{64}$/i.test(expectedHash) || sha256 !== expectedHash.toLowerCase()) throw recordingError('RECORDING_CHUNK_HASH_MISMATCH', '录音分片校验失败，请重新上传', 422)
    const target = chunkPath(sessionId, epoch, sequence)
    await safeDirectory(path.dirname(target))
    const temporary = `${target}.${randomUUID()}.tmp`
    let duplicate = false
    try {
      await writeFile(temporary, buffer, { flag: 'wx', mode: 0o600 })
      try { await link(temporary, target) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const existing = await inspectChunk(sessionId, epoch, sequence)
        const currentHash = createHash('sha256').update(await readFile(existing.target)).digest('hex')
        if (currentHash !== sha256) throw recordingError('RECORDING_CHUNK_CONFLICT', '同一录音分片已保存为不同内容，请勿覆盖', 409)
        duplicate = true
      }
    } finally { await rm(temporary, { force: true }) }
    return { byteSize: buffer.length, sha256, duplicate }
  }
  function epochStream(sessionId: string, epoch: number, chunkCount: number, hashes?: string[]) {
    if (!Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > 100_000) throw recordingError('RECORDING_INCOMPLETE', '录音没有完整分片', 409)
    return Readable.from((async function* () {
      for (let sequence = 0; sequence < chunkCount; sequence += 1) {
        const item = await inspectChunk(sessionId, epoch, sequence)
        // Each read is bounded to 2 MB; an eight-hour recording is never buffered whole.
        const buffer = await readFile(item.target)
        if (hashes?.[sequence] && createHash('sha256').update(buffer).digest('hex') !== hashes[sequence]) throw recordingError('RECORDING_CHUNK_HASH_MISMATCH', '已保存的录音分片校验失败', 422)
        yield buffer
      }
    })())
  }
  async function assemble(input: { sessionId: string; epoch: number; chunkCount: number; hashes: string[]; projectId: string; fileId: string; mimeType: string; signal?: AbortSignal }) {
    const first = await inspectChunk(input.sessionId, input.epoch, 0)
    assertRecordingContainerHeader((await readFile(first.target)).subarray(0, 32), input.mimeType)
    const { extension } = recordingContainer(input.mimeType)
    const storagePath = path.join(identifier(input.projectId), identifier(input.fileId), `recording.${extension}`)
    const target = path.join(storageRoot, storagePath)
    await safeDirectory(path.dirname(target))
    const temporary = `${target}.${randomUUID()}.tmp`
    const hash = createHash('sha256'); let byteSize = 0
    const stream = epochStream(input.sessionId, input.epoch, input.chunkCount, input.hashes)
    stream.on('data', (buffer: Buffer) => { hash.update(buffer); byteSize += buffer.length })
    try {
      await pipeline(stream, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal: input.signal })
      if (byteSize > RECORDING_SESSION_MAX_BYTES) throw recordingError('RECORDING_CAPACITY_EXCEEDED', '录音超过单场容量上限', 413)
      await rename(temporary, target)
      return { storagePath, byteSize, sha256: hash.digest('hex'), extension }
    } catch (error) { await rm(temporary, { force: true }); throw error }
  }
  return { putChunk, epochStream, assemble, inspectChunk, createFileStream: createReadStream }
}

export function splitTranscriptForSummary(content: string, maximum = 10_000): Array<{ start: number; end: number; text: string }> {
  if (!Number.isSafeInteger(maximum) || maximum < 100) throw new Error('invalid transcript chunk size')
  const parts: Array<{ start: number; end: number; text: string }> = []
  for (let start = 0; start < content.length;) {
    let end = Math.min(content.length, start + maximum)
    if (end < content.length) {
      const boundary = content.lastIndexOf('\n', end)
      if (boundary > start + maximum / 2) end = boundary + 1
      if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1])) end -= 1
    }
    parts.push({ start, end, text: content.slice(start, end) }); start = end
  }
  return parts
}
