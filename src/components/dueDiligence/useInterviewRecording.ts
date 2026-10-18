import { useEffect, useRef, useState } from 'react'
import { api, apiGet, apiPost } from '../../lib/api'
import { clearRecordingRecovery, deleteRecordingChunk, loadRecordingRecovery, nextRecordingChunk, recordingChunkKey, saveRecordingCheckpoint, saveRecordingRecovery, type RecordingRecovery } from './recordingRecoveryStore'
import { createRecordingChunkQueue } from './recordingChunkQueue'

export type RecordingSession = { id: string; epoch: number; status: 'recording' | 'paused' | 'finalizing' | 'archived' | 'discarded' | 'failed'; durationSeconds: number; lastCheckpointAt?: string; ownerUserId: string; fileIds: string[]; mimeType: string; source?: string; errorMessage?: string | null }
export const RECORDING_CHUNK_BYTES = 2 * 1024 * 1024
export const MAX_RECORDING_SECONDS = 8 * 60 * 60
export const MAX_RECORDING_BYTES = 1024 * 1024 * 1024
const reason = (error: unknown) => error instanceof Error ? error.message : '录音保存失败'
const sha256 = async (blob: Blob) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), value => value.toString(16).padStart(2, '0')).join('')

export function useInterviewRecording(userId: string, projectId: string, interviewId: string) {
  const scope = `${userId}/${projectId}/${interviewId}`
  const base = `/due-diligence/projects/${projectId}/interviews/${interviewId}/recording-sessions`
  const [state, setState] = useState<'idle' | 'requesting' | 'recording' | 'paused' | 'finishing' | 'recoverable'>('idle')
  const [session, setSession] = useState<RecordingSession | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const [checkpoint, setCheckpoint] = useState('')
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const recovery = useRef<RecordingRecovery | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const localWrites = useRef(Promise.resolve())
  const localQueue = useRef(createRecordingChunkQueue(RECORDING_CHUNK_BYTES))
  const inFlight = useRef<Promise<void> | null>(null)
  const mounted = useRef(true)
  const loadingRecovery = useRef(true)
  const transition = useRef(false)
  const startedAt = useRef(0)
  const pausedSeconds = useRef(0)
  const currentSeconds = () => Math.min(MAX_RECORDING_SECONDS, pausedSeconds.current + (startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0))
  const stopTracks = () => { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null }
  const persist = async () => {
    if (!recovery.current) return
    recovery.current.seconds = currentSeconds()
    await saveRecordingRecovery({ ...recovery.current })
  }
  const flush = async () => {
    if (inFlight.current) return inFlight.current
    const task = (async () => {
      let chunk = await nextRecordingChunk(scope)
      while (chunk) {
        const result = await api<{ session: RecordingSession }>(`${base}/${chunk.sessionId}/epochs/${chunk.epoch}/chunks/${chunk.sequence}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-Chunk-Sha256': await sha256(chunk.blob) }, body: chunk.blob,
        })
        // A crash can persist a chunk before its session checkpoint. Reconcile
        // counts before deleting the local copy so finalization cannot omit it.
        const current = recovery.current
        if (current?.sessionId === chunk.sessionId) {
          current.epochCounts = { ...current.epochCounts, [chunk.epoch]: Math.max(current.epochCounts?.[chunk.epoch] || 0, chunk.sequence + 1) }
          if (current.epoch === chunk.epoch) current.nextSequence = Math.max(current.nextSequence, chunk.sequence + 1)
          await persist()
        }
        await deleteRecordingChunk(chunk.key)
        if (mounted.current) { setSession(result.session); setCheckpoint(result.session.lastCheckpointAt || new Date().toISOString()); if (!localQueue.current.pendingBytes) setError('') }
        chunk = await nextRecordingChunk(scope)
      }
    })()
    inFlight.current = task
    try { await task } finally { inFlight.current = null }
  }
  const drainLocal = () => {
    localWrites.current = localQueue.current.flush(async (blob, target) => {
      const current = recovery.current
      if (!current || current.sessionId !== target.sessionId) throw new Error('录音会话发生变化，未保存片段仍保留在本页。')
      const sequence = current.epochCounts?.[target.epoch] ?? (target.epoch === current.epoch ? current.nextSequence : 0)
      const checkpointValue = { ...current, seconds: currentSeconds(), epochCounts: { ...current.epochCounts, [target.epoch]: sequence + 1 }, nextSequence: target.epoch === current.epoch ? sequence + 1 : current.nextSequence }
      await saveRecordingCheckpoint(checkpointValue, { key: recordingChunkKey(scope, target.sessionId, target.epoch, sequence), scope, ...target, sequence, blob })
      current.epochCounts = { ...current.epochCounts, [target.epoch]: sequence + 1 }
      if (target.epoch === current.epoch) current.nextSequence = sequence + 1
    }).then(() => {
      // Never block durable local writes on the network: offline chunks live on disk.
      void flush().catch(problem => { if (mounted.current) setError(`${reason(problem)}；片段已保存在本机，可重新保存。`) })
    }).catch(problem => {
      const current = recorder.current
      if (current?.state === 'recording') { current.pause(); pausedSeconds.current = currentSeconds(); startedAt.current = 0 }
      if (mounted.current) { setState('paused'); setError(`本机检查点保存失败：${reason(problem)}。已暂停，请勿关闭页面。`) }
      throw problem
    })
    void localWrites.current.catch(() => {})
    return localWrites.current
  }
  const queueBlob = (blob: Blob) => {
    const current = recovery.current
    if (!current || !blob.size) return
    localQueue.current.add(blob, { sessionId: current.sessionId, epoch: current.epoch })
    if (localQueue.current.pendingBytes > 4 * RECORDING_CHUNK_BYTES && recorder.current?.state === 'recording') {
      recorder.current.pause(); pausedSeconds.current = currentSeconds(); startedAt.current = 0
      if (mounted.current) { setState('paused'); setError('本机保存速度不足，已暂停录入；保存完成后可继续。') }
    }
    void drainLocal().catch(() => {})
  }
  const startMedia = async (media: MediaStream, mimeType: string) => {
    const item = new MediaRecorder(media, { mimeType, audioBitsPerSecond: 64_000 })
    recorder.current = item
    item.ondataavailable = event => queueBlob(event.data)
    item.onerror = () => { if (mounted.current) { setError('浏览器录音异常，已保存片段仍可恢复。'); setState('recoverable') } stopTracks() }
    item.start(30_000); startedAt.current = Date.now(); setState('recording')
  }
  const begin = async () => {
    if (loadingRecovery.current) throw new Error('正在检查历史录音，请稍后开始。')
    if (transition.current || recovery.current) return
    transition.current = true; setState('requesting'); setError('')
    try {
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(value => MediaRecorder.isTypeSupported(value))
      if (!mimeType) throw new Error('当前浏览器不支持可归档的录音格式，请使用 Chrome 或 Safari。')
      const media = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.current = media
      const item = await apiPost<RecordingSession>(base, { clientRequestId: crypto.randomUUID(), mimeType, source: 'browser' })
      recovery.current = { scope, sessionId: item.id, epoch: item.epoch, nextSequence: 0, mimeType, seconds: 0, stopped: false, epochCounts: { [item.epoch]: 0 } }
      pausedSeconds.current = 0; setSeconds(0); setSession(item); await persist(); await startMedia(media, mimeType)
    } catch (problem) { stopTracks(); setState(recovery.current ? 'recoverable' : 'idle'); setError(reason(problem)); throw problem }
    finally { transition.current = false }
  }
  const pause = async () => {
    const current = recorder.current
    if (current?.state !== 'recording') return
    current.requestData(); current.pause(); pausedSeconds.current = currentSeconds(); startedAt.current = 0
    setSeconds(pausedSeconds.current); setState('paused'); await persist()
    if (recovery.current) await apiPost(`${base}/${recovery.current.sessionId}/heartbeat`, { epoch: recovery.current.epoch, durationSeconds: Math.round(pausedSeconds.current), status: 'paused' }).catch(problem => setError(reason(problem)))
  }
  const resume = async () => {
    if (transition.current || !recovery.current) return
    if (recovery.current.uploadIncomplete) throw new Error('文件尚未上传完整，请放弃此上传后重新选择原文件。')
    if (currentSeconds() >= MAX_RECORDING_SECONDS) throw new Error('已达到单场 8 小时上限，请结束并保存。')
    transition.current = true
    try {
      await drainLocal(); await flush()
      if (recorder.current?.state === 'paused') { recorder.current.resume(); startedAt.current = Date.now(); setState('recording'); return }
      const current = recovery.current
      const media = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.current = media
      const item = await apiPost<RecordingSession>(`${base}/${current.sessionId}/resume`, { expectedEpoch: current.epoch, mimeType: current.mimeType })
      current.epoch = item.epoch; current.nextSequence = 0; current.stopped = false
      current.epochCounts = { ...current.epochCounts, [item.epoch]: 0 }
      setSession(item); await persist(); await startMedia(media, current.mimeType)
    } catch (problem) { if (!recorder.current) stopTracks(); setError(reason(problem)); throw problem }
    finally { transition.current = false }
  }
  const stop = () => new Promise<void>((resolve, reject) => {
    const current = recorder.current
    if (!current || current.state === 'inactive') { resolve(); return }
    current.onstop = () => { recorder.current = null; stopTracks(); resolve() }
    current.onerror = () => { stopTracks(); reject(new Error('录音结束异常，已保存片段可重试归档。')) }
    current.stop()
  })
  const finish = async () => {
    if (transition.current || !recovery.current) return null
    if (recovery.current.uploadIncomplete) throw new Error('文件尚未上传完整，不能归档为完整录音。请重新选择原文件。')
    transition.current = true; setState('finishing'); setError('')
    try {
      pausedSeconds.current = currentSeconds(); startedAt.current = 0
      await stop(); await drainLocal()
      recovery.current.stopped = true; await persist(); await flush()
      const result = await apiPost<RecordingSession>(`${base}/${recovery.current.sessionId}/finalize`, { durationSeconds: Math.round(pausedSeconds.current), expectedChunks: Object.entries(recovery.current.epochCounts || {}).map(([epoch,count]) => ({epoch:Number(epoch),count})) })
      setSession(result); await clearRecordingRecovery(scope); recovery.current = null; setState('idle'); setSeconds(0)
      return result
    } catch (problem) { setState('recoverable'); setError(reason(problem)); throw problem }
    finally { transition.current = false }
  }
  const discard = async () => {
    if (transition.current) return
    transition.current = true
    try {
      if (recorder.current) recorder.current.ondataavailable = null
      await stop(); await localWrites.current.catch(() => {}); await inFlight.current?.catch(() => {})
      if (recovery.current) await apiPost(`${base}/${recovery.current.sessionId}/discard`, {})
      await clearRecordingRecovery(scope); recovery.current = null; localQueue.current.clear(); localWrites.current = Promise.resolve(); startedAt.current = 0; pausedSeconds.current = 0
      setState('idle'); setSeconds(0); setSession(null); setError('')
    } finally { transition.current = false }
  }
  const retry = async () => {
    await drainLocal(); await flush(); setError('')
    if (session?.status !== 'failed' || transition.current) return
    transition.current = true
    try {
      const detail = await apiGet<{session:RecordingSession;chunks:Array<{epoch:number;sequence:number}>}>(`${base}/${session.id}`)
      const counts: Record<number,number> = {}
      for (let epoch = 0; epoch <= detail.session.epoch; epoch++) counts[epoch] = 0
      for (const chunk of detail.chunks) counts[chunk.epoch] = Math.max(counts[chunk.epoch] || 0, chunk.sequence + 1)
      const result = await apiPost<RecordingSession>(`${base}/${session.id}/finalize`, {durationSeconds:detail.session.durationSeconds,expectedChunks:Object.entries(counts).map(([epoch,count])=>({epoch:Number(epoch),count}))})
      await clearRecordingRecovery(scope); recovery.current = null; setState('idle'); setSession(result); setError('')
    } finally { transition.current = false }
  }
  const upload = async (file: File) => {
    if (loadingRecovery.current) throw new Error('正在检查历史录音，请稍后上传。')
    if (transition.current || recovery.current) throw new Error('请先结束或放弃当前录音。')
    if (!file.size || file.size > MAX_RECORDING_BYTES) throw new Error('录音文件应小于 1 GB。')
    transition.current = true; setUploadProgress(0)
    try {
      const mimeType = ({mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',webm:'audio/webm'} as Record<string,string>)[file.name.split('.').at(-1)?.toLowerCase() || ''] || file.type
      const item = await apiPost<RecordingSession>(base, { clientRequestId: crypto.randomUUID(), mimeType, fileName: file.name, source: 'upload' })
      recovery.current = { scope, sessionId: item.id, epoch: item.epoch, nextSequence: 0, mimeType, seconds: 0, stopped: true, uploadIncomplete: true }
      pausedSeconds.current = 0; await persist(); setSession(item)
      for (let offset = 0; offset < file.size; offset += RECORDING_CHUNK_BYTES) {
        queueBlob(file.slice(offset, offset + RECORDING_CHUNK_BYTES)); await localWrites.current; await flush()
        setUploadProgress(Math.min(100, Math.round((offset + RECORDING_CHUNK_BYTES) / file.size * 100)))
      }
      recovery.current.uploadIncomplete = false; await persist()
      const result = await apiPost<RecordingSession>(`${base}/${item.id}/finalize`, { durationSeconds: 0, expectedChunks: Object.entries(recovery.current.epochCounts || {}).map(([epoch,count]) => ({epoch:Number(epoch),count})) })
      await clearRecordingRecovery(scope); recovery.current = null; setSession(result); return result
    } catch (problem) {
      // A partial file is not a complete recording. Keep a recoverable marker,
      // but require re-selection instead of offering to finalize a truncated file.
      setError(`${reason(problem)}。上传未完成，请放弃此未完成上传后重新选择原文件。`); setState('recoverable'); throw problem
    } finally { transition.current = false; setUploadProgress(null) }
  }
  useEffect(() => {
    mounted.current = true
    let live = true
    loadingRecovery.current = Boolean(userId && interviewId)
    if (userId && interviewId) void loadRecordingRecovery(scope).then(async value => {
      if (!live) return
      if (!value) {
        const data = await apiGet<{list:RecordingSession[]}>(base)
        const own = data.list.find(item => item.ownerUserId === userId && ['recording','paused','failed','finalizing'].includes(item.status))
        if (!own || !live) return
        value = {scope,sessionId:own.id,epoch:own.epoch,nextSequence:0,mimeType:own.mimeType,seconds:own.durationSeconds,stopped:true,uploadIncomplete:own.source === 'upload' && own.status !== 'failed',epochCounts:{}}
      }
      const result = await apiGet<{ session: RecordingSession; chunks: Array<{epoch:number;sequence:number}> }>(`${base}/${value.sessionId}`)
      if (!live) return
      if (['archived', 'discarded', 'finalizing'].includes(result.session.status)) { await clearRecordingRecovery(scope); setSession(result.session); return }
      for (let epoch=0; epoch<=result.session.epoch; epoch++) value.epochCounts = {...value.epochCounts,[epoch]:value.epochCounts?.[epoch] || 0}
      for (const chunk of result.chunks) value.epochCounts = {...value.epochCounts,[chunk.epoch]:Math.max(value.epochCounts?.[chunk.epoch] || 0,chunk.sequence + 1)}
      value.nextSequence = Math.max(value.nextSequence, value.epochCounts?.[value.epoch] || 0)
      recovery.current = value; pausedSeconds.current = value.seconds; setSeconds(value.seconds); setSession(result.session); setState('recoverable')
    }).catch(problem => { if (live) setError(reason(problem)) }).finally(() => { if (live) loadingRecovery.current = false })
    return () => { live = false; mounted.current = false; if (recorder.current?.state === 'recording') pausedSeconds.current = currentSeconds(); startedAt.current = 0; const current = recorder.current; if (current && current.state !== 'inactive') current.stop(); stopTracks() }
  }, [scope]) // The workspace is keyed by user/project/interview.
  useEffect(() => {
    if (!session || session.status !== 'finalizing') return
    let live=true; let pending=false
    const timer=window.setInterval(async()=>{
      if(pending)return;pending=true
      try { const result=await apiGet<{session:RecordingSession}>(`${base}/${session.id}`); if(live){setSession(result.session);if(result.session.status==='failed')setError(result.session.errorMessage || '后台归档未完成，片段仍已保存。')} } catch(problem){if(live)setError(reason(problem))} finally{pending=false}
    },3000)
    return()=>{live=false;clearInterval(timer)}
  },[session?.id,session?.status,base])
  useEffect(() => {
    if (state !== 'recording') return
    const timer = window.setInterval(() => {
      setSeconds(Math.round(currentSeconds()))
      if (currentSeconds() >= MAX_RECORDING_SECONDS) void pause().catch(problem => setError(reason(problem)))
    }, 1000)
    return () => clearInterval(timer)
  }, [state])
  useEffect(() => {
    if (!['recording', 'paused', 'recoverable'].includes(state)) return
    const timer = window.setInterval(() => {
      void (async () => { await localWrites.current; await persist(); await flush(); const value = recovery.current; if (value) await apiPost(`${base}/${value.sessionId}/heartbeat`, { epoch: value.epoch, durationSeconds: Math.round(currentSeconds()), status: state === 'recording' ? 'recording' : 'paused' }) })().catch(problem => setError(reason(problem)))
    }, 30_000)
    return () => clearInterval(timer)
  }, [state, base])
  return { state, session, seconds, error, checkpoint, uploadProgress, begin, pause, resume, finish, discard, upload, retry }
}
