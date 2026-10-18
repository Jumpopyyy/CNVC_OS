import { useEffect, useRef, useState } from 'react'
import { FileUp, Mic, Send, Sparkles } from 'lucide-react'
import { Button } from '../ui'
import { apiPost } from '../../lib/api'
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition'
import { twinTemplates, twinFocusOptions, splitTwinFocusRules, replaceTwinFocusRules, summarizeTwinFocus } from './twinTemplates'
import type { TwinBuildProposal, TwinBuildUpload, TwinDraft } from './types'
import { stageTwinAsset } from './twinDraftState'
import type { TwinBuilderDraft } from './twinDraftRecovery'
import { createTwinConversationGate, inputAfterTwinReply } from './twinConversationState'

type BuildMessage = { id: string; role: string; content: string; metadata?: { twinBuildProposal?: TwinBuildProposal } }
export function TwinBuilder({ draft, onDraft, onUpload, draftId, upload, preview = false, onBusyChange, onUploadAdopted, onPendingChange, initialState, onDraftState }: { draft: TwinDraft; draftId: string; onDraft: (draft: TwinDraft) => void; onUpload: (file: File) => Promise<string | null>; upload?: TwinBuildUpload; preview?: boolean; onBusyChange?: (busy: boolean) => void; onUploadAdopted?: () => void; onPendingChange?: (editor: string, pending: boolean) => void; initialState?: TwinBuilderDraft; onDraftState?: (state: TwinBuilderDraft) => void }) {
  const { focusIds, customRules } = splitTwinFocusRules(draft.rules)
  const draftRef = useRef(draft); draftRef.current = draft
  const uploadRef = useRef(upload); uploadRef.current = upload
  const [message, setMessage] = useState(initialState?.message || ''); const messageRef = useRef(message); messageRef.current = message
  const [messages, setMessages] = useState<BuildMessage[]>([]); const [proposal, setProposal] = useState<TwinBuildProposal | null>(initialState?.proposal || null)
  const proposalRef = useRef(proposal); proposalRef.current = proposal
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const requests = useRef(createTwinConversationGate()).current
  const [loadingHistory, setLoadingHistory] = useState(!preview)
  const [interim, setInterim] = useState('')
  const [proposalAsset, setProposalAsset] = useState<TwinBuildUpload | null>(initialState?.proposalAsset || null)
  useEffect(() => { onDraftState?.({ message: [message, interim].filter(Boolean).join('\n'), proposal, proposalAsset }) }, [message, interim, proposal, proposalAsset, onDraftState])
  const pendingEdit = Boolean(message.trim() || interim.trim() || proposal || busy || upload?.status === 'parsing')
  useEffect(() => { onPendingChange?.('builder', pendingEdit) }, [pendingEdit, onPendingChange])
  useEffect(() => () => onPendingChange?.('builder', false), [onPendingChange])
  useEffect(() => { onPendingChange?.('builderTask', Boolean(busy) || upload?.status === 'parsing'); return () => onPendingChange?.('builderTask', false) }, [busy, upload?.status, onPendingChange])
  useEffect(() => { onBusyChange?.(Boolean(busy) || upload?.status === 'parsing'); return () => onBusyChange?.(false) }, [busy, upload?.status, onBusyChange])
  useEffect(() => {
    if (upload?.status !== 'ready' || !upload.traits || draftRef.current.assetAdoptions?.some(item => item.assetId === upload.assetId)) return
    const current = draftRef.current
    const rules = [current.rules, upload.traits].filter(Boolean).join('\n\n')
    setProposal({ reply: `已解析 ${upload.name}`, rules, cases: current.cases, description: current.descriptionMode === 'manual' ? current.description || '' : summarizeTwinFocus(rules), followUps: [] })
    setProposalAsset(upload)
    setNotice('解析建议已准备好，原有偏好已保留；请检查后采纳。')
  }, [upload])
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; requests.invalidate() } }, [requests])
  const speech = useSpeechRecognition({ continuous: true, onInterim: setInterim, onFinal: text => { messageRef.current = `${messageRef.current}${messageRef.current ? '\n' : ''}${text}`; setMessage(messageRef.current) } })
  useEffect(() => {
    if (preview) return
    const controller = new AbortController()
    const ticket = requests.beginLoad(); setLoadingHistory(true)
    void apiPost<{messages:BuildMessage[]}>('/due-diligence/twins/builder', { twinId: draft.id || undefined, draftId, draft }, { signal: controller.signal }).then(data => { if (controller.signal.aborted || !requests.isCurrent(ticket)) return; setMessages(data.messages); const latest = data.messages.at(-1)?.metadata?.twinBuildProposal; const current = draftRef.current; if (!proposalRef.current && uploadRef.current?.status !== 'ready' && latest && (latest.rules !== current.rules || latest.cases !== current.cases || latest.description !== current.description)) setProposal(latest) }).catch(err => { if (!controller.signal.aborted && requests.isCurrent(ticket)) setError(`构建对话加载失败：${(err as Error).message}`) }).finally(() => { if (!controller.signal.aborted && requests.isCurrent(ticket)) setLoadingHistory(false) })
    return () => { controller.abort(); requests.invalidate() }
  }, [draft.id, draftId]) // Draft changes must not reset an ongoing setup conversation.
  const send = async (chosenText?: string) => {
    if (preview) { setError('演示模式可试用模板；模型对话请登录完整本地平台。'); return }
    if (busy || loadingHistory || upload?.status === 'parsing') return
    const ticket = requests.beginWrite(); if (ticket === null) return
    setBusy('chat'); setError(''); setNotice('')
    try {
      await speech.pause()
      if (!alive.current || !requests.isCurrent(ticket)) return
      const text = chosenText ?? messageRef.current
      if (!text.trim()) return
      const currentDraft = draftRef.current, currentProposal = proposalRef.current
      const data = await apiPost<{messages:BuildMessage[];proposal:TwinBuildProposal}>('/due-diligence/twins/builder', { twinId: currentDraft.id || undefined, draftId, draft: currentProposal ? { ...currentDraft, rules: currentProposal.rules, cases: currentProposal.cases } : currentDraft, message: text })
      if (!alive.current || !requests.isCurrent(ticket)) return
      setMessages(data.messages); setProposal(data.proposal)
      messageRef.current = inputAfterTwinReply(messageRef.current, chosenText === undefined ? text : null)
      setMessage(messageRef.current)
    } catch (err) { if (alive.current && requests.isCurrent(ticket)) setError((err as Error).message) }
    finally { if (requests.finishWrite(ticket) && alive.current) setBusy('') }
  }
  const applyTemplate = (ids: string[], avatar?: string) => {
    const rules = replaceTwinFocusRules(draft.rules, ids)
    onDraft({ ...draft, rules, ...(avatar ? { avatarPreset: avatar, avatarDataUrl: null } : {}), ...(draft.descriptionMode !== 'manual' ? { description: summarizeTwinFocus(rules), descriptionMode: 'auto' } : {}) })
    setNotice(customRules.trim() ? '已更新模板选项，手写偏好保持不变；请检查是否有冲突后保存。' : '已填入偏好草稿，可继续对话完善或直接保存。')
  }
  return <div className="space-y-4">
    <div><span className="label">选择起点</span><div className="grid gap-2 sm:grid-cols-3">{twinTemplates.map(template => <button type="button" key={template.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition-colors hover:border-brand-400 focus-visible:ring-2 focus-visible:ring-brand-500" disabled={Boolean(busy)} onClick={() => applyTemplate([...template.focusIds], template.avatar)}><strong className="text-sm">{template.name}</strong><p className="mt-1 text-xs leading-relaxed text-slate-500">{template.description}</p></button>)}</div><div className="mt-3 flex flex-wrap gap-2">{twinFocusOptions.map(option => <button type="button" key={option.id} aria-pressed={focusIds.includes(option.id)} className={`rounded-full border px-3 py-2 text-xs ${focusIds.includes(option.id) ? 'border-brand-400 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600'}`} onClick={() => applyTemplate(focusIds.includes(option.id) ? focusIds.filter(id => id !== option.id) : [...focusIds, option.id])}>{option.label}</button>)}</div></div>
    <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand-600" /><h3 className="text-sm font-semibold">对话完善分身</h3></div>
      <div className="max-h-60 space-y-3 overflow-auto" aria-live="polite">{!messages.length && <p className="text-sm leading-relaxed text-slate-500">告诉我你最关注什么、习惯怎样核验。我会追问关键细节，整理成可确认的偏好建议。</p>}{messages.map(item => <div key={item.id} className={`rounded-lg p-3 text-sm whitespace-pre-wrap ${item.role === 'user' ? 'ml-6 bg-brand-50' : 'mr-6 bg-slate-50'}`}>{item.content}</div>)}</div>
      {loadingHistory && <p role="status" className="mt-2 text-sm text-slate-500">正在恢复构建对话…</p>}
      {proposal?.followUps.map((item, index) => <div key={`${index}:${item.question}`} className="mt-3"><p className="text-sm font-medium">{item.question}</p><div className="mt-2 flex flex-wrap gap-2">{item.options.map(option => <Button key={option} size="sm" variant="secondary" disabled={Boolean(busy) || loadingHistory} onClick={() => void send(`${item.question}\n我的选择：${option}`)}>{option}</Button>)}</div></div>)}
      <label className="mt-3 block"><span className="label">补充你的需求</span><textarea className="textarea min-h-24" value={message} onChange={event => { messageRef.current = event.target.value; setMessage(event.target.value) }} placeholder="例如：我更关注销售激励是否促进实际回款，请帮我进一步细化…" /></label>
      <div className="mt-2 flex flex-wrap items-center gap-2"><Button variant="secondary" disabled={Boolean(busy)} onClick={speech.state === 'listening' ? speech.pause : speech.start}><Mic className="h-4 w-4" />{speech.state === 'listening' ? '暂停语音' : '语音补充'}</Button><Button disabled={Boolean(busy) || loadingHistory || upload?.status === 'parsing' || !(message.trim() || interim.trim())} onClick={() => void send()}><Send className="h-4 w-4" />{busy === 'chat' ? '整理中…' : '发送'}</Button><label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border px-3 py-2 text-sm"><FileUp className="h-4 w-4" />上传材料解析<input type="file" className="hidden" accept=".txt,.md,.pdf,.doc,.docx,.ppt,.pptx,.mp3,.wav,.m4a,.webm" disabled={Boolean(busy) || upload?.status === 'parsing'} onChange={async event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (!file) return; setError(''); try { await onUpload(file) } catch (err) { if (alive.current) setError((err as Error).message) } }} /></label></div>
      {upload && <p role={upload.status === 'error' ? 'alert' : 'status'} className="mt-2 text-sm text-slate-600">{upload.name} · {upload.status === 'parsing' ? '正在解析材料…' : upload.status === 'ready' ? '已解析，请确认建议' : upload.status === 'adopted' ? '建议已采纳到草稿' : upload.error}</p>}
      {interim && <p className="mt-2 text-sm text-slate-500">{interim}</p>}{speech.error && <p role="alert" className="mt-2 text-sm text-amber-700">{speech.error}</p>}
    </div>
    {proposal && <fieldset disabled={Boolean(busy) || upload?.status === 'parsing'} className="space-y-3 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
      <h3 className="text-sm font-semibold">可编辑的分身建议</h3>
      <label className="block"><span className="label">备注说明</span><input className="input" value={proposal.description} onChange={event => setProposal({ ...proposal, description: event.target.value })} /></label>
      <label className="block"><span className="label">判断偏好建议</span><textarea className="textarea min-h-40" value={proposal.rules} onChange={event => setProposal({ ...proposal, rules: event.target.value })} /></label>
      <details><summary className="cursor-pointer text-sm text-slate-600">查看案例与适用边界建议（可选）</summary><label className="mt-2 block"><span className="label">案例与适用边界建议</span><textarea className="textarea min-h-24" value={proposal.cases} onChange={event => setProposal({ ...proposal, cases: event.target.value })} /></label></details>
      <div className="flex flex-wrap gap-2"><Button onClick={() => { const next: TwinDraft = { ...draft, rules: proposal.rules, cases: proposal.cases, description: proposal.description, descriptionMode: 'manual' }; onDraft(proposalAsset?.assetId && proposalAsset.traits ? stageTwinAsset(draft, { assetId: proposalAsset.assetId, traits: proposal.rules, expectedSuggestion: proposalAsset.traits }, next) : next); if (proposalAsset?.assetId === upload?.assetId && proposalAsset) onUploadAdopted?.(); setNotice('已采纳到草稿，保存后生效。'); setProposal(null); setProposalAsset(null) }}>采纳到偏好草稿</Button><Button variant="secondary" onClick={() => { if (window.confirm('放弃这份尚未采纳的建议？原始材料和对话仍会保留。')) { setProposal(null); setProposalAsset(null) } }}>放弃建议</Button></div>
    </fieldset>}
    {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}{error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
  </div>
}
