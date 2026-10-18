import React, { useEffect, useRef, useState } from 'react'
import { MessageSquare, Send, Sparkles, Square, Trash2 } from 'lucide-react'
import { apiPost } from '../lib/api'
import type { AgentBlueprint, AgentBlueprintCatalog } from '../../server/src/contracts/agentBlueprintContract'
import type { AgentDesignerReply } from '../../server/src/contracts/agentDesignerContract'
import './AgentDesignerChat.css'

type DesignerMessage = { role: 'user' | 'assistant'; content: string }
type ChatEntry = DesignerMessage & { reply?: AgentDesignerReply }
export type AgentDesignerChatRequest = { modelId: string; messages: DesignerMessage[]; currentBlueprint: AgentBlueprint; forceGenerate?: boolean }
type Props = {
  models: AgentBlueprintCatalog['models']
  currentBlueprint: AgentBlueprint
  disabled?: boolean
  onProposal: (blueprint: AgentBlueprint) => void
  onConversationReset?: () => void
  request?: (body: AgentDesignerChatRequest, signal: AbortSignal) => Promise<AgentDesignerReply>
}
const defaultRequest: NonNullable<Props['request']> = (body, signal) => apiPost('/agent-blueprints/design-chat', body, { signal })
const messageLimit = 24

export function appendAgentDesignerMessage(messages: DesignerMessage[], role: DesignerMessage['role'], content: string): DesignerMessage[] {
  if (!content.trim()) throw new Error('请输入任务描述或回答问题')
  if (content.length > 8000) throw new Error('每条消息最多 8000 字，请精简后发送')
  if (messages.length >= messageLimit) throw new Error('本轮对话已达 24 条消息，请先预览方案或清空对话后继续')
  if (messages.reduce((size, message) => size + message.content.length, 0) + content.trim().length > 60000) throw new Error('本轮对话已超过 60000 字符，请先预览已有方案或清空对话后继续')
  return [...messages, { role, content: content.trim() }]
}

/** A JSON-size budget includes escaped quotes/control characters, rather than slicing serialized JSON. */
function historyText(value: string, budget: number) {
  if (JSON.stringify(value).length <= budget) return value
  let lower = 0
  let upper = value.length
  while (lower < upper) {
    const length = Math.ceil((lower + upper) / 2)
    if (JSON.stringify(value.slice(0, length) + '…').length <= budget) lower = length
    else upper = length - 1
  }
  return value.slice(0, lower) + '…'
}

export function agentDesignerHistoryMessage(reply: AgentDesignerReply) {
  const full = { message: reply.message, question: reply.question, brief: reply.brief, nodePlan: reply.nodePlan }
  const serialized = JSON.stringify(full)
  if (serialized.length <= 12000) return serialized
  // Keep the current question and recommended answer first, then core brief, then a short node summary.
  return JSON.stringify({
    truncated: true,
    message: historyText(reply.message, 400),
    question: reply.question ? {
      question: historyText(reply.question.question, 2200),
      recommendedAnswer: historyText(reply.question.recommendedAnswer, 2200),
      options: reply.question.options.slice(0, 5).map(option => historyText(option, 120)),
    } : undefined,
    brief: {
      goal: historyText(reply.brief.goal, 650), audience: historyText(reply.brief.audience, 650),
      input: historyText(reply.brief.input, 650), output: historyText(reply.brief.output, 650),
      constraints: reply.brief.constraints.slice(0, 2).map(item => historyText(item, 100)),
      successCriteria: reply.brief.successCriteria.slice(0, 2).map(item => historyText(item, 100)),
    },
    nodePlan: reply.nodePlan.slice(0, 12).map(node => ({ name: historyText(node.name, 40), kind: node.kind, reason: historyText(node.reason, 60) })),
  })
}

export function AgentDesignerReplyCard({ reply, onAnswer, onProposal, disabled = false, answersDisabled = false }: {
  reply: AgentDesignerReply; onAnswer: (answer: string) => void; onProposal: (blueprint: AgentBlueprint) => void; disabled?: boolean; answersDisabled?: boolean
}) {
  return <div className="agent-designer-reply">
    <p className="agent-designer-message-text">{reply.message}</p>
    {reply.skillUsed === 'grill-me' && <span className="agent-designer-skill">grill-me · 需求澄清</span>}
    {reply.question && <section className="agent-designer-question" aria-label="当前澄清问题">
      <strong>{reply.question.question}</strong>
      {reply.question.recommendedAnswer && <button type="button" className="agent-designer-recommendation" disabled={disabled || answersDisabled} onClick={() => onAnswer(reply.question!.recommendedAnswer)}>推荐答案：{reply.question.recommendedAnswer}</button>}
      <div className="agent-designer-options">{reply.question.options.filter(option => option !== reply.question?.recommendedAnswer).map((option, index) => <button type="button" key={`${index}:${option}`} disabled={disabled || answersDisabled} onClick={() => onAnswer(option)}>{option}</button>)}</div>
      <small>点击答案直接发送，也可以在下方补充自己的想法。</small>
    </section>}
    <details className="agent-designer-understanding" open>
      <summary>需求理解</summary>
      <dl>{([['目标', reply.brief.goal], ['用途与受众', reply.brief.audience], ['输入', reply.brief.input], ['输出形式', reply.brief.output]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '待确认'}</dd></div>)}</dl>
      {reply.brief.constraints.length > 0 && <div><strong>约束</strong><ul>{reply.brief.constraints.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      {reply.brief.successCriteria.length > 0 && <div><strong>验收标准</strong><ul>{reply.brief.successCriteria.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
    </details>
    {reply.nodePlan.length > 0 && <details className="agent-designer-plan" open><summary>适配节点 · {reply.nodePlan.length} 个</summary><ol>{reply.nodePlan.map((node, index) => <li key={`${index}:${node.name}`}><strong>{node.name}</strong><span className="agent-designer-node-kind">{node.kind}</span><p>{node.reason}</p><small>输入：{node.input}<br />输出：{node.output}</small></li>)}</ol></details>}
    {reply.phase === 'ready' && reply.blueprint && <div className="agent-designer-proposal"><button type="button" disabled={disabled} onClick={() => onProposal(reply.blueprint!)}><Sparkles size={15} aria-hidden="true" />预览模块方案</button><small>采用前不会修改画布，可继续对话调整方案。</small></div>}
  </div>
}

export function AgentDesignerSubmitAction({ busy, disabled, onCancel }: { busy: boolean; disabled: boolean; onCancel: () => void }) {
  return busy
    ? <button key="cancel" type="button" className="agent-designer-cancel" onClick={event => { event.preventDefault(); onCancel() }}><Square size={14} aria-hidden="true" />取消</button>
    : <button key="send" type="submit" disabled={disabled}><Send size={14} aria-hidden="true" />发送</button>
}

export function AgentDesignerChat({ models, currentBlueprint, disabled = false, onProposal, onConversationReset, request = defaultRequest }: Props) {
  const [modelId, setModelId] = useState('')
  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const controller = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const end = useRef<HTMLDivElement>(null)
  const activeModel = models.some(model => model.id === modelId) ? modelId : models[0]?.id ?? ''
  const atLimit = entries.length >= messageLimit - 1
  const blocked = disabled || busy || !activeModel || atLimit
  const cancel = (reason = '已取消；输入内容已保留。') => {
    generation.current += 1
    controller.current?.abort()
    controller.current = null
    setBusy(false)
    setPending('')
    setStatus(reason)
  }
  useEffect(() => () => { generation.current += 1; controller.current?.abort() }, [])
  useEffect(() => { if (disabled && controller.current) cancel('画布操作进行中，已取消对话请求；输入内容已保留。') }, [disabled])
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [entries, busy, error])
  const reset = (reason: string) => {
    setEntries([])
    setInput('')
    setError('')
    setStatus(reason)
    onConversationReset?.()
  }

  const send = async (answer?: string, forceGenerate = false) => {
    if (controller.current || disabled) return
    const text = answer ?? (input.trim() || (forceGenerate ? '请按当前理解生成模块方案，并说明必要的默认假设。' : ''))
    let messages: DesignerMessage[]
    try {
      if (!activeModel) throw new Error('请先配置并选择可用模型')
      messages = appendAgentDesignerMessage(entries.map(({ role, content }) => ({ role, content })), 'user', text)
      if (messages.length >= messageLimit) throw new Error('本轮对话已达 24 条消息，请先预览方案或清空对话后继续')
    } catch (cause) { setError((cause as Error).message); return }
    const token = ++generation.current
    const abort = new AbortController()
    controller.current = abort
    onConversationReset?.()
    setInput(text)
    setPending(text)
    setBusy(true)
    setError('')
    setStatus('AI 正在理解需求并适配节点…')
    const timeout = setTimeout(() => abort.abort(), 120000)
    try {
      const reply = await request({ modelId: activeModel, messages, currentBlueprint, ...(forceGenerate ? { forceGenerate: true } : {}) }, abort.signal)
      if (generation.current !== token || abort.signal.aborted) return
      setEntries([...entries, { role: 'user', content: text.trim() }, { role: 'assistant', content: agentDesignerHistoryMessage(reply), reply }])
      setInput('')
      setStatus(reply.phase === 'ready' ? '模块方案已准备好，请预览后决定是否采用。' : '请回答当前问题，或补充自己的要求。')
    } catch (cause) {
      if (generation.current !== token) return
      setError(abort.signal.aborted ? '请求超时，输入已保留，请重试。' : (cause instanceof Error ? cause.message : '对话失败，输入已保留，请重试。'))
      setStatus('')
    } finally {
      clearTimeout(timeout)
      if (generation.current === token) { controller.current = null; setBusy(false); setPending('') }
    }
  }
  return <section className="agent-designer-chat" aria-label="AI 搭建对话">
    <header className="agent-designer-header"><div><MessageSquare size={18} aria-hidden="true" /><h3>AI 搭建对话</h3></div><button type="button" className="agent-designer-clear" disabled={busy || entries.length === 0} onClick={() => reset('对话已清空，画布保持不变。')}><Trash2 size={14} aria-hidden="true" />清空对话</button></header>
    <p className="agent-designer-caption">先理解目的，再搭建可编辑的模块</p>
    <label className="agent-designer-model">对话模型<select value={activeModel} disabled={disabled || busy} onChange={event => { setModelId(event.target.value); reset('已切换模型并清空原对话，画布保持不变。') }}>{models.length === 0 && <option value="">暂无可用模型</option>}{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
    <div className="agent-designer-history" role="log" aria-label="搭建对话记录" aria-live="polite" aria-busy={busy}>
      <article className="agent-designer-message is-assistant"><span className="agent-designer-speaker">AI 搭建助手</span><p className="agent-designer-message-text">告诉我你要完成什么。我会梳理目标、用途、输入和输出形式，必要时使用 grill-me 逐项追问，再分析适合的节点与连接方式。你可以随时修改要求，生成后先预览，再决定是否采用。</p></article>
      {entries.map((entry, index) => <article className={`agent-designer-message is-${entry.role}`} key={index}><span className="agent-designer-speaker">{entry.role === 'user' ? '你' : 'AI 搭建助手'}</span>{entry.reply ? <AgentDesignerReplyCard reply={entry.reply} disabled={disabled || busy || index !== entries.length - 1} answersDisabled={atLimit} onAnswer={answer => { void send(answer) }} onProposal={onProposal} /> : <p className="agent-designer-message-text">{entry.content}</p>}</article>)}
      {busy && <><article className="agent-designer-message is-user"><span className="agent-designer-speaker">你</span><p className="agent-designer-message-text">{pending}</p></article><p className="agent-designer-thinking">正在分析需求…</p></>}
      <div ref={end} />
    </div>
    <form className="agent-designer-composer" onSubmit={event => { event.preventDefault(); void send() }}>
      <label htmlFor="agent-designer-input">描述任务或回答问题</label><textarea id="agent-designer-input" value={input} maxLength={8000} disabled={disabled || busy || atLimit} onChange={event => setInput(event.target.value)} placeholder="例如：把会议笔记整理成给投资团队看的纪要，缺失信息先询问我，最终输出 Markdown。" rows={4} />
      <div className="agent-designer-composer-actions"><small>{input.length}/8000</small><AgentDesignerSubmitAction busy={busy} disabled={blocked || !input.trim()} onCancel={() => cancel()} /></div>
      <button type="button" className="agent-designer-force" disabled={blocked || (entries.length === 0 && !input.trim())} onClick={() => { void send(undefined, true) }}><Sparkles size={14} aria-hidden="true" />按当前理解生成</button>
      <small className="agent-designer-privacy">仅发送本次对话与当前画布草稿；对话仅保留在本次页面会话中。{atLimit ? '已达 24 条消息，请预览方案或清空后继续。' : `${entries.length}/24 条消息`}</small>
      {error && <p className="agent-designer-error" role="alert">{error}</p>}
      <p className="agent-designer-status" role="status">{status}</p>
    </form>
  </section>
}
