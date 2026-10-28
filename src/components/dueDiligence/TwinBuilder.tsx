import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FileUp, Mic, Pencil, Send, Sparkles, Square, Trash2 } from 'lucide-react'
import { Button, Card, Modal } from '../ui'
import { apiDelete, apiPost } from '../../lib/api'
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition'
import { splitTwinFocusRules, replaceTwinFocusRules } from './twinTemplates'
import { TwinStartingPoints } from './TwinStartingPoints'
import { TwinPreferenceEditor } from './TwinPreferenceEditor'
import type { TwinBuildProposal, TwinBuildUpload, TwinDraft } from './types'
import { stageTwinAsset } from './twinDraftState'
import type { TwinBuilderDraft } from './twinDraftRecovery'
import { createTwinConversationGate, inputAfterTwinReply, isTwinProposalCurrent } from './twinConversationState'
import { twinBuilderTurns } from '../../../server/src/contracts/digitalTwinBuilderConversation'
import { TwinAuxiliaryCapabilities } from './TwinAuxiliaryCapabilities'
import type { LibrarySelection, LibrarySnapshot } from '../../../server/src/contracts/dueDiligenceLibrary'
import { twinInitialDraftMessage, type TwinCapabilityRequest } from '../../../server/src/contracts/digitalTwinCapabilityRecommendations'

type BuildMessage = { id: string; role: string; content: string; metadata?: Record<string, unknown> & { twinBuildProposal?: TwinBuildProposal; twinBuildProposalBase?: string; twinBuildProposalInvalidated?: boolean } }
type BuildResult = { messages: BuildMessage[]; revision: string | null; proposal?: TwinBuildProposal; proposalBase?: string; proposalRevision?: string; librarySnapshot?: LibrarySnapshot[]; warnings?: string[] }
type Flight = { id: string; controller: AbortController; stopping: boolean; ticket: number; text: string; chosen: boolean; initial: boolean; submittedInput: string | null; edit?: NonNullable<TwinBuilderDraft['editingMessage']> }
export function TwinBuilder({ draft, onDraft, onUpload, draftId, upload, preview = false, onBusyChange, onUploadAdopted, onPendingChange, initialState, onDraftState, renderOverview, renderSave, onLibrarySaved, onLibraryLearned, active = true }: { draft: TwinDraft; draftId: string; onDraft: (draft: TwinDraft) => void; onUpload: (file: File) => Promise<string | null>; upload?: TwinBuildUpload; preview?: boolean; onBusyChange?: (busy: boolean) => void; onUploadAdopted?: () => void; onPendingChange?: (editor: string, pending: boolean) => void; initialState?: TwinBuilderDraft; onDraftState?: (state: TwinBuilderDraft) => void; renderOverview?: (startingPoints: ReactNode) => ReactNode; renderSave?: (blocked: boolean) => ReactNode; active?: boolean; onLibrarySaved?: (twinId: string, version: number) => void; onLibraryLearned?: () => Promise<void> }) {
  const { customRules, focusIds } = splitTwinFocusRules(draft.rules)
  const draftRef = useRef(draft); draftRef.current = draft
  const [message, setMessage] = useState(initialState?.message || ''); const messageRef = useRef(message); messageRef.current = message
  const [messages, setMessages] = useState<BuildMessage[]>([]); const [proposal, setProposal] = useState<TwinBuildProposal | null>(initialState?.proposal || null)
  const [proposalOutdated, setProposalOutdated] = useState(Boolean(initialState?.proposalOutdated))
  const [revision, setRevision] = useState<string | null>(null)
  const [proposalBase, setProposalBase] = useState(initialState?.proposalBase)
  const [proposalRevision, setProposalRevision] = useState<string | null | undefined>(initialState?.proposalRevision)
  const [deleteTurnId, setDeleteTurnId] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [historyError, setHistoryError] = useState(false)
  const [reload, setReload] = useState(0)
  const [editingMessage, setEditingMessage] = useState<TwinBuilderDraft['editingMessage']>(initialState?.editingMessage)
  const proposalRef = useRef(proposal); proposalRef.current = proposal
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const [librarySelection, setLibrarySelection] = useState<LibrarySelection | undefined>(initialState?.librarySelection)
  const [libraryReady, setLibraryReady] = useState(preview), [libraryBusy, setLibraryBusy] = useState(false)
  const [librarySnapshot, setLibrarySnapshot] = useState<LibrarySnapshot[]>([])
  const [recommendationRequest, setRecommendationRequest] = useState<TwinCapabilityRequest>()
  const flight = useRef<Flight | null>(null)
  const scope = () => ({ twinId: draftRef.current.id || undefined, draftId })
  const requests = useRef(createTwinConversationGate()).current
  const [loadingHistory, setLoadingHistory] = useState(!preview)
  const [interim, setInterim] = useState('')
  const [proposalAsset, setProposalAsset] = useState<TwinBuildUpload | null>(initialState?.proposalAsset || null)
  const preferencesRef = useRef<HTMLDivElement>(null)
  const conversationRef = useRef<HTMLElement>(null)
  const outdated = proposalOutdated || Boolean(proposal && !loadingHistory && !isTwinProposalCurrent(proposalBase, draft.rules, proposalRevision, revision))
  useEffect(() => { if (outdated) setProposalOutdated(true) }, [outdated])
  useEffect(() => { onDraftState?.({ message: [message, interim].filter(Boolean).join('\n'), proposal, proposalAsset, proposalBase, proposalRevision, librarySelection, ...(outdated ? { proposalOutdated: true } : {}), ...(editingMessage ? { editingMessage } : {}) }) }, [message, interim, proposal, proposalAsset, proposalBase, proposalRevision, librarySelection, outdated, editingMessage, onDraftState])
  const pendingEdit = Boolean(message.trim() || interim.trim() || editingMessage || proposal || busy || upload?.status === 'parsing')
  useEffect(() => { onPendingChange?.('builder', pendingEdit) }, [pendingEdit, onPendingChange])
  useEffect(() => () => onPendingChange?.('builder', false), [onPendingChange])
  useEffect(() => { onPendingChange?.('builderTask', Boolean(busy) || upload?.status === 'parsing'); return () => onPendingChange?.('builderTask', false) }, [busy, upload?.status, onPendingChange])
  useEffect(() => { onBusyChange?.(Boolean(busy) || libraryBusy || upload?.status === 'parsing'); return () => onBusyChange?.(false) }, [busy, libraryBusy, upload?.status, onBusyChange])
  useEffect(() => {
    if (upload?.status !== 'ready' || !upload.traits || draftRef.current.assetAdoptions?.some(item => item.assetId === upload.assetId)) return
    const current = draftRef.current
    const rules = [current.rules, upload.traits].filter(Boolean).join('\n\n')
    setProposal({ reply: `已解析 ${upload.name}`, rules, cases: current.cases, description: current.description || '', followUps: [] })
    setProposalBase(current.rules); setProposalRevision(revision); setProposalAsset(upload); setProposalOutdated(false)
    setNotice('解析建议已准备好，原有偏好已保留；请检查后采纳。')
  }, [upload])
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; requests.invalidate(); const current = flight.current; if (current) { void apiPost('/due-diligence/twins/builder/stop', { ...scope(), requestId: current.id }).catch(() => {}); current.controller.abort() } } }, [requests])
  const speech = useSpeechRecognition({ continuous: true, onInterim: setInterim, onFinal: text => { messageRef.current = `${messageRef.current}${messageRef.current ? '\n' : ''}${text}`; setMessage(messageRef.current) } })
  useEffect(() => { if (!active) void speech.pause() }, [active])
  useEffect(() => {
    if (preview) return
    const controller = new AbortController()
    const ticket = requests.beginLoad(); setLoadingHistory(true); setHistoryError(false)
    // History never creates a pending edit. Resume only explicit review or recovered unsaved content.
    void apiPost<BuildResult>('/due-diligence/twins/builder', { ...scope(), draft: draftRef.current }, { signal: controller.signal }).then(data => { if (controller.signal.aborted || !requests.isCurrent(ticket)) return; setMessages(data.messages); setRevision(data.revision) }).catch(err => { if (!controller.signal.aborted && requests.isCurrent(ticket)) { setError(`构建对话加载失败：${(err as Error).message}`); setHistoryError(true) } }).finally(() => { if (!controller.signal.aborted && requests.isCurrent(ticket)) setLoadingHistory(false) })
    return () => { controller.abort(); requests.invalidate() }
  }, [draft.id, draftId, reload]) // Draft changes must not reset an ongoing setup conversation.
  const acceptReply = (data: BuildResult, current: Flight) => {
    setError(''); setStopping(false)
    setMessages(data.messages); setRevision(data.revision)
    if (data.proposal) { setProposal(data.proposal); setProposalBase(data.proposalBase); setProposalRevision(data.proposalRevision); setProposalOutdated(false); setProposalAsset(null) }
    setLibrarySnapshot(data.librarySnapshot || [])
    setNotice([current.initial ? '分身初稿已生成，请核对偏好建议，按需编辑、采纳后保存。' : current.edit ? '消息已更新，请核对新建议后采纳。' : '', ...(data.warnings || [])].filter(Boolean).join('；'))
    if (current.edit) setEditingMessage(undefined)
    messageRef.current = inputAfterTwinReply(messageRef.current, current.submittedInput)
    setMessage(messageRef.current)
  }
  const send = async (chosenText?: string, edit?: NonNullable<TwinBuilderDraft['editingMessage']>, initial = false) => {
    if (preview) { setError('演示模式可试用模板；模型对话请登录完整本地平台。'); return }
    if (busy || !libraryReady || loadingHistory || historyError || flight.current || upload?.status === 'parsing') return
    const ticket = requests.beginWrite(); if (ticket === null) return
    setBusy('chat'); setError(''); setNotice('')
    const current: Flight = { id: crypto.randomUUID(), controller: new AbortController(), stopping: false, ticket, text: '', chosen: chosenText !== undefined, initial, submittedInput: null, edit }
    flight.current = current
    try {
      await speech.pause()
      if (!alive.current || !requests.isCurrent(ticket) || current.stopping) return
      const text = initial ? twinInitialDraftMessage(draftRef.current.rules, messageRef.current) : edit?.content ?? chosenText ?? messageRef.current
      current.text = text
      current.submittedInput = !edit && (initial || chosenText === undefined) ? messageRef.current : null
      if (!text.trim()) return
      const currentDraft = draftRef.current, currentProposal = proposalRef.current
      const data = await apiPost<BuildResult>('/due-diligence/twins/builder', { ...scope(), draft: currentProposal && !initial && !edit && !outdated ? { ...currentDraft, rules: currentProposal.rules } : currentDraft, preferenceBase: currentDraft.rules, message: text, requestId: current.id, expectedRevision: revision, ...(edit ? { edit: { messageId: edit.messageId, expectedContent: edit.expectedContent, expectedLastMessageId: edit.expectedLastMessageId } } : {}), librarySelection }, { signal: AbortSignal.any([current.controller.signal, AbortSignal.timeout(240000)]) })
      if (alive.current && requests.isCurrent(ticket) && !current.stopping && !current.controller.signal.aborted) acceptReply(data, current)
    } catch (err) { if (alive.current && requests.isCurrent(ticket) && !current.stopping) {
      const cause = err as Error & { code?: string; status?: number }
      setError(['TWIN_BUILDER_UNAVAILABLE', 'DUE_DILIGENCE_MODEL_ROUTE_UNAVAILABLE'].includes(cause.code || '')
        ? '分身构建模型暂不可用，可先手工调整偏好后保存；输入和辅助能力选择已保留。'
        : current.initial ? `初稿未生成，输入和辅助能力选择已保留。${cause.message}` : cause.message)
      if (cause.status === 409) setHistoryError(true)
    } }
    finally { if (!current.stopping) { if (flight.current === current) flight.current = null; if (requests.finishWrite(ticket) && alive.current) setBusy('') } }
  }
  const stop = async () => {
    const current = flight.current
    if (!current || current.stopping) return
    current.stopping = true; setStopping(true); setError('')
    try {
      const data = await apiPost<BuildResult & {status: string}>('/due-diligence/twins/builder/stop', { ...scope(), requestId: current.id }, { signal: AbortSignal.timeout(20000) })
      if (!alive.current || flight.current !== current) return
      current.controller.abort()
      if (data.status === 'completed') { acceptReply(data, current); setNotice('本轮已完成，结果已恢复，请核对后采纳。') }
      else {
        if (current.chosen && current.text && !messageRef.current.includes(current.text)) { messageRef.current = [messageRef.current, current.text].filter(Boolean).join('\n'); setMessage(messageRef.current) }
        setMessages(data.messages); setRevision(data.revision); setNotice('已停止整理，输入、当前偏好和原有建议已保留。')
      }
      flight.current = null; requests.finishWrite(current.ticket); setBusy(''); setStopping(false)
    } catch (err) {
      if (!alive.current || flight.current !== current) return
      current.stopping = false; setStopping(false); setError(`停止结果尚未确认：${(err as Error).message}。请再次点击“停止整理”。`)
    }
  }
  const deleteTurn = async () => {
    if (!deleteTurnId || busy) return
    const ticket = requests.beginWrite(); if (ticket === null) return
    setBusy('delete'); setError('')
    try {
      const data = await apiDelete<BuildResult>(`/due-diligence/twins/builder/turns/${deleteTurnId}`, { ...scope(), expectedRevision: revision })
      if (!alive.current || !requests.isCurrent(ticket)) return
      setMessages(data.messages); setRevision(data.revision); setDeleteTurnId(null)
      if (proposal) setProposalOutdated(true)
      setNotice('本轮问答已删除。已采纳偏好和已保存分身保持不变。')
    } catch (err) { if (alive.current && requests.isCurrent(ticket)) { setError((err as Error).message); if ((err as {status?:number}).status === 409) setHistoryError(true) } }
    finally { if (requests.finishWrite(ticket) && alive.current) setBusy('') }
  }
  const applyTemplate = (ids: string[]) => {
    const rules = replaceTwinFocusRules(draft.rules, ids)
    if (proposal) setProposalOutdated(true)
    onDraft({ ...draft, rules })
    setLibraryReady(false); setRecommendationRequest({ id: crypto.randomUUID(), focusIds: ids })
    setNotice(customRules.trim() ? '已更新起点，手写偏好保持不变。核对推荐能力后可生成分身初稿。' : '已填入起点偏好；核对辅助能力后，点击“生成分身初稿”继续。')
  }
  const startingPoints = <TwinStartingPoints rules={draft.rules} disabled={Boolean(busy) || Boolean(editingMessage) || upload?.status === 'parsing'} onChange={applyTemplate} />
  const showPreferences = () => { preferencesRef.current?.scrollIntoView({ block: 'center' }); preferencesRef.current?.querySelector<HTMLElement>('textarea, [role="region"]')?.focus({ preventScroll: true }) }
  const preferences = <div ref={preferencesRef} className="twin-builder-preferences"><TwinPreferenceEditor draft={draft} proposal={proposal} outdated={outdated} busy={Boolean(busy) || Boolean(editingMessage) || loadingHistory || upload?.status === 'parsing'} active={active} onDraft={onDraft} onProposal={setProposal} onAdopt={review => {
    const latest = proposalRef.current
    if (!latest) return
    if (outdated && (!review || review.currentRules !== draftRef.current.rules || review.suggestionRules !== latest.rules)) return
    const current = draftRef.current
    const next: TwinDraft = { ...current, rules: latest.rules }
    onDraft(proposalAsset?.assetId && proposalAsset.traits ? stageTwinAsset(current, { assetId: proposalAsset.assetId, traits: latest.rules, expectedSuggestion: proposalAsset.traits }, next) : next)
    if (proposalAsset?.assetId === upload?.assetId && proposalAsset) onUploadAdopted?.()
    setNotice('建议已采纳，请点击“保存分身”使其生效。'); setProposal(null); setProposalAsset(null); setProposalOutdated(false)
  }} onDiscard={() => { setProposal(null); setProposalAsset(null); setProposalOutdated(false); setNotice('已放弃这份建议，当前偏好保持不变。') }} />{proposal && outdated && (busy === 'chat' ? <Button size="sm" className="mt-3" variant="secondary" disabled={stopping} onClick={() => void stop()}><Square className="h-3.5 w-3.5" aria-hidden="true" />{stopping ? '正在停止…' : '停止整理'}</Button> : <Button size="sm" className="mt-3" variant="secondary" disabled={Boolean(busy) || !libraryReady || loadingHistory || historyError || Boolean(editingMessage)} onClick={() => { conversationRef.current?.scrollIntoView({ block: 'nearest' }); void send('请根据当前偏好与仍保留的问答重新整理建议，不使用已删除的问答内容。') }}>重新整理建议</Button>)}</div>
  const turns = twinBuilderTurns(messages), deletingTurn = turns.find(turn => turn.id === deleteTurnId)
  return <div className="space-y-4">
    {renderOverview ? renderOverview(startingPoints) : startingPoints}
    <Card className="twin-panel twin-builder-panel">
    <header className="twin-panel-heading twin-dialogue-heading"><div><div className="flex items-center gap-2"><span className="twin-section-icon"><Sparkles className="h-4 w-4" aria-hidden="true" /></span><h2>对话完善分身</h2></div><p>补充需求并核对偏好建议，采纳后保存</p></div>{busy === 'chat' && flight.current?.initial ? <Button variant="secondary" disabled={stopping} onClick={() => void stop()}><Square className="h-4 w-4" aria-hidden="true" />{stopping ? '正在停止…' : '停止生成'}</Button> : <Button variant="secondary" disabled={Boolean(busy) || !libraryReady || loadingHistory || historyError || Boolean(editingMessage) || upload?.status === 'parsing' || !focusIds.length} title={!focusIds.length ? '先选择专业起点，也可直接发送需求完善分身' : undefined} onClick={() => void send(undefined, undefined, true)}><Sparkles className="h-4 w-4" aria-hidden="true" />生成分身初稿</Button>}</header>
    <TwinAuxiliaryCapabilities twinId={draft.id || undefined} expectedVersion={draft.expectedVersion} value={librarySelection} recommendationRequest={recommendationRequest} preview={preview} disabled={Boolean(busy) || Boolean(editingMessage) || upload?.status === 'parsing'} onChange={selection => { setLibrarySelection(selection); if (proposal) setProposalOutdated(true) }} onSaved={onLibrarySaved} onLearned={onLibraryLearned} onReadyChange={setLibraryReady} onBusyChange={setLibraryBusy} onPendingChange={onPendingChange} />
    <div className="twin-builder-columns">
    <section ref={conversationRef} className="twin-builder-conversation min-w-0" aria-label="分身构建对话" aria-busy={Boolean(busy)}>
    {librarySnapshot.length > 0 && <p className="text-xs text-brand-700">上轮实际参考：{librarySnapshot.map(item => `${item.name} v${item.version}`).join('、')}；请核对建议后采纳。</p>}
    <div className="space-y-4">
    <div className="min-w-0">
      <div className="twin-builder-messages max-h-96 space-y-4 overflow-auto" aria-live="polite">{!messages.length && <p className="text-sm leading-relaxed text-slate-500">告诉我你最关注什么、习惯怎样核验，我会整理成偏好建议。</p>}{turns.map(turn => <div key={turn.id} className="twin-conversation-turn" data-turn-id={turn.id}>{turn.messages.map(item => <div key={item.id} className={`rounded-lg p-3 text-sm ${item.role === 'user' ? 'twin-message-user ml-3' : 'twin-message-assistant mr-3'}`}>
        {editingMessage?.messageId === item.id ? <div className="space-y-2">
          <label className="block"><span className="label">编辑已发送的消息</span><textarea autoFocus className="textarea min-h-28" maxLength={8000} disabled={Boolean(busy)} value={editingMessage.content} onChange={event => setEditingMessage({ ...editingMessage, content: event.target.value })} /></label>
          {messages.slice(messages.indexOf(item) + 1).some(turn => turn.role === 'user') && <p className="text-xs text-slate-600">保存后将从这条消息重新开始整理，替换其后的对话。</p>}
          <div className="flex flex-wrap gap-2"><Button size="sm" disabled={Boolean(busy) || !libraryReady || loadingHistory || !editingMessage.content.trim() || editingMessage.content.trim() === editingMessage.expectedContent} onClick={() => void send(undefined, editingMessage)}>{busy === 'chat' ? '重新整理中…' : '保存并重新整理'}</Button><Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => setEditingMessage(undefined)}>取消编辑</Button></div>
        </div> : <><span className="mb-1 block text-xs font-medium text-slate-500">{item.role === 'user' ? '我的补充' : '分身构建助手'}</span><p className="whitespace-pre-wrap">{item.content}</p>{item.metadata?.twinBuildProposalInvalidated ? <p className="mt-2 text-xs text-slate-500">引用的问答已删除，此建议需重新整理。</p> : item.metadata?.twinBuildProposal && <Button size="sm" variant="secondary" className="mt-2" disabled={Boolean(proposal) || Boolean(busy) || loadingHistory || historyError || Boolean(editingMessage) || upload?.status === 'parsing'} onClick={() => { setProposal(item.metadata!.twinBuildProposal!); setProposalBase(item.metadata!.twinBuildProposalBase); setProposalRevision(item.id); setProposalAsset(null); setProposalOutdated(false); setNotice('已打开历史建议，请核对是否仍适用；尚未更改当前偏好。'); showPreferences() }}>查看这次建议</Button>}</>}
      </div>)}<div className="twin-turn-actions">{turn.messages[0].role === 'user' && <Button size="sm" variant="secondary" disabled={Boolean(busy) || loadingHistory || historyError || Boolean(editingMessage) || upload?.status === 'parsing'} onClick={() => { const item = turn.messages[0]; void speech.pause(); setEditingMessage({ messageId: item.id, content: item.content, expectedContent: item.content, expectedLastMessageId: messages.at(-1)!.id }); setError(''); setNotice('') }}><Pencil className="h-3.5 w-3.5" aria-hidden="true" />编辑</Button>}<Button size="sm" variant="secondary" disabled={Boolean(busy) || loadingHistory || historyError || Boolean(editingMessage) || upload?.status === 'parsing'} onClick={() => { setDeleteTurnId(turn.id); setError('') }}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />删除本轮</Button></div></div>)}</div>
      {loadingHistory && <p role="status" className="mt-2 text-sm text-slate-500">正在恢复构建对话…</p>}
      {historyError && <Button size="sm" variant="secondary" className="mt-2" disabled={Boolean(busy) || loadingHistory} onClick={() => { setError(''); setReload(value => value + 1) }}>重新加载对话</Button>}
      {!outdated && proposal?.followUps.map((item, index) => <div key={`${index}:${item.question}`} className="mt-3"><p className="text-sm font-medium">{item.question}</p><div className="mt-2 flex flex-wrap gap-2">{item.options.map(option => <Button key={option} size="sm" variant="secondary" disabled={Boolean(busy) || !libraryReady || loadingHistory || historyError || Boolean(editingMessage)} onClick={() => void send(`${item.question}\n我的选择：${option}`)}>{option}</Button>)}</div></div>)}
      <label className="mt-3 block"><span className="label">补充你的需求</span><textarea className="textarea min-h-24" maxLength={8000} disabled={Boolean(editingMessage)} value={message} onChange={event => { messageRef.current = event.target.value; setMessage(event.target.value) }} placeholder="例如：我更关注销售激励是否促进实际回款，请帮我进一步细化…" /></label>
      <div className="mt-2 flex flex-wrap items-center gap-2">{busy === 'chat' ? <Button variant="secondary" disabled={stopping} onClick={() => void stop()}><Square className="h-4 w-4" aria-hidden="true" />{stopping ? '正在停止…' : '停止整理'}</Button> : <Button disabled={Boolean(busy) || !libraryReady || Boolean(editingMessage) || loadingHistory || historyError || upload?.status === 'parsing' || !(message.trim() || interim.trim())} onClick={() => void send()}><Send className="h-4 w-4" />发送</Button>}<Button variant="secondary" disabled={Boolean(busy) || Boolean(editingMessage)} onClick={speech.state === 'listening' ? speech.pause : speech.start}><Mic className="h-4 w-4" />{speech.state === 'listening' ? '暂停语音' : '语音补充'}</Button><label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border px-3 py-2 text-sm"><FileUp className="h-4 w-4" />上传材料解析<input type="file" className="hidden" accept=".txt,.md,.pdf,.doc,.docx,.ppt,.pptx,.mp3,.wav,.m4a,.webm" disabled={Boolean(busy) || Boolean(editingMessage) || upload?.status === 'parsing'} onChange={async event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (!file) return; setError(''); try { await onUpload(file) } catch (err) { if (alive.current) setError((err as Error).message) } }} /></label></div>
      {busy === 'chat' && <p role="status" className="mt-2 text-sm text-slate-500">{stopping ? '正在确认停止结果…' : '正在整理，可随时停止。'}</p>}
      {upload && <p role={upload.status === 'error' ? 'alert' : 'status'} className="mt-2 text-sm text-slate-600">{upload.name} · {upload.status === 'parsing' ? '正在解析材料…' : upload.status === 'ready' ? '已解析，请确认建议' : upload.status === 'adopted' ? '建议已采纳到草稿' : upload.error}</p>}
      {interim && <p className="mt-2 text-sm text-slate-500">{interim}</p>}{speech.error && <p role="alert" className="mt-2 text-sm text-amber-700">{speech.error}</p>}
    </div>
    </div>
    </section>{preferences}</div>
    {notice && <p role="status" className="mt-3 text-sm text-slate-600">{notice}</p>}{error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
    <footer className="twin-builder-save"><div className="flex flex-wrap gap-2">{proposal && <span className="twin-status-chip">{outdated ? '建议需核对' : '有未采纳建议'}</span>}{(message.trim() || interim.trim()) && <span className="twin-status-chip">有未发送内容</span>}{editingMessage && <span className="twin-status-chip">有消息正在编辑</span>}</div>{renderSave?.(Boolean(busy) || libraryBusy || upload?.status === 'parsing')}</footer>
    </Card>
    <Modal open={Boolean(deletingTurn)} title="删除这一轮问答？" onClose={() => { if (!busy) setDeleteTurnId(null) }} footer={<><Button variant="secondary" disabled={Boolean(busy)} onClick={() => setDeleteTurnId(null)}>取消</Button><Button variant="danger" disabled={Boolean(busy)} onClick={() => void deleteTurn()}>{busy === 'delete' ? '正在删除…' : '确认删除本轮'}</Button></>}><p className="text-sm text-slate-600">将删除以下提问及对应回复，保留其他轮次。已采纳的偏好、已保存分身和 Skill 不会回退；依赖这轮问答的未采纳建议需要重新整理。</p><div className="mt-4 max-h-72 space-y-3 overflow-auto">{deletingTurn?.messages.map(item => <div key={item.id} className="rounded-lg bg-slate-50 p-3"><strong className="text-sm">{item.role === 'user' ? '提问' : '回复'}</strong><p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.content}</p></div>)}</div>{error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}</Modal>
  </div>
}
