import React, { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowRight, Bot, FileText, GitBranch, Layers3, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { api, apiPatch } from '../lib/api'
import { Button, Modal } from './ui'
import { useAuthStore } from '../store/useAuthStore'
import { AgentBlueprintBuilder } from './AgentBlueprintBuilder'
import type { AgentBlueprintRecord } from '../../server/src/contracts/agentBlueprintContract'
import './AgentStudio.css'

type Props = {
  onClose?: () => void
  renderPromptLibrary?: (onBuild: () => void) => ReactNode
}

export function AgentStudio({ onClose, renderPromptLibrary }: Props) {
  const [section, setSection] = useState<'library' | 'builder'>('library')
  const [mode, setMode] = useState<'simple' | 'advanced'>('advanced')
  const [records, setRecords] = useState<AgentBlueprintRecord[]>([])
  const [selected, setSelected] = useState<AgentBlueprintRecord | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const request = useRef(0)
  const [sharing, setSharing] = useState<AgentBlueprintRecord | null>(null)
  const [sharingBusy, setSharingBusy] = useState(false)

  useEffect(() => {
    const token = ++request.current
    const controller = new AbortController()
    setLoading(true); setError('')
    void api<{ list: AgentBlueprintRecord[] }>('/agent-blueprints', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]) })
      .then(result => { if (token === request.current) setRecords(result.list) })
      .catch(cause => { if (token === request.current) setError(cause instanceof Error ? cause.message : '个人 Agent 加载失败') })
      .finally(() => { if (token === request.current) setLoading(false) })
    return () => { request.current++; controller.abort() }
  }, [refresh, section])

  function build(nextMode: 'simple' | 'advanced' = 'advanced', record?: AgentBlueprintRecord) {
    setSelected(record); setMode(nextMode); setSection('builder')
  }

  return <section className="agent-studio" aria-label="Agent 中心">
    <header className="as-header">
      <div><span className="as-eyebrow">AGENT STUDIO</span><h1>你的方法，你的 Agent</h1><p>把做好的 Agent 留在库里，让新的工作方法在画布上成形。</p></div>
      {onClose && <Button variant="secondary" onClick={onClose}>返回 AI 助手</Button>}
    </header>
    <nav className="as-navigation" aria-label="Agent 功能分区">
      <button type="button" aria-current={section === 'library' ? 'page' : undefined} className={section === 'library' ? 'is-active' : ''} onClick={() => setSection('library')}><Bot size={18} /><span>Agent 库</span><small>已保存的 Agent 与提示词</small></button>
      <button type="button" aria-current={section === 'builder' ? 'page' : undefined} className={section === 'builder' ? 'is-active' : ''} onClick={() => setSection('builder')}><Layers3 size={18} /><span>搭建 Agent</span><small>简易创建与高级画布</small></button>
    </nav>
    {section === 'builder' ? <AgentBlueprintBuilder initialRecord={selected} initialMode={mode} onClose={() => setSection('library')} onSaved={record => { setRecords(previous => [record, ...previous.filter(item => item.id !== record.id)]) }} /> : <div className="as-library">
      <div className="as-create-options">
        <button type="button" onClick={() => build('advanced')}><span className="as-option-icon advanced"><GitBranch size={20} /></span><span><strong>手动搭建 · 高级画布</strong><small>逐个添加和编辑节点，配置变量、模型与执行路径</small></span><ArrowRight size={18} /></button>
        <button type="button" onClick={() => build('simple')}><span className="as-option-icon"><Sparkles size={20} /></span><span><strong>简易搭建</strong><small>一句话生成，或粘贴 Markdown 直接创建</small></span><ArrowRight size={18} /></button>

      </div>
      <section className="as-saved-agents" aria-label="已保存的工作流 Agent">
        <div className="as-section-heading"><div><h2>我的 Agent <span>{records.length}</span></h2><p>保存后的工作流集中在这里，可继续编辑、运行和导出。</p></div><Button variant="ghost" aria-label="刷新我的 Agent" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} /></Button></div>
        {loading && <p role="status" className="as-state">正在读取个人 Agent…</p>}
        {error && <p role="alert" className="as-error">读取失败：{error}<button type="button" onClick={() => setRefresh(value => value + 1)}>重新加载</button></p>}
        {!loading && !error && !records.length && <div className="as-empty"><Bot size={30} /><strong>把第一套工作方法变成 Agent</strong><p>已有的提示词模板会继续保留在下方。你可以从一句话、Markdown 或空白画布开始。</p><Button variant="secondary" onClick={() => build('advanced')}><Plus size={16} />搭建第一个 Agent</Button></div>}
        <div className="as-agent-grid">{records.map(record => <article key={record.id} className="as-agent-card"><div className="as-card-top"><span className="as-card-icon"><Bot size={20} /></span><span>{record.visibility === 'organization' ? '公司共享' : '个人 Agent'} · v{record.version}</span></div><h3>{record.blueprint.name}</h3><p>{record.blueprint.description || '自定义的模块化工作方法'}</p><div className="as-card-bottom"><span>{record.blueprint.modules.length} 个模块{record.blueprint.graph ? ' · 画布工作流' : ' · 顺序流程'}</span><button type="button" onClick={() => build('advanced', record)}>打开 Agent <ArrowRight size={15} /></button></div><Button size="sm" variant="secondary" onClick={() => setSharing(record)}>{record.visibility === 'organization' ? '取消共享' : '共享给公司'}</Button></article>)}</div>
      </section>
      <SharedWorkflowLibrary refresh={refresh} />
      <section className="as-prompt-library" aria-label="保留的 Agent 提示词模板">
        <div className="as-section-heading"><div><h2><FileText size={19} />{renderPromptLibrary ? '提示词模板' : '平台现有 Agent'}</h2><p>原有 Agent 库、内置方法和你保存的 Markdown 提示词继续保留。</p></div></div>
        {renderPromptLibrary ? renderPromptLibrary(() => build('advanced')) : <AvailableAgentLibrary />}
      </section>
    </div>}
    <Modal open={Boolean(sharing)} title={sharing?.visibility === 'organization' ? '取消工作流共享' : '确认共享工作流'} onClose={() => !sharingBusy && setSharing(null)} footer={<Button disabled={sharingBusy} onClick={async () => {
      if (!sharing) return
      setSharingBusy(true); setError('')
      try { const saved = await apiPatch<AgentBlueprintRecord>(`/agent-blueprints/${sharing.id}/sharing`, { expectedVersion: sharing.version, visibility: sharing.visibility === 'organization' ? 'private' : 'organization' }); setRecords(items => items.map(item => item.id === saved.id ? saved : item)); setSharing(null); setRefresh(value => value + 1) }
      catch (cause) { setError((cause as Error).message) } finally { setSharingBusy(false) }
    }}>{sharingBusy ? '处理中…' : '确认'}</Button>}><p className="text-sm leading-6">{sharing?.visibility === 'organization' ? '取消后，其他员工不能再调用此工作流；历史调用记录保留。' : '共享内容包含工作流中的提示词和步骤，请确认没有粘贴敏感项目原文。项目附件、分身私有素材及平台保存的模型密钥不随工作流共享，调用仍受模型与 Skill 权限限制。'}</p>{sharing && <><p className="mt-3 text-sm">{sharing.blueprint.name} · v{sharing.version} · {sharing.blueprint.modules.length} 个模块</p><details className="mt-3 text-sm"><summary className="cursor-pointer">查看将共享的定义</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs">{JSON.stringify(sharing.blueprint, null, 2)}</pre></details></>}{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}</Modal>
  </section>
}

function SharedWorkflowLibrary({ refresh }: { refresh: number }) {
  const userId = useAuthStore(state => state.user?.id)
  const [items, setItems] = useState<AgentBlueprintRecord[]>([]), [error, setError] = useState('')
  useEffect(() => {
    let active = true; const controller = new AbortController()
    void api<{ list: AgentBlueprintRecord[] }>('/agent-blueprints/shared', { signal: controller.signal }).then(result => { if (active) { setItems(result.list.filter(item => item.ownerUserId !== userId)); setError('') } }).catch(cause => { if (active && !controller.signal.aborted) setError((cause as Error).message) })
    return () => { active = false; controller.abort() }
  }, [userId, refresh])
  return <section className="as-saved-agents" aria-label="公司共享的工作流 Agent"><div className="as-section-heading"><h2>公司共享 Agent</h2></div>{error ? <p role="alert" className="as-error">读取共享工作流失败：{error}</p> : items.length ? <div className="as-agent-grid">{items.map(item => <article className="as-agent-card" key={item.id}><h3>{item.blueprint.name} · v{item.version}</h3><p>{item.blueprint.description}</p><a href="/due-diligence" className="text-sm text-brand-700 underline">在尽调工作台选择调用</a></article>)}</div> : <p className="as-state">暂无其他员工共享的工作流。</p>}</section>
}

function AvailableAgentLibrary() {
  const [items, setItems] = useState<Array<{id:string;name:string;description:string|null;kind:string}>>([])
  const [status, setStatus] = useState('正在读取已授权的 Agent…')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setStatus('正在读取已授权的 Agent…')
    void api<{list: typeof items}>('/ai/capabilities/available', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]) })
      .then(result => { if (active) { setItems(result.list.filter(item => item.kind === 'agent')); setStatus('') } })
      .catch(cause => { if (active) setStatus(`读取失败：${cause instanceof Error ? cause.message : '请稍后重试'}`) })
    return () => { active = false; controller.abort() }
  }, [retry])
  return <div>{status ? <p className="as-state" role="status">{status}{status.startsWith('读取失败') && <Button variant="ghost" onClick={() => setRetry(value => value + 1)}>重新加载</Button>}</p> : items.length ? <div className="as-agent-grid">{items.map(item => <article className="as-agent-card" key={item.id}><h3>{item.name}</h3><p>{item.description || '平台已有的 Agent 能力'}</p><small>在 AI 助手会话中选择使用</small></article>)}</div> : <p className="as-state">当前没有已授权的全局 Agent；项目专属 Agent 可在对应项目会话中选择。</p>}</div>
}
