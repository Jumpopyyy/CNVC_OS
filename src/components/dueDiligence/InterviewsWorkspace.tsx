import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Download, FileText, GripVertical, Mic, Pause, Play, Plus, Save, Send, Square, Trash2, Upload } from 'lucide-react'
import { Button, Card, Modal, StatusBadge } from '../ui'
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition'
import type { Interview, InterviewArtifact, InterviewPrompt, InterviewTranscript, TranscriptionJob, Question } from './types'
import { shouldReplaceTranscriptDraft } from './interviewTranscriptDraft'
import { useInterviewRecording, MAX_RECORDING_BYTES } from './useInterviewRecording'
import { clearTranscriptRecovery, loadTranscriptRecovery, saveTranscriptRecovery, type TranscriptRecovery } from './recordingRecoveryStore'
import { apiGet, apiPost } from '../../lib/api'
import { formatShanghaiDateTime, shanghaiDateTimeInputValue } from '../../lib/dateTime'

type SummaryTask = { id: string; archiveFileId?:string|null; transcriptVersion: number; status: 'queued' | 'processing' | 'ready' | 'failed' | 'confirmed'; completedChunks: number; totalChunks: number; summary: string; questionSuggestions: Array<{questionId: string; title: string; suggestion: string; evidenceExcerpt: string}>; errorMessage?: string }

const Field = ({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) => <label className={className}><span className="label">{label}</span>{children}</label>
const formatTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

export function InterviewsWorkspace(props: {
  userId?: string
  preview?: boolean
  recordingOwnerId?: string
  questions?: Question[]
  projectId: string
  interviews: Interview[]
  selected?: Interview
  prompts: InterviewPrompt[]
  artifacts: InterviewArtifact[]
  transcript?: InterviewTranscript
  transcriptionJobs: TranscriptionJob[]
  writeReady: boolean
  writeError?: string
  asrConfigured: boolean
  onSelect: (id: string) => void
  onCreate: () => void
  onSave: (interview: Interview, patch: Partial<Interview>) => Promise<Interview | null>
  onDelete: (interview: Interview) => Promise<void>
  onReorder: (ids: string[]) => Promise<void>
  onRemoveMaterial: (artifact: InterviewArtifact) => Promise<void>
  onUploadSummary: (interview: Interview, file: File) => Promise<void>
  onSaveTranscript: (interview: Interview, content: string, status: '草稿' | '已确认', expectedVersion?: number | null) => Promise<InterviewTranscript | null>
  onStartAsr: (interview: Interview, recordingFileId: string, browserText: string, transcriptVersion?: number | null) => Promise<TranscriptionJob | null>
  onRetryAsr: (interview: Interview, job: TranscriptionJob) => Promise<void>
  onGenerateSummary: (interview: Interview, transcriptVersion: number) => Promise<{ summary: string; transcriptVersion: number } | null>
  onArchiveText: (interview: Interview, kind: '转写稿' | '访谈纪要', content: string) => Promise<void>
  onSendPrompt: (interview: Interview, content: string, questionId?: string) => Promise<void>
  onConfirmPrompt: (interview: Interview, prompt: InterviewPrompt, status: InterviewPrompt['status'], response?: string) => Promise<void>
  onDeletePrompt: (interview: Interview, prompt: InterviewPrompt) => Promise<void>
  onRefreshLive: () => Promise<void>
  onRecordingState: (active: boolean) => void
}) {
  const [editOpen, setEditOpen] = useState(false)
  const [editDraft, setEditDraft] = useState<Partial<Interview>>({})
  const [orderOpen, setOrderOpen] = useState(false)
  const [order, setOrder] = useState<string[]>([])
  const [dragged, setDragged] = useState('')
  const [draft, setDraft] = useState('')
  const draftRef = useRef('')
  const persistedContent = useRef('')
  const savedVersion = useRef<number | null>(null)
  const selectedId = useRef(props.selected?.id)
  const [interim, setInterim] = useState('')
  const [summary, setSummary] = useState('')
  const [summaryVersion, setSummaryVersion] = useState<number | null>(null)
  const [operation, setOperation] = useState<'save' | 'summary' | 'upload' | 'asr' | null>(null)
  const operationLock = useRef(false)
  const [feedback, setFeedback] = useState('')
  const [operationError, setOperationError] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [selectedJobId, setSelectedJobId] = useState('')
  const [promptText, setPromptText] = useState('')
  const [promptQuestionId, setPromptQuestionId] = useState('')
  const [promptResponses, setPromptResponses] = useState<Record<string, string>>({})
  const [recoveredDraft, setRecoveredDraft] = useState<TranscriptRecovery | null>(null)
  const [conflictingTranscript, setConflictingTranscript] = useState<InterviewTranscript | null>(null)
  const [summaryTask, setSummaryTask] = useState<SummaryTask | null>(null)
  const [questionDecisions, setQuestionDecisions] = useState<Record<string, string>>({})
  const [lastTextSave, setLastTextSave] = useState('')
  const [offerMinutes, setOfferMinutes] = useState(false)
  const capture = useInterviewRecording(props.preview ? '' : props.userId || '', props.projectId, props.selected?.id || '')
  const recordState = capture.state
  const elapsed = capture.seconds
  const draftScope = `${props.userId || ''}/${props.projectId}/${props.selected?.id || ''}`
  const recordingTransition = useRef(false)
  const recordingBaseDraft = useRef('')
  const promptVoiceBase = useRef('')
  const textSaveLock = useRef(false)
  const textSavePromise = useRef<Promise<InterviewTranscript | null> | null>(null)
  const callbacks = useRef(props); callbacks.current = props
  const recordingOwner = props.recordingOwnerId
  const readOnly = Boolean(recordingOwner && recordingOwner !== props.userId)

  const appendTranscript = (text: string) => { const next = `${draftRef.current}${draftRef.current.trim() ? '\n' : ''}${text}`; draftRef.current = next; setDraft(next) }
  const speech = useSpeechRecognition({ continuous: true, onFinal: appendTranscript, onInterim: setInterim })
  const promptSpeech = useSpeechRecognition({ onFinal: text => setPromptText(value => `${value}${value ? ' ' : ''}${text}`) })

  useEffect(() => {
    selectedId.current = props.selected?.id
    const value = props.transcript?.content || ''
    recordingBaseDraft.current = value
    setDraft(value); draftRef.current = value; persistedContent.current = value; savedVersion.current = props.transcript?.version ?? null
    setSummary(props.selected?.summary || ''); setSummaryVersion(props.selected?.summaryTranscriptVersion ?? null)
    setFeedback(''); setOperationError(''); setInterim(''); setUploadOpen(false); setUploadFile(null); setSelectedJobId('')
  }, [props.selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const incoming = props.transcript
    if (!incoming || incoming.interviewId !== selectedId.current) return
    if (shouldReplaceTranscriptDraft(draftRef.current, persistedContent.current, savedVersion.current, incoming.version)) {
      setDraft(incoming.content); draftRef.current = incoming.content; persistedContent.current = incoming.content; savedVersion.current = incoming.version
    } else if (incoming.version > (savedVersion.current || 0) && incoming.content !== draftRef.current) setConflictingTranscript(incoming)
  }, [props.transcript?.id, props.transcript?.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = draft !== persistedContent.current
  const busy = recordState !== 'idle' || operation !== null
  useEffect(() => { props.onRecordingState(busy || dirty); return () => props.onRecordingState(false) }, [busy, dirty]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => { if (busy || draftRef.current !== persistedContent.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', preventLoss)
    return () => window.removeEventListener('beforeunload', preventLoss)
  }, [busy])
  useEffect(() => {
    if (!props.selected?.id) return
    void props.onRefreshLive().catch(() => {})
    const timer = window.setInterval(() => { void props.onRefreshLive().catch(error => setOperationError(`同步失败：${error.message}`)) }, 3_000)
    return () => window.clearInterval(timer)
  }, [props.selected?.id, props.onRefreshLive])
  useEffect(() => () => { speech.reset(); promptSpeech.reset() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (recordState !== 'recording' && speech.state === 'listening') void speech.pause() }, [recordState]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true
    if (props.userId && props.selected) void loadTranscriptRecovery(draftScope).then(value => { if (live && value && value.content !== persistedContent.current) setRecoveredDraft(value) }).catch(error => setOperationError(error.message))
    return () => { live = false }
  }, [draftScope])
  useEffect(() => {
    if (!dirty || readOnly || !props.userId || !props.selected) return
    const timer = window.setTimeout(() => { void saveTranscriptRecovery({ scope: draftScope, content: draftRef.current, baseVersion: savedVersion.current, updatedAt: new Date().toISOString() }).catch(error => setOperationError(error.message)) }, 300)
    return () => clearTimeout(timer)
  }, [draft, dirty, readOnly, draftScope])

  const begin = async () => {
    if (!props.selected) return
    if (props.preview) { setOperationError('预览模式不录音，请在已登录的测试环境验证录音保存。'); return }
    if (!props.writeReady) { window.alert(`当前页面暂时无法保存录音：${props.writeError || '写入来源校验未通过'}`); return }
    try {
      recordingBaseDraft.current = draftRef.current
      await capture.begin(); speech.start()
    } catch (error) { setOperationError(`无法开始录音：${error instanceof Error ? error.message : '麦克风不可用'}`) }
  }
  const pause = async () => { try { await capture.pause(); await speech.pause() } catch (error) { setOperationError(describeSaveError(error)) } }
  const resume = async () => { try { await capture.resume(); speech.start() } catch (error) { setOperationError(describeSaveError(error)) } }
  const discardRecording = async () => {
    if (recordingTransition.current) return
    if (!window.confirm('确认放弃本次录入？本次尚未保存的录音和新增转写将被删除。')) return
    speech.reset()
    try { await capture.discard(); setInterim(''); setDraft(recordingBaseDraft.current); draftRef.current = recordingBaseDraft.current } catch (error) { setOperationError(describeSaveError(error)) }
  }
  const startPromptSpeech = () => { promptVoiceBase.current = promptText; promptSpeech.start() }
  const discardPromptSpeech = () => { promptSpeech.reset(); setPromptText(promptVoiceBase.current) }
  const clearPrompt = () => { promptSpeech.reset(); promptVoiceBase.current = ''; setPromptText('') }
  const describeSaveError = (error: unknown) => {
    const message = error instanceof Error ? error.message : '未知错误'
    return /来源不信任|来源不受信任|ORIGIN_FORBIDDEN/i.test(message) ? '当前访问地址未加入可信来源。请使用平台正式地址后重新保存。' : message
  }
  const runOperation = async (kind: NonNullable<typeof operation>, action: () => Promise<void>) => {
    if (operationLock.current || recordingTransition.current) return
    operationLock.current = true; setOperation(kind); setOperationError(''); setFeedback('')
    try { await action() } catch (error) { setOperationError(describeSaveError(error)) }
    finally { operationLock.current = false; setOperation(null) }
  }
  const saveText = async (interview: Interview, content: string, status: '草稿' | '已确认') => {
    // Ending a recording waits for an autosave already in flight, then confirms
    // the requested text against the resulting version before queuing minutes.
    while (textSavePromise.current) await textSavePromise.current
    textSaveLock.current = true
    const pending = (async () => {
      const saved = await callbacks.current.onSaveTranscript(interview, content, status, savedVersion.current)
      if (!saved) throw new Error('转写未保存，请重试。当前文字仍保留在页面中。')
      if (selectedId.current === interview.id) {
        persistedContent.current = content; savedVersion.current = saved.version; setLastTextSave(new Date().toLocaleTimeString('zh-CN'))
        if (draftRef.current === content) await clearTranscriptRecovery(draftScope)
      }
      return saved
    })()
    textSavePromise.current = pending
    try { return await pending } finally { textSavePromise.current = null; textSaveLock.current = false }
  }
  useEffect(() => {
    if (!props.selected || readOnly || !props.writeReady) return
    const timer = window.setInterval(() => {
      if (textSaveLock.current || operationLock.current || recordingTransition.current || conflictingTranscript || draftRef.current === persistedContent.current) return
      void saveText(callbacks.current.selected!, draftRef.current, '草稿').catch(error => setOperationError('自动保存未完成：' + describeSaveError(error) + '。本机草稿保留。'))
    }, 3_000)
    return () => clearInterval(timer)
  }, [props.selected?.id, readOnly, props.writeReady, conflictingTranscript])
  useEffect(() => {
    if (!props.selected || props.preview) return
    let live = true; let polling = false
    const refresh = async () => {
      if (polling) return
      polling = true
      try {
        const data = await apiGet<{list: SummaryTask[]}>('/due-diligence/projects/' + props.projectId + '/interviews/' + props.selected!.id + '/summary/tasks')
        if (!live) return
        const task = data.list[0]
        setSummaryTask(old => {
          if (task && ['ready','confirmed'].includes(task.status) && (old?.id !== task.id || old?.status !== 'ready')) { setSummary(task.summary); setSummaryVersion(task.transcriptVersion) }
          return task || null
        })
      } catch (error) { if (live) setOperationError('读取纪要进度失败：' + describeSaveError(error)) }
      finally { polling = false }
    }
    void refresh(); const timer = window.setInterval(() => void refresh(), 3_000)
    return () => { live = false; clearInterval(timer) }
  }, [props.selected?.id, props.projectId])
  const generateMinutes = async (interview: Interview, content = draftRef.current) => {
    if (!content.trim()) throw new Error('尚无转写文字。请先采用后台转写结果，或输入并保存访谈文字。')
    const saved = await saveText(interview, content, '已确认')
    const result = await apiPost<SummaryTask>('/due-diligence/projects/' + interview.projectId + '/interviews/' + interview.id + '/summary/tasks', { transcriptVersion: saved.version })
    if (selectedId.current === interview.id) { setSummaryTask(result); setOfferMinutes(false); setFeedback('已提交全文纪要任务，可在此查看处理进度。'); if (result.status === 'ready') { setSummary(result.summary); setSummaryVersion(result.transcriptVersion) } }
  }
  const saveDraft = () => props.selected && runOperation('save', async () => {
    // Interim text remains mutable; saving it would duplicate the final result.
    const saved = await saveText(props.selected!, draftRef.current, '草稿')
    setFeedback('草稿已保存 · v' + saved.version + ' · ' + new Date().toLocaleTimeString('zh-CN'))
  })
  const submitRecording = () => props.selected && uploadFile && runOperation('upload', async () => {
    if (props.preview) throw new Error('预览模式不上传录音。')
    await capture.upload(uploadFile)
    setUploadOpen(false); setUploadFile(null)
    setFeedback('录音分片已保存，正在后台归档。完成后可在访谈产物中提交转写。')
    await props.onRefreshLive()
  })
  const startArtifactTranscription = (fileId: string) => props.selected && runOperation('asr', async () => {
    const job = await props.onStartAsr(props.selected!, fileId, '', savedVersion.current)
    if (!job) throw new Error('转写任务未创建，请稍后重试。')
    setSelectedJobId(job.id)
    if (props.asrConfigured && (job.status === '失败' || job.status === '未配置')) await props.onRetryAsr(props.selected!, job)
    setFeedback(job.status === '未配置' && !props.asrConfigured ? '录音已保存；配置后台语音识别服务后可重试。' : job.providerText ? '该录音已有转写结果，请在下方核对后采用。' : '转写任务已提交，请在下方查看进度或结果。')
  })
  const adoptProviderText = (job: TranscriptionJob, generate: boolean) => props.selected && runOperation(generate ? 'summary' : 'save', async () => {
    if (!job.providerText?.trim()) throw new Error('后台尚未返回转写文字。')
    if (draftRef.current.trim() && !window.confirm('采用后台转写会替换当前编辑框文字。确认已核对并采用？')) return
    const interview = props.selected!
    const content = job.providerText.trim()
    setDraft(content); draftRef.current = content
    if (generate) await generateMinutes(interview, content)
    else { await saveText(interview, content, '已确认'); setFeedback('后台转写已采用并保存，可编辑后生成纪要。') }
  })
  const finish = async () => {
    if (!props.selected || recordingTransition.current || operationLock.current) return
    recordingTransition.current = true
    await speech.stop()
    try {
      await capture.finish()
      if (draftRef.current.trim()) { await saveText(props.selected, draftRef.current, '已确认'); setOfferMinutes(true) }
      setFeedback('录音片段已保存，后台正在归档。浏览器关闭或电脑休眠期间不会继续采集。')
      await props.onRefreshLive()
    } catch (error) { setOperationError(describeSaveError(error)) } finally { recordingTransition.current = false }
  }
  const confirmSummary = () => props.selected && summaryTask && runOperation('summary', async () => {
    await apiPost('/due-diligence/projects/' + props.projectId + '/interviews/' + props.selected!.id + '/summary/tasks/' + summaryTask.id + '/confirm', {
      summary, expectedInterviewVersion: props.selected!.version,
      questionDecisions: Object.entries(questionDecisions).map(([questionId, conclusion]) => ({ questionId, conclusion, expectedVersion: props.questions?.find(item => item.id === questionId)?.version })),
    })
    setSummaryTask(value => value ? { ...value, status: 'confirmed' } : null)
    setFeedback('纪要已确认并归档；所选问题只更新备注，不会自动完成。')
    await props.onRefreshLive()
  })

  const selected = props.selected
  const projectMaterials = props.artifacts.filter(item => item.kind === '项目材料')
  const products = props.artifacts.filter(item => item.kind !== '项目材料')
  const newestJob = props.transcriptionJobs.find(job => job.id === selectedJobId) || props.transcriptionJobs[0]

  return <div className="space-y-5">
      <Card className="p-4"><div className="flex flex-wrap items-end gap-3"><Field label="访谈安排" className="min-w-64 flex-1"><select className="input" disabled={busy} value={selected?.id || ''} onChange={event => { if (dirty && !window.confirm('当前转写有未保存内容，确认放弃并切换访谈？')) return; props.onSelect(event.target.value) }}><option value="">请选择访谈</option>{props.interviews.map(item => <option key={item.id} value={item.id}>{item.title} · {item.scheduledAt ? formatShanghaiDateTime(item.scheduledAt) : '未排期'}</option>)}</select></Field><Button disabled={busy} onClick={() => { if (dirty && !window.confirm('当前转写有未保存内容，确认放弃并新建访谈？')) return; props.onCreate() }}><Plus className="h-4 w-4" />新建</Button><Button variant="secondary" disabled={!selected || busy} onClick={() => { if (selected) setEditDraft({ ...selected, scheduledAt: selected.scheduledAt ? shanghaiDateTimeInputValue(selected.scheduledAt).replace(' ', 'T') : null }); setEditOpen(true) }}>编辑</Button><Button variant="secondary" disabled={!selected || busy} onClick={() => selected && void props.onDelete(selected)}><Trash2 className="h-4 w-4" />删除</Button><Button variant="secondary" disabled={props.interviews.length < 2 || busy} onClick={() => { setOrder(props.interviews.map(item => item.id)); setOrderOpen(true) }}>管理顺序</Button></div></Card>
    {!selected ? <Card className="p-8 text-center text-sm text-slate-400">请选择或新建一场访谈。</Card> : <>
      <Card className="p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">项目相关材料</h2><p className="mt-1 text-xs text-slate-500">创建访谈时从项目中心导入；在此移除不会删除项目中心原文件。</p></div></div><div className="mt-3 grid gap-2 md:grid-cols-2">{projectMaterials.map(item => <div key={item.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm"><a className="min-w-0 truncate text-brand-700" href={`/api/projects/files/${item.fileId}/download`}>{item.name}</a><button className="ml-3 text-rose-500" onClick={() => void props.onRemoveMaterial(item)}><Trash2 className="h-4 w-4" /></button></div>)}{!projectMaterials.length && <p className="text-sm text-slate-400">当前访谈没有项目材料引用。</p>}</div></Card>
      <Card className="p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">录音与实时转写</h2><div className="flex flex-wrap gap-2">
        {recordState === 'idle' && <><Button variant="secondary" disabled={readOnly || !props.writeReady || operation !== null || readOnly} onClick={() => { setOperationError(''); setUploadOpen(true) }}><Upload className="h-4 w-4" />提交录音</Button><Button disabled={readOnly || !props.writeReady || operation !== null || readOnly} onClick={() => void begin()}><Mic className="h-4 w-4" />开始录入</Button></>}
        {recordState === 'requesting' && <Button disabled>正在申请权限…</Button>}
        {recordState === 'recording' && <Button variant="secondary" onClick={() => void pause()}><Pause className="h-4 w-4" />暂停 {formatTime(elapsed)}</Button>}
        {(recordState === 'paused' || recordState === 'recoverable') && <Button disabled={operation !== null} onClick={() => void resume()}><Play className="h-4 w-4" />{recordState === 'recoverable' ? '恢复并继续录入' : '继续录入'}</Button>}
        {recordState !== 'idle' && recordState !== 'requesting' && <><Button variant="secondary" disabled={operation !== null || recordState === 'finishing'} onClick={() => void finish()}><Square className="h-4 w-4" />{recordState === 'finishing' ? '正在结束…' : '结束'}</Button><Button variant="secondary" className="text-rose-600" disabled={operation !== null || recordState === 'finishing'} onClick={() => void discardRecording()}><Trash2 className="h-4 w-4" />放弃本次</Button></>}
      </div></div>
      {capture.session?.status === 'finalizing' && <p role="status" className="mt-2 text-sm text-slate-500">录音片段已保存，正在整理访谈产物…</p>}
      {capture.session?.status === 'archived' && <p role="status" className="mt-2 text-sm text-emerald-700">录音已归档，可在访谈产物中下载。</p>}
      {capture.checkpoint && <p role="status" className="mt-2 text-xs text-slate-500">录音检查点已保存：{new Date(capture.checkpoint).toLocaleTimeString('zh-CN')} · {formatTime(elapsed)}</p>}
      {recordState === 'recoverable' && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm">发现尚未结束的录音。可重新保存、继续录入或结束归档；中断期间没有采集声音。</p>}
      {readOnly && <p className="mt-3 text-sm text-slate-500">正在跟随现场记录人，可在下方发送插问。</p>}
      {recoveredDraft && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm"><p>发现本机未提交的文字草稿，请核对后恢复。</p><details><summary>查看草稿</summary><pre className="max-h-40 overflow-auto whitespace-pre-wrap">{recoveredDraft.content}</pre></details><Button size="sm" disabled={readOnly} onClick={() => { setDraft(recoveredDraft.content); draftRef.current = recoveredDraft.content; setRecoveredDraft(null) }}>恢复到编辑框</Button><Button size="sm" variant="secondary" onClick={() => { void clearTranscriptRecovery(draftScope); setRecoveredDraft(null) }}>使用服务器版本</Button></div>}
        {speech.error && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{speech.error} 录音不受影响。{props.asrConfigured ? '结束后可后台转写。' : '后台语音识别服务尚未配置；已有文字仍可保存并生成纪要。'}</p>}
        {capture.error && <div role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800"><p>{capture.error}</p><Button size="sm" variant="secondary" onClick={() => void capture.retry().catch(error => setOperationError(describeSaveError(error)))}>重新保存片段</Button></div>}
        {conflictingTranscript && <div role="alert" className="mt-3 rounded-lg border border-amber-200 p-3 text-sm"><p>服务器转写已有更新，已暂停自动保存。请对照合并，当前编辑文字不会被覆盖。</p><textarea className="textarea mt-2 max-h-40" readOnly value={conflictingTranscript.content} /><Button size="sm" onClick={() => { persistedContent.current = conflictingTranscript.content; savedVersion.current = conflictingTranscript.version; setConflictingTranscript(null); setFeedback('已采用最新版本号，请核对编辑框文字后保存。') }}>已核对，保留编辑框并继续保存</Button></div>}
        <textarea aria-label="访谈转写文字" className="textarea mt-4 min-h-72 w-full" value={draft} readOnly={readOnly} disabled={operation === 'summary' || operation === 'upload'} onChange={event => { setDraft(event.target.value); draftRef.current = event.target.value; setFeedback('') }} placeholder="实时转写会持续显示在这里，也可随时手工修订。" />{interim && <p className="mt-2 text-sm text-slate-400">正在识别：{interim}</p>}
        {lastTextSave && <p className="mt-2 text-xs text-slate-500">文字已保存：{lastTextSave}</p>}
        {offerMinutes && <div className="mt-3 flex items-center gap-3 text-sm"><span>是否基于当前文字生成纪要？</span><Button size="sm" disabled={operation !== null} onClick={() => void runOperation('summary', () => generateMinutes(selected))}>生成纪要</Button><Button size="sm" variant="secondary" onClick={() => setOfferMinutes(false)}>暂不生成</Button></div>}
        {feedback && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{feedback}</p>}
        {operationError && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{operationError}</p>}
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={readOnly || !props.writeReady || (!draft.trim() && !interim.trim()) || operation !== null || recordState === 'finishing'} loading={operation === 'save'} onClick={() => void saveDraft()}><Save className="h-4 w-4" />{operation === 'save' ? '保存中…' : '保存草稿'}</Button>
          <Button disabled={readOnly || !props.writeReady || !draft.trim() || busy} loading={operation === 'summary'} onClick={() => void runOperation('summary', () => generateMinutes(selected))}><FileText className="h-4 w-4" />{operation === 'summary' ? '生成中…' : '生成纪要'}</Button>
          <Button variant="secondary" disabled={readOnly || !props.writeReady || !draft.trim() || operation !== null} onClick={() => void props.onArchiveText(selected, '转写稿', draft)}>保存到项目材料</Button>
          <a className="inline-flex items-center rounded-lg border px-3 py-2 text-sm" href={`/api/due-diligence/projects/${props.projectId}/interviews/${selected.id}/export/transcript`}><Download className="mr-1 h-4 w-4" />导出转写稿</a>
        </div>
      <section className="mt-4 border-t border-slate-200 pt-4"><div className="flex items-center justify-between"><h2 className="font-semibold">远程插问</h2>{props.prompts.some(item => item.status === '待确认') && <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs text-white">{props.prompts.filter(item => item.status === '待确认').length} 条新插问</span>}</div><div className="mt-3"><select aria-label="插问关联核查问题" className="input" value={promptQuestionId} onChange={event => setPromptQuestionId(event.target.value)}><option value="">关联核查问题（可选）</option>{(props.questions || []).map(question => <option key={question.id} value={question.id}>{question.title}</option>)}</select></div><div className="mt-3 flex flex-wrap gap-2"><input className="input min-w-64 flex-1" value={promptText} onChange={event => setPromptText(event.target.value)} placeholder="输入需由现场同事追问的问题…" /><Button variant="secondary" disabled={recordState !== 'idle'} onClick={promptSpeech.state === 'listening' ? promptSpeech.stop : startPromptSpeech}>{promptSpeech.state === 'listening' ? '停止语音' : '语音'}</Button>{promptSpeech.state === 'listening' && <Button variant="secondary" className="text-rose-600" onClick={discardPromptSpeech}>放弃本次语音</Button>}{promptText && <Button variant="secondary" onClick={clearPrompt}>清空</Button>}<Button disabled={!promptText.trim()} onClick={async () => { await props.onSendPrompt(selected, promptText, promptQuestionId || undefined); clearPrompt() }}><Send className="h-4 w-4" />插问</Button></div>{promptSpeech.error && <p className="mt-2 text-xs text-amber-700">{promptSpeech.error}</p>}<div className="mt-4 space-y-2">{props.prompts.map(item => <div key={item.id} className="rounded-lg border p-3 text-sm"><div className="flex justify-between gap-3"><span>{item.content}</span><StatusBadge status={item.status} /></div>{item.response && <p className="mt-2 text-slate-500">答复：{item.response}</p>}{item.status === '待确认' && <div className="mt-2 flex flex-wrap gap-2"><input className="input min-w-48 flex-1" aria-label="插问答复摘要" placeholder="答复摘要（可选）" value={promptResponses[item.id] || ''} onChange={event => setPromptResponses(values => ({...values,[item.id]:event.target.value}))} /><Button size="sm" onClick={() => void props.onConfirmPrompt(selected, item, '已确认', promptResponses[item.id] || '')}>已追问</Button><Button size="sm" variant="secondary" onClick={() => void props.onConfirmPrompt(selected, item, '已忽略', promptResponses[item.id] || '')}>忽略</Button></div>}{item.status === '已忽略' && <div className="mt-2 flex justify-end"><Button size="sm" variant="secondary" className="text-rose-600" onClick={() => void props.onDeletePrompt(selected, item)}><Trash2 className="h-4 w-4" />删除</Button></div>}</div>)}{!props.prompts.length && <p className="text-sm text-slate-400">暂无远程插问。</p>}</div></section>

        {newestJob && <div className="mt-4 rounded-lg border border-slate-200 p-3 text-sm">
          {props.transcriptionJobs.length > 1 && <Field label="查看录音转写任务"><select className="input mb-3" value={newestJob.id} disabled={busy} onChange={event => setSelectedJobId(event.target.value)}>{props.transcriptionJobs.map(job => <option key={job.id} value={job.id}>{props.artifacts.find(item => item.fileId === job.recordingFileId)?.name || '访谈录音'} · {job.status}</option>)}</select></Field>}
          <div className="flex items-center justify-between"><strong>后台转写：{newestJob.status}</strong>{(newestJob.status === '失败' || newestJob.status === '未配置') && <Button size="sm" variant="secondary" disabled={readOnly || !props.writeReady || !props.asrConfigured || busy} onClick={() => void runOperation('asr', async () => { await props.onRetryAsr(selected, newestJob); setFeedback('已重新提交后台转写。') })}>重试转写</Button>}</div>
          {newestJob.status === '未配置' && <p className="mt-2 text-amber-700">录音已保存；后台语音识别服务尚未配置，暂不能自动转写。现有文字可直接生成纪要。</p>}
          {(newestJob.status === '待处理' || newestJob.status === '转写中') && <p role="status" className="mt-2 text-slate-500">正在处理录音，结果会自动显示。</p>}
          {newestJob.providerText && <><p className="mt-3 text-xs text-slate-500">录音转写结果 · 请核对后采用</p><textarea aria-label="后台转写结果" className="textarea mt-1 min-h-32" value={newestJob.providerText} readOnly /><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={readOnly || !props.writeReady || busy} onClick={() => void adoptProviderText(newestJob, false)}>采用并保存转写</Button><Button size="sm" disabled={readOnly || !props.writeReady || busy} onClick={() => void adoptProviderText(newestJob, true)}>采用并生成纪要</Button><Button size="sm" variant="secondary" disabled={busy} onClick={() => { const merged = [draftRef.current.trim(), newestJob.providerText?.trim()].filter(Boolean).join('\n\n'); setDraft(merged); draftRef.current = merged; setFeedback('已追加到文字草稿，请核对后保存。') }}>追加到草稿</Button></div></>}
          {newestJob.errorMessage && newestJob.status !== '未配置' && <p className="mt-2 text-amber-700">{newestJob.errorMessage}</p>}
        </div>}
      </Card>
      {summaryTask && <Card className="p-5"><h2 className="font-semibold">访谈纪要</h2><p role="status" className="mt-2 text-sm text-slate-500">全文处理：{summaryTask.completedChunks} / {summaryTask.totalChunks} 段 · {({queued:'排队中',processing:'处理中',ready:'待核对',failed:'处理未完成',confirmed:'已确认归档'})[summaryTask.status]}</p>
        {summaryTask.errorMessage && <p role="alert" className="mt-2 text-sm text-rose-600">{summaryTask.errorMessage}</p>}
        {summaryTask.status === 'confirmed' && !summaryTask.archiveFileId && <Button disabled={operation !== null} onClick={() => void confirmSummary()}>纪要已确认，重试归档</Button>}
        {summaryTask.status === 'failed' && <Button size="sm" onClick={() => void runOperation('summary', async () => { const task = await apiPost<SummaryTask>('/due-diligence/projects/' + props.projectId + '/interviews/' + selected.id + '/summary/tasks/' + summaryTask.id + '/retry', {}); setSummaryTask(task) })}>从未完成部分重试</Button>}
        {summaryTask.status === 'ready' && <><textarea aria-label="访谈纪要草稿" className="textarea mt-3 min-h-52" value={summary} onChange={event => setSummary(event.target.value)} />
        {summaryTask.questionSuggestions?.map(item => <label key={item.questionId} className="mt-3 block rounded-lg border p-3 text-sm"><input type="checkbox" checked={item.questionId in questionDecisions} onChange={event => setQuestionDecisions(values => { const result = {...values}; if (event.target.checked) result[item.questionId] = item.suggestion; else delete result[item.questionId]; return result })} /> 同步备注：{item.title}<p className="mt-1 text-slate-500">{item.evidenceExcerpt}</p>{item.questionId in questionDecisions && <textarea className="textarea mt-2" value={questionDecisions[item.questionId]} onChange={event => setQuestionDecisions(value => ({...value,[item.questionId]:event.target.value}))} />}</label>)}
        <div className="mt-3 flex justify-end"><Button disabled={readOnly || !props.writeReady || busy || !summary.trim()} onClick={() => void confirmSummary()}>确认并归档</Button></div></>}
        {summaryTask.status === 'confirmed' && summaryTask.archiveFileId && <p className="mt-2 text-sm text-emerald-700">已保存到访谈产物。转写来源版本：v{summaryVersion || summaryTask.transcriptVersion}</p>}
      </Card>}
      <Card className="p-5"><h2 className="font-semibold">访谈产物</h2><div className="mt-3 grid gap-2 md:grid-cols-2">{products.map(item => <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"><a className="min-w-0 truncate text-brand-700" href={`/api/projects/files/${item.fileId}/download`}>{item.kind}：{item.name}</a>{item.kind === '录音' && <Button size="sm" variant="secondary" disabled={readOnly || !props.writeReady || busy} onClick={() => void startArtifactTranscription(item.fileId)}>转写</Button>}</div>)}{!products.length && <p className="text-sm text-slate-400">录音、转写稿和纪要将在此显示。</p>}</div></Card>
    </>}
    {selected && <Modal open={editOpen} title="编辑访谈安排" onClose={() => setEditOpen(false)} footer={<><Button variant="secondary" onClick={() => setEditOpen(false)}>取消</Button><Button onClick={async () => { await props.onSave(selected, editDraft); setEditOpen(false) }}>保存</Button></>}><div className="grid grid-cols-2 gap-4"><Field label="访谈名称" className="col-span-2"><input className="input" value={editDraft.title || ''} onChange={event => setEditDraft(value => ({ ...value, title: event.target.value }))} /></Field><Field label="形式"><select className="input" value={editDraft.mode || '现场'} onChange={event => setEditDraft(value => ({ ...value, mode: event.target.value as Interview['mode'] }))}><option>现场</option><option>远程</option></select></Field><Field label="状态"><select className="input" value={editDraft.status || '筹备中'} onChange={event => setEditDraft(value => ({ ...value, status: event.target.value as Interview['status'] }))}><option>筹备中</option><option>进行中</option><option>已结束</option></select></Field><Field label="计划时间"><input className="input" type="datetime-local" value={typeof editDraft.scheduledAt === 'string' ? editDraft.scheduledAt : ''} onChange={event => setEditDraft(value => ({ ...value, scheduledAt: event.target.value || null }))} /></Field><Field label="访谈对象/单位"><input className="input" value={editDraft.counterparty || ''} onChange={event => setEditDraft(value => ({ ...value, counterparty: event.target.value }))} /></Field><Field label="地点"><input className="input" value={editDraft.location || ''} onChange={event => setEditDraft(value => ({ ...value, location: event.target.value }))} /></Field><Field label="参与人（逗号分隔）"><input className="input" value={(editDraft.participantNames || []).join('，')} onChange={event => setEditDraft(value => ({ ...value, participantNames: event.target.value.split(/[，,]/).map(item => item.trim()).filter(Boolean) }))} /></Field><Field label="访谈议程" className="col-span-2"><textarea className="textarea min-h-24" value={editDraft.agenda || ''} onChange={event => setEditDraft(value => ({ ...value, agenda: event.target.value }))} /></Field><Field label="上传访谈纪要" className="col-span-2"><input className="input" type="file" accept=".doc,.docx,.pdf,.txt,.md" onChange={event => { const file = event.target.files?.[0]; if (file) void props.onUploadSummary(selected, file) }} /></Field></div></Modal>}
    <Modal open={orderOpen} title="管理访谈顺序" onClose={() => setOrderOpen(false)} footer={<><Button variant="secondary" onClick={() => setOrderOpen(false)}>取消</Button><Button onClick={async () => { await props.onReorder(order); setOrderOpen(false) }}>保存顺序</Button></>}><div className="space-y-2">{order.map(id => { const item = props.interviews.find(value => value.id === id); return item ? <div key={id} draggable onDragStart={() => setDragged(id)} onDragOver={event => event.preventDefault()} onDrop={() => { if (!dragged || dragged === id) return; const next = [...order]; const from = next.indexOf(dragged); const to = next.indexOf(id); next.splice(to, 0, next.splice(from, 1)[0]); setOrder(next); setDragged('') }} className="flex cursor-grab items-center gap-2 rounded-lg border p-3"><GripVertical className="h-4 w-4 text-slate-400" />{item.title}</div> : null })}</div></Modal>
    <Modal open={uploadOpen} title="提交访谈录音" onClose={() => { if (!operationLock.current) setUploadOpen(false) }} footer={<><Button variant="secondary" disabled={operation !== null} onClick={() => setUploadOpen(false)}>取消</Button><Button disabled={!uploadFile || !props.writeReady || operation !== null} loading={operation === 'upload'} onClick={() => void submitRecording()}>{operation === 'upload' ? '上传 ' + (capture.uploadProgress ?? 0) + '%' : '上传并归档录音'}</Button></>}>
      <div className="space-y-4">
        <Field label="录音文件"><input className="input" type="file" accept=".mp3,.wav,.m4a,.webm" disabled={operation !== null} onChange={event => { setOperationError(''); const file = event.target.files?.[0]; if (!file) { setUploadFile(null); return } if (!/\.(mp3|wav|m4a|webm)$/i.test(file.name) || file.size > MAX_RECORDING_BYTES || !file.size) { setUploadFile(null); setOperationError('请选择不超过 1 GB 的 MP3、WAV、M4A 或 WebM 录音文件。'); return } setUploadFile(file) }} /></Field>
        {uploadFile && <p className="text-sm text-slate-600">{uploadFile.name} · {(uploadFile.size / 1024 / 1024).toFixed(1)} MB</p>}
        <p className="text-sm text-slate-500">支持 MP3、WAV、M4A、WebM，每次最多 1 GB。录音归档到当前项目和访谈；转写完成后核对文字，再生成纪要。</p>
        {!props.asrConfigured && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">后台语音识别服务尚未配置。本次可先保存录音，配置后在访谈产物中提交转写；现有访谈文字仍可生成纪要。</p>}
        {operationError && <p role="alert" className="text-sm text-rose-700">{operationError}</p>}
      </div>
    </Modal>
  </div>
}
