import React, { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Download, Layers3, Play, Plus, Save, Sparkles, Trash2, Upload, X, Undo2, Redo2 } from 'lucide-react'
import { api, apiDelete, apiPost, apiPut } from '../lib/api'
import { Button } from './ui'
import { useAuthStore } from '../store/useAuthStore'
import type { AgentBlueprint, AgentBlueprintCatalog, AgentBlueprintExport, AgentBlueprintModule, AgentBlueprintRecord, AgentBlueprintRun } from '../../server/src/contracts/agentBlueprintContract'
import { createMarkdownAgent, readAgentMarkdown } from '../lib/agentBlueprintAuthoring'
import { getAgentBlueprintAncestors, getAgentBlueprintGraphError } from '../../server/src/contracts/agentBlueprintGraph'
import { AgentWorkflowCanvas, createSequentialGraph } from './AgentWorkflowCanvas'
import { AgentInputEditor, AgentRunInputs, validateManualInputFields } from './AgentInputEditor'
import { AgentNodeEditor } from './AgentNodeEditor'
import { AgentDesignerChat } from './AgentDesignerChat'
import { AgentNodeDebug, type AgentNodeDebugContext } from './AgentNodeDebug'
import './AgentBlueprintBuilder.css'

const endpoint = '/agent-blueprints'
const moduleDraft = (modelId = ''): AgentBlueprintModule => ({
  id: `module_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`, name: '新模块', modelId,
  prompt: '', inputTemplate: '{{previous}}', skillIds: [], outputFormat: 'markdown', outputInstructions: '',
})
const emptyBlueprint = (): AgentBlueprint => ({ schemaVersion: 1, name: '我的 Agent', description: '', modules: [{
  id: 'module_1', name: '需求处理', modelId: '', prompt: '', inputTemplate: '{{input}}', skillIds: [], outputFormat: 'markdown', outputInstructions: '',
}] })

export function reorderBlueprintModules(modules: AgentBlueprintModule[], id: string, direction: -1 | 1) {
  const index = modules.findIndex(module => module.id === id)
  const destination = index + direction
  if (index < 0 || destination < 0 || destination >= modules.length) return modules
  const next = [...modules]
  ;[next[index], next[destination]] = [next[destination], next[index]]
  return next
}

export function blueprintReferenceProblem(modules: AgentBlueprintModule[], graph?: AgentBlueprint['graph']) {
  const preceding = new Set<string>()
  for (const module of modules) {
    const references = [...module.inputTemplate.matchAll(/\{\{\s*modules\.([\w-]+)\s*\}\}/g)].map(match => match[1])
    for (const source of [module.condition?.source, ...(module.conditionGroup?.rules.map(rule => rule.source) ?? []), ...(module.aggregate?.sources ?? [])]) {
      if (source && !['input', 'previous'].includes(source) && !source.startsWith('inputs.')) references.push(source)
    }
    const available = graph ? getAgentBlueprintAncestors({ schemaVersion: 1, name: '', description: '', modules, graph }, module.id) : preceding
    const invalid = references.find(id => !available.has(id))
    if (invalid) return `模块“${module.name}”引用了非前序模块 ${invalid}，请先调整顺序或输入映射。`
    preceding.add(module.id)
  }
  return ''
}

export async function readBlueprintImport(file: File): Promise<unknown> {
  if (file.size > 16 * 1024 * 1024) throw new Error('请选择不超过 16 MB 的 JSON 模板')
  let document: unknown
  try { document = JSON.parse(await file.text()) } catch { throw new Error('文件不是有效的 JSON，请检查导出文件') }
  // Skill dependency text can be large; the server rechecks current permissions from blueprint IDs.
  return document && typeof document === 'object' && 'blueprint' in document ? document.blueprint : document
}

type SessionDraft = { draft: AgentBlueprint; saved: AgentBlueprintRecord | null; baseline: string; selectedModuleId: string; description: string; markdown: string; mode: 'simple' | 'advanced'; creation: 'description' | 'markdown' }
// Temporary in-memory drafts survive SPA navigation; MySQL remains authoritative for saved templates.
const sessionDrafts = new Map<string, SessionDraft>()

type BuilderProps = { onClose?: () => void; initialRecord?: AgentBlueprintRecord; initialMode?: 'simple' | 'advanced'; onSaved?: (record: AgentBlueprintRecord) => void }

export function AgentBlueprintBuilder(props: BuilderProps) {
  const ownerId = useAuthStore(state => state.user?.id ?? '')
  return <BlueprintWorkspace key={`${ownerId}:${props.initialRecord?.id ?? "new"}`} ownerId={ownerId} {...props} />
}

function BlueprintWorkspace({ onClose, ownerId, initialRecord, initialMode = 'advanced', onSaved }: BuilderProps & { ownerId: string }) {
  const draftKey = `${ownerId}:${initialRecord?.id ?? 'new'}`
  const restored = ownerId ? sessionDrafts.get(draftKey) : undefined
  const [mode, setMode] = useState(restored?.mode ?? initialMode)
  const [creation, setCreation] = useState<'description' | 'markdown'>(restored?.creation ?? 'description')
  const [markdown, setMarkdown] = useState(restored?.markdown ?? '')
  const markdownFile = useRef<HTMLInputElement>(null)
  const [catalog, setCatalog] = useState<AgentBlueprintCatalog>({ models: [], skills: [] })
  const [records, setRecords] = useState<AgentBlueprintRecord[]>([])
  const [draft, setDraft] = useState<AgentBlueprint>(() => restored?.draft ?? initialRecord?.blueprint ?? emptyBlueprint())
  const [saved, setSaved] = useState<AgentBlueprintRecord | null>(() => restored?.saved ?? initialRecord ?? null)
  const [baseline, setBaseline] = useState(() => restored?.baseline ?? JSON.stringify(initialRecord?.blueprint ?? emptyBlueprint()))
  const [selectedModuleId, setSelectedModuleId] = useState(() => restored?.selectedModuleId ?? initialRecord?.blueprint.modules[0]?.id ?? 'module_1')
  const [description, setDescription] = useState(restored?.description ?? '')
  const [proposal, setProposal] = useState<AgentBlueprint | null>(null)
  const [rightPane, setRightPane] = useState<'chat' | 'node'>('chat')
  const [chatRevision, setChatRevision] = useState(0)
  const [designerModel, setDesignerModel] = useState('')
  const [input, setInput] = useState('')
  const [variables, setVariables] = useState<Record<string, string>>({})
  const history = useRef<{ past: AgentBlueprint[]; future: AgentBlueprint[] }>({ past: [], future: [] })
  const [, setHistoryRevision] = useState(0)
  const [run, setRun] = useState<AgentBlueprintRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(restored ? '已恢复本次登录会话中的未保存草稿；保存模板后才会写入个人空间。' : '')
  const operation = useRef(0)
  const locked = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const requestController = useRef<AbortController | null>(null)
  const dirty = JSON.stringify(draft) !== baseline
  const disabled = loading || Boolean(loadError) || Boolean(busy)
  const selected = selectedModuleId === 'start' ? undefined : draft.modules.find(module => module.id === selectedModuleId) ?? draft.modules[0]
  const selectedIndex = draft.modules.findIndex(module => module.id === selected?.id)
  const referenceProblem = (draft.graph ? getAgentBlueprintGraphError(draft) : '') || blueprintReferenceProblem(draft.modules, draft.graph)
  const inputSources = draft.graph ? draft.modules.filter(module => selected && getAgentBlueprintAncestors(draft, selected.id).has(module.id)) : draft.modules.slice(0, selectedIndex)
  const inputProblem = validateManualInputFields(draft.inputFields)

  useEffect(() => {
    void load()
    return () => { operation.current += 1; requestController.current?.abort() }
  }, [])
  useEffect(() => {
    if (!ownerId) return
    if (dirty || description || markdown) sessionDrafts.set(draftKey, { draft, saved, baseline, selectedModuleId, description, markdown, mode, creation })
    else sessionDrafts.delete(draftKey)
  }, [ownerId, draftKey, dirty, draft, saved, baseline, selectedModuleId, description, markdown, mode, creation])
  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => { if (dirty || busy) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', preventLoss)
    return () => window.removeEventListener('beforeunload', preventLoss)
  }, [dirty, busy])

  async function load() {
    const token = ++operation.current
    const controller = new AbortController()
    requestController.current = controller
    setLoading(true); setLoadError('')
    try {
      const [nextCatalog, result] = await Promise.all([
        api<AgentBlueprintCatalog>(`${endpoint}/catalog`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]) }), api<{ list: AgentBlueprintRecord[] }>(endpoint, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]) }),
      ])
      if (token !== operation.current) return
      setCatalog(nextCatalog); setRecords(result.list); setDesignerModel(nextCatalog.models[0]?.id ?? '')
    } catch (cause) {
      if (token === operation.current) setLoadError(cause instanceof Error ? cause.message : '模板与配置加载失败')
    } finally { if (token === operation.current) setLoading(false) }
  }

  function canReplace() {
    return !dirty || window.confirm('当前模板有未保存的修改，是否放弃修改并继续？')
  }
  function replace(next: AgentBlueprint, record: AgentBlueprintRecord | null = null) {
    setDraft(next); setSaved(record); setBaseline(JSON.stringify(record ? next : emptyBlueprint()))
    history.current = { past: [], future: [] }; setHistoryRevision(value => value + 1); setVariables({})
    setSelectedModuleId(next.modules[0]?.id ?? ''); setRun(null); setProposal(null); setChatRevision(value => value + 1); setRightPane('chat'); setError(''); setNotice('')
  }
  function edit(next: AgentBlueprint) {
    history.current = { past: [...history.current.past, draft].slice(-20), future: [] }
    setHistoryRevision(value => value + 1); setDraft(next); setRun(null); setNotice(''); setError('')
    setVariables(previous => Object.fromEntries(Object.entries(previous).filter(([name]) => next.inputFields?.some(field => field.name === name))))
  }
  function restoreHistory(direction: 'undo' | 'redo') {
    const items = direction === 'undo' ? history.current.past : history.current.future
    const next = items.at(-1)
    if (!next || disabled) return
    history.current = direction === 'undo' ? { past: items.slice(0, -1), future: [...history.current.future, draft] } : { past: [...history.current.past, draft], future: items.slice(0, -1) }
    setHistoryRevision(value => value + 1); setDraft(next); setRun(null); setError(''); setNotice(direction === 'undo' ? '已撤销修改' : '已重做修改')
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (disabled || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z' || target?.closest('input, textarea, select, [contenteditable]')) return
      event.preventDefault(); restoreHistory(event.shiftKey ? 'redo' : 'undo')
    }
    window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut)
  }, [draft, disabled])
  function editModule(patch: Partial<AgentBlueprintModule>) {
    if (!selected) return
    edit({ ...draft, modules: draft.modules.map(module => module.id === selected.id ? { ...module, ...patch } : module) })
  }
  async function act(label: string, work: (current: () => boolean, signal: AbortSignal) => Promise<void>) {
    if (locked.current || disabled) return
    locked.current = true
    const token = ++operation.current
    const controller = new AbortController()
    requestController.current = controller
    setBusy(label); setError(''); setNotice('')
    try { await work(() => token === operation.current, controller.signal) }
    catch (cause) { if (token === operation.current) setError(cause instanceof Error ? cause.message : `${label}失败`) }
    finally {
      if (token === operation.current) { locked.current = false; setBusy('') }
    }
  }
  function validate() {
    if (!draft.name.trim()) throw new Error('请填写 Agent 名称')
    if (!draft.modules.length) throw new Error('请至少添加一个模块')
    if (referenceProblem) throw new Error(referenceProblem)
    if (inputProblem) throw new Error(inputProblem)
    if (draft.modules.some(module => !module.name.trim() || ((!module.kind || module.kind === 'llm') && (!module.modelId || !module.prompt.trim())))) throw new Error('请为每个模块填写名称、使用模型和目标与提示词')
  }
  function save() {
    void act('保存模板', async current => {
      validate()
      const result = saved
        ? await apiPut<AgentBlueprintRecord>(`${endpoint}/${encodeURIComponent(saved.id)}`, { blueprint: draft, expectedVersion: saved.version })
        : await apiPost<AgentBlueprintRecord>(endpoint, { blueprint: draft })
      if (!current()) return
      setRecords(previous => [result, ...previous.filter(record => record.id !== result.id)])
      setSaved(result); setBaseline(JSON.stringify(result.blueprint)); setDraft(result.blueprint); setDescription(''); setMarkdown(''); sessionDrafts.delete(draftKey); setNotice('模板已保存到个人空间'); onSaved?.(result)
    })
  }
  function generate(source = description) {
    if (source.trim().length < 5 || !designerModel || !canReplace()) return
    void act('正在拆解需求并搭建模块', async (current, signal) => {
      const result = await apiPost<{ blueprint: AgentBlueprint }>(`${endpoint}/generate`, { description: source, modelId: designerModel }, { signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]) })
      if (current()) { replace(result.blueprint); setNotice('已生成草稿，请检查每个模块后保存') }
    })
  }
  function applyProposal() {
    if (!proposal) return
    edit({ ...proposal, graph: proposal.graph ?? createSequentialGraph(proposal.modules) })
    setSelectedModuleId(proposal.modules[0]?.id ?? 'start'); setProposal(null)
    setNotice('已采用 AI 方案，可逐个编辑模块；撤销修改可恢复原画布，保存后才会写入个人空间')
  }
  function importFile(file: File) {
    if (!canReplace()) return
    void act('导入模板', async current => {
      const document = await readBlueprintImport(file)
      const result = await apiPost<{ blueprint: AgentBlueprint }>(`${endpoint}/import`, { document })
      if (current()) { replace(result.blueprint); setNotice('已导入为新草稿，请确认模型和 Skill 后保存') }
    })
  }
  function download(format: 'json' | 'markdown') {
    void act('导出模板', async current => {
      validate()
      const result = await apiPost<AgentBlueprintExport>(`${endpoint}/export`, { blueprint: draft, format })
      if (!current()) return
      const url = URL.createObjectURL(new Blob([result.content], { type: result.mimeType }))
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = result.filename; anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice('配置与提示词已导出；在其他平台使用时需配置模型和 Skill 对应关系')
    })
  }
  function startRun(throughModuleId?: string) {
    void act(throughModuleId ? '正在试运行至当前模块' : '正在试运行全部模块', async (current, signal) => {
      validate()
      if (!input.trim() && !draft.inputFields?.length) throw new Error('请填写试运行输入')
      setRun(null)
      const result = await apiPost<AgentBlueprintRun>(`${endpoint}/run`, { blueprint: draft, input, variables, ...(throughModuleId ? { throughModuleId } : {}) }, { signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]) })
      if (current()) { setRun(result); setNotice(agentBlueprintRunNotice(result)) }
    })
  }
  function startNodeRun(context: AgentNodeDebugContext) {
    if (!selected) return
    void act('正在单独测试当前节点', async (current, signal) => {
      if (inputProblem) throw new Error(inputProblem)
      if ((!selected.kind || selected.kind === 'llm') && (!selected.modelId || !selected.prompt.trim())) throw new Error('请为当前模型节点选择模型并填写提示词')
      const result = await apiPost<AgentBlueprintRun>(`${endpoint}/run-node`, { blueprint: draft, moduleId: selected.id, context }, { signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]) })
      if (current()) { setRun(result); setNotice(result.status === 'succeeded' ? '当前节点测试完成；未执行其他节点' : '当前节点测试失败，请查看错误') }
    })
  }
  function cancelOperation() {
    requestController.current?.abort(); operation.current += 1; locked.current = false; setBusy(''); setNotice('已取消当前请求，草稿已保留')
  }
  function deleteSaved() {
    if (!saved || !window.confirm(`确定删除个人模板“${saved.blueprint.name}”吗？${dirty ? '当前未保存的修改也会放弃。' : ''}`)) return
    void act('删除模板', async current => {
      await apiDelete(`${endpoint}/${encodeURIComponent(saved.id)}`, { expectedVersion: saved.version })
      if (current()) { setRecords(previous => previous.filter(record => record.id !== saved.id)); replace(emptyBlueprint()); setNotice('模板已删除') }
    })
  }
  function move(direction: -1 | 1) {
    if (!selected) return
    const modules = reorderBlueprintModules(draft.modules, selected.id, direction)
    const problem = blueprintReferenceProblem(modules)
    if (problem) { setError(problem); return }
    edit({ ...draft, modules })
  }
  function removeModule() {
    if (!selected) return
    if (draft.modules.length === 1) { setError('请至少保留一个模块'); return }
    if (draft.graph) {
      edit({ ...draft, modules: draft.modules.filter(module => module.id !== selected.id), graph: { ...draft.graph, edges: draft.graph.edges.filter(edge => edge.source !== selected.id && edge.target !== selected.id), positions: Object.fromEntries(Object.entries(draft.graph.positions).filter(([id]) => id !== selected.id)) } }); setSelectedModuleId(''); return
    }
    const modules = draft.modules.filter(module => module.id !== selected.id)
    const problem = blueprintReferenceProblem(modules)
    if (problem) { setError(problem); return }
    edit({ ...draft, modules }); setSelectedModuleId(modules[Math.max(0, selectedIndex - 1)]?.id ?? '')
  }

  function fromMarkdown() {
    if (!canReplace()) return
    try { replace(createMarkdownAgent(markdown, designerModel)); setNotice('已保留 Markdown 原文并创建模块，请确认后保存') } catch (cause) { setError(cause instanceof Error ? cause.message : 'Markdown 创建失败') }
  }
  async function uploadMarkdown(file: File) {
    try { const text = await readAgentMarkdown(file); if (text.length > 16000) throw new Error('Markdown 最多 16000 字符'); setMarkdown(text); setCreation('markdown'); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : 'Markdown 读取失败') }
  }

  return <section className="agent-blueprint-builder" aria-label="Agent 工作台" aria-busy={loading || Boolean(busy)}>
    <header className="ab-header">
      <div className="ab-heading"><span className="ab-symbol"><Layers3 aria-hidden="true" size={22} /></span><div><h2>Agent 工作台</h2><p>手动添加与配置节点，把你的方法搭建成可复用流程</p></div></div>
      {onClose && <Button variant="ghost" disabled={Boolean(busy)} onClick={() => { if (canReplace()) { sessionDrafts.delete(draftKey); onClose() } }} aria-label="关闭 Agent 工作台"><X size={18} /></Button>}
    </header>
    {loading && <p className="ab-feedback" role="status">正在读取个人模板与可用模型、Skill…</p>}
    {loadError && <div className="ab-error" role="alert">加载失败：{loadError}<Button variant="secondary" onClick={() => void load()}>重新加载</Button></div>}
    {!loading && !loadError && !catalog.models.length && <p className="ab-feedback" role="status">当前没有可用模型，请检查模型配置或访问权限后重新加载。</p>}
    {error && <p className="ab-error" role="alert">{error}</p>}
    {(busy || notice) && <div className="ab-feedback ab-operation-status" role="status"><span>{busy ? `${busy}…` : notice}</span>{(busy.includes('试运行') || busy.includes('测试') || busy.includes('拆解')) && <Button variant="secondary" onClick={cancelOperation}>取消当前操作</Button>}</div>}
    <fieldset className="ab-fieldset" disabled={disabled}>
      <div className="ab-mode-tabs" role="group" aria-label="搭建方式"><button type="button" aria-pressed={mode === 'advanced'} onClick={() => setMode('advanced')}>手动搭建 <small>逐个编辑节点、输入与执行路径</small></button><button type="button" aria-pressed={mode === 'simple'} onClick={() => setMode('simple')}>简易搭建 <small>可选：一句话 / Markdown 起草</small></button></div>
      {mode === 'simple' && <section className="ab-designer" aria-label="自然语言设计">
        <div><h3><Sparkles size={17} aria-hidden="true" />用一句话设计 Agent</h3><p>描述任务、判断条件和想要的结果，AI 会拆解需求并生成可编辑的模块。</p></div>
        {mode === 'simple' && <div className="ab-creation-tabs"><button type="button" aria-pressed={creation === 'description'} onClick={() => setCreation('description')}>一句话生成</button><button type="button" aria-pressed={creation === 'markdown'} onClick={() => setCreation('markdown')}>粘贴 Markdown</button></div>}
        {creation === 'description' ? <label className="ab-field"><span>任务描述</span><textarea rows={3} maxLength={20000} value={description} onChange={event => setDescription(event.target.value)} placeholder="例如：分析一家机器人公司，先提取 BP 关键事实，再核查技术与市场，最后输出包含证据和风险的投资初筛报告。" /></label> : <label className="ab-field"><span>Markdown 方法与提示词</span><textarea className="ab-code" rows={8} maxLength={16000} value={markdown} onChange={event => setMarkdown(event.target.value)} placeholder="# 我的 Agent\n粘贴你的角色、方法、处理步骤和输出要求…" /><small>直接创建会完整保留原文；也可让 AI 将方法拆为多个模块。</small></label>}
        <div className="ab-designer-actions"><label className="ab-field"><span>{mode === 'simple' && creation === 'markdown' ? '使用模型' : '需求设计模型'}</span><select value={designerModel} onChange={event => setDesignerModel(event.target.value)}><option value="">选择模型</option>{catalog.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label><div className="ab-actions">{creation === 'description' ? <Button onClick={() => generate()} disabled={description.trim().length < 5 || !designerModel}><Sparkles size={16} />生成模块草稿</Button> : <><Button variant="secondary" onClick={() => markdownFile.current?.click()}><Upload size={16} />上传 .md</Button><input ref={markdownFile} className="ab-hidden" type="file" accept=".md,.markdown,text/markdown" aria-label="上传 Markdown 提示词文件" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadMarkdown(file) }} /><Button variant="secondary" onClick={() => generate(markdown)} disabled={markdown.trim().length < 5 || !designerModel}>AI 拆解方法</Button><Button onClick={fromMarkdown} disabled={!markdown.trim() || !designerModel}>从 Markdown 创建</Button></>}</div></div>

      </section>}
      <div className="ab-toolbar">
        <label className="ab-field ab-library"><span>个人模板</span><select value={saved?.id ?? ''} onChange={event => { const record = records.find(item => item.id === event.target.value); if (record && canReplace()) replace(record.blueprint, record) }}><option value="">未保存草稿</option>{records.map(record => <option key={record.id} value={record.id}>{record.blueprint.name} · v{record.version}</option>)}</select></label>
        <div className="ab-actions"><Button variant="ghost" disabled={!history.current.past.length} onClick={() => restoreHistory('undo')}><Undo2 size={16} />撤销修改</Button><Button variant="ghost" disabled={!history.current.future.length} onClick={() => restoreHistory('redo')}><Redo2 size={16} />重做修改</Button><Button variant="secondary" onClick={() => { if (canReplace()) { replace(emptyBlueprint()); setMode('advanced') } }}><Plus size={16} />空白创建</Button><Button variant="secondary" onClick={() => fileInput.current?.click()}><Upload size={16} />导入 JSON</Button><input ref={fileInput} className="ab-hidden" aria-label="选择 Agent JSON 文件" type="file" accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) importFile(file) }} /><Button onClick={save}><Save size={16} />保存模板</Button></div>
      </div>
      <section className="ab-identity">
        <label className="ab-field"><span>Agent 名称</span><input value={draft.name} maxLength={100} onChange={event => edit({ ...draft, name: event.target.value })} /></label>
        <label className="ab-field"><span>用途说明</span><input value={draft.description} maxLength={2000} onChange={event => edit({ ...draft, description: event.target.value })} placeholder="说明这套 Agent 能处理什么任务" /></label>
        <span className={`ab-save-state ${dirty ? 'is-dirty' : ''}`}>{dirty ? '有未保存修改' : saved ? `已保存 · v${saved.version}` : '新建草稿'}</span>
      </section>
      <div className={`ab-workspace ${mode === 'advanced' ? 'is-advanced' : ''}`}>
        {mode === 'advanced' ? <AgentWorkflowCanvas blueprint={draft} onChange={edit} selectedModuleId={selectedModuleId} onSelectModule={id => { setSelectedModuleId(id); setRightPane('node') }} disabled={disabled} run={run} defaultModelId={catalog.models[0]?.id} modelNames={Object.fromEntries(catalog.models.map(model => [model.id, model.name]))} /> : <aside className="ab-flow" aria-label="模块流程">
          <div className="ab-section-title"><h3>模块流程</h3><span>{draft.modules.length} 个模块</span></div>
          <button type="button" className={`ab-start ab-start-button ${selectedModuleId === 'start' ? 'is-selected' : ''}`} aria-pressed={selectedModuleId === 'start'} onClick={() => setSelectedModuleId('start')}>开始 · 用户输入</button>
          <ol>{draft.modules.map((module, index) => <li key={module.id}><button type="button" className={`ab-module ${module.id === selected?.id ? 'is-selected' : ''}`} aria-pressed={module.id === selected?.id} onClick={() => setSelectedModuleId(module.id)}><span className="ab-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{module.name || '未命名模块'}</strong><small>{catalog.models.find(model => model.id === module.modelId)?.name ?? '待选择模型'} · {module.condition ? '条件执行' : '顺序执行'}</small></span></button></li>)}</ol>
          <button type="button" className="ab-add-module" disabled={Boolean(draft.graph) || draft.modules.length >= 12} onClick={() => { const module = moduleDraft(catalog.models[0]?.id); edit({ ...draft, modules: [...draft.modules, module] }); setSelectedModuleId(module.id) }}><Plus size={17} />添加模块</button><div className="ab-end">结束 · 最终输出</div>
          <p className="ab-help">{draft.graph ? '此 Agent 已配置画布连线；请切换高级搭建新增节点和修改路径。' : '按顺序执行；条件不满足时跳过该模块。支持最多 12 个模块。'}</p>
        </aside>}
        <aside className="ab-side-panel" aria-label="Agent 设计侧栏">
          {mode === 'advanced' && <div className="ab-side-tabs" role="tablist" aria-label="设计侧栏分区"><button type="button" role="tab" id="ab-chat-tab" aria-selected={rightPane === 'chat'} aria-controls="ab-chat-panel" onClick={() => setRightPane('chat')}>AI 对话</button><button type="button" role="tab" id="ab-node-tab" aria-selected={rightPane === 'node'} aria-controls="ab-node-panel" onClick={() => setRightPane('node')}>节点配置</button></div>}
          <div id="ab-chat-panel" role="tabpanel" aria-labelledby="ab-chat-tab" hidden={mode !== 'advanced' || rightPane !== 'chat'}>
            <AgentDesignerChat key={`${draftKey}:${chatRevision}`} models={catalog.models} currentBlueprint={draft} disabled={disabled || mode !== 'advanced'} onConversationReset={() => setProposal(null)} onProposal={blueprint => { setProposal(blueprint); setNotice('AI 模块方案已准备好；采用前当前画布保持不变') }} />
            {proposal && <AgentBlueprintProposal blueprint={proposal} onDiscard={() => { setProposal(null); setNotice('已放弃 AI 方案，当前画布保持原样') }} onApply={applyProposal} />}
          </div>
        <section className="ab-editor" id="ab-node-panel" aria-label="模块配置" hidden={mode === 'advanced' && rightPane !== 'node'}>
          {selectedModuleId === 'start' ? <AgentInputEditor fields={draft.inputFields} onChange={fields => edit({ ...draft, inputFields: fields })} /> : selected ? <>
            <div className="ab-section-title"><h3>模块 {selectedIndex + 1} · 配置</h3><div className="ab-icon-actions"><Button variant="ghost" disabled={Boolean(draft.graph) || selectedIndex === 0} aria-label="上移当前模块" onClick={() => move(-1)}><ArrowUp size={16} /></Button><Button variant="ghost" disabled={Boolean(draft.graph) || selectedIndex === draft.modules.length - 1} aria-label="下移当前模块" onClick={() => move(1)}><ArrowDown size={16} /></Button><Button variant="ghost" aria-label="删除当前模块" onClick={removeModule}><Trash2 size={16} /></Button></div></div>
            <AgentNodeEditor module={selected} catalog={catalog} sources={inputSources} inputFields={draft.inputFields} onChange={editModule} />
            <AgentNodeDebug key={selected.id} module={selected} sources={inputSources} input={input} onInputChange={setInput} inputFields={draft.inputFields} variables={variables} onVariablesChange={setVariables} directSourceIds={draft.graph ? draft.graph.edges.filter(edge => edge.target === selected.id).map(edge => edge.source) : undefined} run={run} disabled={disabled} onRun={startNodeRun} />
          </> : <p className="ab-help">点击“添加模块”开始搭建。</p>}
        </section>
        </aside>
      </div>
      {(referenceProblem || inputProblem) && <p className="ab-error" role="alert">{referenceProblem || inputProblem}</p>}
      <section className="ab-testing" aria-label="Agent 试运行"><div className="ab-section-title"><h3><Play size={16} aria-hidden="true" />试运行</h3><span>使用当前草稿 · 模型节点会产生实际调用</span></div><AgentRunInputs fields={draft.inputFields} values={variables} onChange={setVariables} /><label className="ab-field"><span>试运行输入</span><textarea rows={3} maxLength={30000} value={input} onChange={event => setInput(event.target.value)} placeholder="输入一段真实样本，检查模块之间的传递效果" /></label><div className="ab-actions"><Button variant="secondary" disabled={!selected || (!input.trim() && !draft.inputFields?.length) || Boolean(referenceProblem || inputProblem)} onClick={() => startRun(selected?.id)}>运行至当前模块</Button><Button disabled={!draft.modules.length || (!input.trim() && !draft.inputFields?.length) || Boolean(referenceProblem || inputProblem)} onClick={() => startRun()}><Play size={15} />运行全部模块</Button></div></section>
      <footer className="ab-footer"><p>导出包含模块、模型引用、提示词、Skill 引用和输入映射。</p><div className="ab-actions"><Button variant="secondary" onClick={() => download('json')}><Download size={15} />导出 JSON</Button><Button variant="secondary" onClick={() => download('markdown')}>导出 Markdown</Button>{saved && <Button variant="danger" onClick={deleteSaved}>删除模板</Button>}</div></footer>
    </fieldset>
    {run && <AgentRunResults run={run} />}
  </section>
}


export function agentBlueprintRunNotice(run: AgentBlueprintRun) {
  const completion = run.status === 'failed' ? '试运行中断，请查看失败模块' : '试运行完成'
  return completion + (run.steps.some(step => step.fallback) ? '；部分节点使用了默认输出，请检查运行结果' : '')
}

export function AgentRunResults({ run }: { run: AgentBlueprintRun }) {
  return <section className="ab-results" aria-label="逐模块运行结果"><div className="ab-section-title"><h3>运行结果</h3><span>{run.status === 'succeeded' ? '已完成' : '执行失败'} · {(run.durationMs / 1000).toFixed(1)} 秒</span></div>{run.steps.map((step, index) => <details key={step.moduleId} open={step.status === 'failed'}><summary><span>{step.name}</span><span className={`ab-step-status ${step.status}`}>{step.status === 'succeeded' ? step.fallback ? '使用默认输出' : step.conditionMatched !== undefined ? step.conditionMatched ? '条件满足（真）' : '条件不满足（假）' : '完成' : step.status === 'skipped' ? run.steps.slice(0, index).some(item => item.status === 'failed') ? '前序失败 · 未执行' : '条件不满足 · 已跳过' : '失败'} · 尝试 {step.attempts ?? (step.status === 'skipped' ? 0 : 1)} 次</span></summary>{step.error && <p className="ab-error" role="alert">{step.error}</p>}<p className="ab-help">{(step.durationMs / 1000).toFixed(2)} 秒 · 尝试 {step.attempts ?? (step.status === 'skipped' ? 0 : 1)} 次{step.fallback ? ' · 使用失败默认输出' : ''}{step.conditionMatched !== undefined ? step.conditionMatched ? ' · 条件满足（真）' : ' · 条件不满足（假）' : ''}</p><h4>实际输入</h4><pre>{step.input || '（空）'}</pre><h4>模块输出</h4><pre>{step.output || '（无输出）'}</pre></details>)}{run.output && <div className="ab-final-output"><h4>{run.status === 'failed' ? '最后有效输出（流程未完成）' : '最终输出'}</h4><pre>{run.output}</pre></div>}</section>
}

export function AgentBlueprintProposal({ blueprint, onApply, onDiscard }: { blueprint: AgentBlueprint; onApply: () => void; onDiscard: () => void }) {
  return <section className="ab-ai-proposal" aria-label="AI 搭建方案预览">
    <h4>{blueprint.name} · {blueprint.modules.length} 个模块</h4><p>{blueprint.description}</p>
    <ol>{blueprint.modules.map(module => <li key={module.id}><details><summary>{module.name}</summary><p>{module.prompt}</p><pre>{module.inputTemplate}</pre><p>输出格式：{module.outputFormat}</p></details></li>)}</ol>
    <p>采用会替换当前 Agent 草稿（含名称、说明、输入字段、模块与连线）；可以撤销，保存前不会更新已有模板。</p>
    <div className="ab-actions"><Button variant="secondary" onClick={onDiscard}>保留原画布，放弃方案</Button><Button onClick={onApply}>采用方案并替换画布</Button></div>
  </section>
}
