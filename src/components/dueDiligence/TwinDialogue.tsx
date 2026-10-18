import { useEffect, useRef, useState } from 'react'
import { Mic, Send } from 'lucide-react'
import { Button, Modal } from '../ui'
import { apiPost } from '../../lib/api'
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition'
import { TwinAvatar } from './TwinAvatar'
import type { LibrarySnapshot } from '../../../server/src/contracts/dueDiligenceLibrary'
import { createTwinConversationGate, inputAfterTwinReply } from './twinConversationState'

export type TwinDialogueTarget = { id: string; twinId: string; name: string; public: boolean; avatarKind?: 'preset' | 'upload'; avatarPreset?: string | null; learningTwinId?: string }
type Dialogue = { conversationId: string; messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; metadata?: { auditId?: string; citations?: Array<{ sourceId: string; fileId?: string; title: string; version: number }> } }>; snapshot: { twinName: string; twinVersion: number; skills: Array<{ id: string; name: string; version: number }>; library?: LibrarySnapshot[]; libraryWarnings?: string[] } }

export function TwinDialogue({ target, projects = [], onClose, onLearned }: { target: TwinDialogueTarget; projects?: Array<{id:string;name:string}>; onClose: () => void; onLearned: () => Promise<void> }) {
  const [mode, setMode] = useState<'advice'|'project'>('advice'); const [projectId, setProjectId] = useState('')
  const [data, setData] = useState<Dialogue | null>(null)
  const [question, setQuestion] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [useSkills, setUseSkills] = useState(true)
  const [feedback, setFeedback] = useState(''); const [notice, setNotice] = useState(''); const [loading, setLoading] = useState(true)
  const [interimText, setInterimText] = useState('')
  const [pendingAction, setPendingAction] = useState<{ message: string; label: string; run: () => void } | null>(null)
  const requests = useRef(createTwinConversationGate()).current
  const replyController = useRef<AbortController | null>(null)
  useEffect(() => () => replyController.current?.abort(), [])
  const changingContext = useRef(false)
  const questionRef = useRef(question); questionRef.current = question
  const speech = useSpeechRecognition({ continuous: true, onInterim: setInterimText, onFinal: text => { questionRef.current = `${questionRef.current}${questionRef.current ? '\n' : ''}${text}`; setQuestion(questionRef.current) } })
  const path = `/due-diligence/${target.public ? 'twin-directory' : 'twins'}/${target.id}/dialogue`
  useEffect(() => () => requests.invalidate(), [requests])
  useEffect(() => {
    const ticket = requests.beginLoad(); setBusy(false); setNotice('')
    if (mode === 'project' && !projectId) { setData(null); setLoading(false); setError(''); return }
    const controller = new AbortController(); setLoading(true); setError(''); setData(null)
    void apiPost<Dialogue>(path, { useSkills, mode, projectId: mode === 'project' ? projectId : undefined }, { signal: controller.signal }).then(result => { if (!controller.signal.aborted && requests.isCurrent(ticket)) setData(result) }).catch(err => { if (!controller.signal.aborted && requests.isCurrent(ticket)) setError((err as Error).message) }).finally(() => { if (!controller.signal.aborted && requests.isCurrent(ticket)) setLoading(false) })
    return () => { controller.abort(); requests.invalidate() }
  }, [path, useSkills, mode, projectId])
  const send = async () => {
    if (busy || loading || pendingAction || changingContext.current || !(questionRef.current.trim() || interimText.trim()) || (mode === 'project' && !projectId)) return
    const ticket = requests.beginWrite(); if (ticket === null) return
    setBusy(true); setError(''); setNotice('')
    const controller = new AbortController(); replyController.current = controller
    try {
      await speech.pause()
      if (!requests.isCurrent(ticket)) return
      const submittedText = questionRef.current
      if (!submittedText.trim()) return
      const result = await apiPost<Dialogue>(`${path}/messages`, { message: submittedText, useSkills, mode, projectId: mode === 'project' ? projectId : undefined }, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(240000)]) })
      if (!requests.isCurrent(ticket) || controller.signal.aborted) return
      setData(result); questionRef.current = inputAfterTwinReply(questionRef.current, submittedText); setQuestion(questionRef.current); setFeedback('')
    } catch (err) { if (requests.isCurrent(ticket)) setError(controller.signal.aborted ? '已停止本次回复，未发送内容已保留。' : (err as Error).message) }
    finally { if (replyController.current === controller) replyController.current = null; if (requests.finishWrite(ticket)) setBusy(false) }
  }
  const respond = async (decision: '采纳' | '修改' | '拒绝') => {
    if (!target.learningTwinId || !data || busy || pendingAction || changingContext.current) return
    const answer = data.messages.at(-1); const sourceQuestion = data.messages.at(-2)
    if (answer?.role !== 'assistant' || sourceQuestion?.role !== 'user') return
    const ticket = requests.beginWrite(); if (ticket === null) return
    setBusy(true); setError('')
    try { await apiPost(`/due-diligence/twins/${target.learningTwinId}/conversation-candidates`, { conversationId: data.conversationId, messageId: answer.id, feedback: decision, feedbackNote: feedback }); if (!requests.isCurrent(ticket)) return; setFeedback(''); setNotice(decision === '拒绝' ? '已记录反馈，不学习此回答。' : '已记录反馈，提炼结果将进入该分身的待学习区域。'); await onLearned() } catch (err) { if (requests.isCurrent(ticket)) setError((err as Error).message) } finally { if (requests.finishWrite(ticket)) setBusy(false) }
  }
  const changeContext = async (change: () => void) => {
    if (requests.isWriting() || pendingAction || changingContext.current) return
    changingContext.current = true
    try {
      await speech.pause()
      const complete = () => {
        requests.invalidate(); setData(null); setLoading(true)
        questionRef.current = ''; setQuestion(''); setFeedback(''); speech.reset(); change(); setPendingAction(null)
      }
      if (questionRef.current.trim() || feedback.trim()) setPendingAction({ message: '切换对话范围会清空尚未发送的问题和反馈，是否继续？', label: '放弃并切换', run: complete })
      else complete()
    } finally { changingContext.current = false }
  }
  const close = async () => {
    if (pendingAction || changingContext.current) return
    await speech.pause()
    const complete = () => { replyController.current?.abort(); requests.invalidate(); speech.reset(); onClose() }
    if (requests.isWriting() || questionRef.current.trim() || feedback.trim()) setPendingAction({ message: '还有未发送的内容或正在处理的请求。关闭后未发送内容不会保存；已保存的对话可重新打开查看。', label: '放弃并关闭', run: complete })
    else complete()
  }
  return <Modal open title={`与 ${target.name} 对话`} width="max-w-3xl" onClose={() => void close()}><div className="space-y-4">
    {pendingAction && <section role="alertdialog" aria-label="确认离开当前对话" className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3"><p className="text-sm text-amber-900">{pendingAction.message}</p><div className="flex gap-2"><Button size="sm" autoFocus onClick={() => setPendingAction(null)}>继续编辑</Button><Button size="sm" variant="secondary" onClick={pendingAction.run}>{pendingAction.label}</Button></div></section>}
    <fieldset disabled={Boolean(pendingAction)} aria-label="分身对话内容" className="min-w-0 space-y-4">
    <div className="flex items-center gap-3"><TwinAvatar id={target.twinId} name={target.name} kind={target.avatarKind} preset={target.avatarPreset} /><div><strong>{target.name}</strong>{data && <p className="text-sm text-slate-500">v{data.snapshot.twinVersion}{data.snapshot.skills.length ? ` · 本次参考：${data.snapshot.skills.map(skill => `${skill.name} v${skill.version}`).join('、')}` : ''}</p>}</div></div>
    <div className="flex flex-wrap gap-2"><Button size="sm" variant={mode === 'advice' ? 'primary' : 'secondary'} disabled={busy} onClick={() => { if (mode !== 'advice') void changeContext(() => setMode('advice')) }}>请教判断建议</Button><Button size="sm" variant={mode === 'project' ? 'primary' : 'secondary'} disabled={busy} onClick={() => { if (mode !== 'project') void changeContext(() => setMode('project')) }}>询问项目进展</Button></div>
    {mode === 'project' && <label className="block"><span className="label">选择询问的项目</span><select className="input" value={projectId} disabled={busy} onChange={event => { const next = event.target.value; void changeContext(() => setProjectId(next)) }}><option value="">请选择项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select><p className="mt-2 text-xs text-slate-500">依据该员工已确认的核查、纪要和正式提交材料回答，并展示来源；缺失内容会提醒员工补充。</p></label>}
    {!target.public && mode === 'advice' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={useSkills} disabled={busy} onChange={event => { const next = event.target.checked; void changeContext(() => setUseSkills(next)) }} />自动使用已启用且适用的 Skill</label>}
    {loading && <p role="status" className="text-sm text-slate-500">加载对话中…</p>}
    {busy && <Button size="sm" variant="secondary" onClick={() => replyController.current?.abort()}>停止本次回复</Button>}
    {data?.snapshot.library?.length ? <p className="text-xs text-brand-700">本次公共能力：{data.snapshot.library.map(item => `${item.name} v${item.version}`).join('、')}</p> : null}
    {data?.snapshot.libraryWarnings?.length ? <p role="status" className="text-xs text-amber-800">{data.snapshot.libraryWarnings.join('；')}</p> : null}
    <div className="max-h-96 space-y-3 overflow-y-auto" aria-live="polite">{data?.messages.map(message => <div key={message.id} className={`rounded-lg p-3 ${message.role === 'user' ? 'ml-5 bg-brand-50' : 'mr-5 bg-slate-50'}`}><p className="mb-1 text-xs text-slate-500">{message.role === 'user' ? '我' : target.name}</p><p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>{message.role === 'assistant' && message.metadata?.citations?.filter(item => item.fileId).map(item => <a key={item.sourceId} className="mt-2 block text-xs text-brand-700 underline" href={`/api/projects/files/${item.fileId}/versions/${item.version}/download`} target="_blank" rel="noreferrer">查看原材料：{item.title}</a>)}</div>)}</div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <label className="block"><span className="label">继续对话</span><textarea className="textarea min-h-24" value={question} onChange={event => { questionRef.current = event.target.value; setQuestion(event.target.value) }} placeholder="输入希望分身协助核验的问题…" /></label>
    <div className="flex flex-wrap items-center gap-2"><Button variant="secondary" disabled={busy} onClick={speech.state === 'listening' ? speech.pause : speech.start}><Mic className="h-4 w-4" />{speech.state === 'listening' ? '暂停语音' : '语音输入'}</Button><Button disabled={busy || loading || !(question.trim() || interimText.trim()) || (mode === 'project' && !projectId)} onClick={() => void send()}><Send className="h-4 w-4" />{busy ? '处理中…' : '发送'}</Button>{interimText && <span className="text-sm text-slate-500">{interimText}</span>}{speech.error && <span role="alert" className="text-sm text-amber-700">{speech.error}</span>}</div>
    {mode === 'advice' && data?.messages.at(-1)?.role === 'assistant' && target.learningTwinId && <details className="border-t pt-3"><summary className="cursor-pointer text-sm text-slate-600">反馈并沉淀经验</summary><input className="input mt-2" aria-label="修改说明" value={feedback} readOnly={busy} onChange={event => setFeedback(event.target.value)} placeholder="如需修改，请补充你的判断" /><div className="mt-2 flex gap-2">{(['采纳', '修改', '拒绝'] as const).map(value => <Button key={value} size="sm" variant="secondary" disabled={busy || (value === '修改' && !feedback.trim())} onClick={() => void respond(value)}>{value}</Button>)}</div></details>}
    {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    </fieldset>
  </div></Modal>
}
