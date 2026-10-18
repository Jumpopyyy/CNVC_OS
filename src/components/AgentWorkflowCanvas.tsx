import React, { useId, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Copy, GitBranch, GripVertical, Layers3, Maximize2, Minus, Plus, RotateCcw, Search, Trash2 } from 'lucide-react'
import type { AgentBlueprint, AgentBlueprintEdge, AgentBlueprintGraph, AgentBlueprintModule, AgentBlueprintRun } from '../../server/src/contracts/agentBlueprintContract'
import { getAgentBlueprintGraphError } from '../../server/src/contracts/agentBlueprintGraph'
import { WORKFLOW_NODE_CATALOG, createWorkflowModule, duplicateWorkflowModule, workflowNodeName, type WorkflowNodeKind } from '../lib/agentWorkflowAuthoring'
import './AgentWorkflowCanvas.css'

type Point = { x: number; y: number }
type Branch = 'true' | 'false'
const nodeWidth = 244
const nodeHeight = 154
const point = (x: number, y: number): Point => ({ x: Math.min(100000, Math.max(24, x)), y: Math.min(100000, Math.max(24, y)) })
const kindLabel = (module: AgentBlueprintModule) => workflowNodeName(module.kind)

export type AgentWorkflowCanvasProps = {
  blueprint: AgentBlueprint
  onChange: (next: AgentBlueprint) => void
  selectedModuleId: string
  onSelectModule: (id: string) => void
  disabled?: boolean
  run?: AgentBlueprintRun | null
  defaultModelId?: string
  modelNames?: Record<string, string>
}

export function createSequentialGraph(modules: AgentBlueprintModule[]): AgentBlueprintGraph {
  return {
    edges: modules.map((module, index) => ({
      id: `edge_${index}_${module.id}`, source: index ? modules[index - 1].id : 'start', target: module.id,
      ...(index && modules[index - 1].kind === 'condition' ? { branch: 'true' as const } : {}),
    })),
    positions: Object.fromEntries(['start', ...modules.map(module => module.id)].map((id, index) => [id, { x: 64 + index * 330, y: 140 }])),
  }
}

export function arrangeWorkflowGraph(modules: AgentBlueprintModule[], graph: AgentBlueprintGraph): AgentBlueprintGraph {
  const depth = (id: string, seen = new Set<string>()): number => {
    if (id === 'start' || seen.has(id)) return 0
    const parents = graph.edges.filter(edge => edge.target === id)
    return parents.length ? 1 + Math.max(...parents.map(edge => depth(edge.source, new Set([...seen, id])))) : 1
  }
  const rows = new Map<number, number>()
  const positions = Object.fromEntries(['start', ...modules.map(module => module.id)].map(id => {
    const column = depth(id)
    const row = rows.get(column) ?? 0
    rows.set(column, row + 1)
    return [id, { x: 64 + column * 330, y: 100 + row * 218 }]
  }))
  return { ...graph, positions }
}

export function workflowConnectionProblem(blueprint: AgentBlueprint, source: string, target: string, branch?: Branch): string {
  const graph = blueprint.graph ?? createSequentialGraph(blueprint.modules)
  const sourceModule = blueprint.modules.find(module => module.id === source)
  if ((source !== 'start' && !sourceModule) || !blueprint.modules.some(module => module.id === target)) return '连线节点不存在，请重新选择。'
  if (sourceModule?.kind === 'output') return '输出节点不能连接到后续节点。'
  if (sourceModule?.kind === 'condition' && !branch) return '请选择条件节点的真或假分支。'
  if (sourceModule?.kind !== 'condition' && branch) return '只有条件节点可以选择真或假分支。'
  if (graph.edges.some(edge => edge.source === source && edge.target === target && edge.branch === branch)) return '这条连线已存在。'
  if (branch && graph.edges.some(edge => edge.source === source && edge.branch === branch)) return '这个条件分支已有连线，请先删除原连线。'
  const reachable = (id: string, visited = new Set<string>()): boolean => {
    if (id === source) return true
    if (visited.has(id)) return false
    return graph.edges.filter(edge => edge.source === id).some(edge => reachable(edge.target, new Set([...visited, id])))
  }
  return reachable(target) ? '这条连线会形成循环，请连接到后续节点。' : ''
}

export function removeWorkflowModule(blueprint: AgentBlueprint, id: string): AgentBlueprint {
  const graph = blueprint.graph ?? createSequentialGraph(blueprint.modules)
  return {
    ...blueprint,
    modules: blueprint.modules.filter(module => module.id !== id),
    graph: { edges: graph.edges.filter(edge => edge.source !== id && edge.target !== id), positions: Object.fromEntries(Object.entries(graph.positions).filter(([key]) => key !== id)) },
  }
}

type Gesture = { pointerId: number; start: Point; origin: Point; moduleId?: string; moved: boolean }

export function AgentWorkflowCanvas({ blueprint, onChange, selectedModuleId, onSelectModule, disabled = false, run, defaultModelId = '', modelNames = {} }: AgentWorkflowCanvasProps) {
  const fallback = createSequentialGraph(blueprint.modules)
  const graph: AgentBlueprintGraph = { ...(blueprint.graph ?? fallback), positions: { ...fallback.positions, ...blueprint.graph?.positions } }
  const viewport = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(0.85)
  const [dragging, setDragging] = useState<{ id: string; position: Point } | null>(null)
  const [connecting, setConnecting] = useState<{ source: string; branch?: Branch } | null>(null)
  const [selectedEdge, setSelectedEdge] = useState('')
  const [formSource, setFormSource] = useState('start')
  const [formTarget, setFormTarget] = useState('')
  const [formBranch, setFormBranch] = useState<Branch>('true')
  const [error, setError] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [nodeSearch, setNodeSearch] = useState('')
  const [notice, setNotice] = useState('')
  const markerId = useId().replaceAll(':', '')
  const selected = blueprint.modules.find(module => module.id === selectedModuleId)
  const selectedName = selectedModuleId === 'start' ? '开始' : selected?.name
  const sourceOptions = [{ id: 'start', name: '开始' }, ...blueprint.modules.filter(module => module.kind !== 'output')]
  const source = sourceOptions.some(module => module.id === formSource) ? formSource : 'start'
  const target = blueprint.modules.some(module => module.id === formTarget) ? formTarget : blueprint.modules[0]?.id ?? ''
  const graphError = getAgentBlueprintGraphError({ ...blueprint, graph })
  const positionOf = (id: string) => dragging?.id === id ? dragging.position : graph.positions[id] ?? { x: 64, y: 140 }
  const worldWidth = Math.max(1400, ...Object.values(graph.positions).map(position => position.x + 400))
  const worldHeight = Math.max(700, ...Object.values(graph.positions).map(position => position.y + 260))

  function updateGraph(next: AgentBlueprintGraph) {
    if (!disabled) { onChange({ ...blueprint, graph: next }); setError('') }
  }
  function moveNode(id: string, delta: Point) {
    const current = graph.positions[id]
    if (current) updateGraph({ ...graph, positions: { ...graph.positions, [id]: point(current.x + delta.x, current.y + delta.y) } })
  }
  function connect(from: string, to: string, branch?: Branch) {
    if (disabled) return
    const problem = workflowConnectionProblem(blueprint, from, to, branch)
    if (problem) { setError(problem); return }
    if (graph.edges.length >= 40) { setError('每个 Agent 最多支持 40 条连线，请先精简现有流程。'); return }
    updateGraph({ ...graph, edges: [...graph.edges, { id: `edge_${crypto.randomUUID()}`, source: from, target: to, ...(branch ? { branch } : {}) }] })
    setConnecting(null)
  }
  function addModule(kind: WorkflowNodeKind) {
    if (disabled) return
    if (blueprint.modules.length >= 12) { setError('每个 Agent 最多支持 12 个节点，请先精简现有流程。'); return }
    const id = `module_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
    const module = createWorkflowModule(kind, defaultModelId, id)
    const from = selected && selected.kind !== 'output' ? selected.id : 'start'
    const branch = selected?.id === from && selected.kind === 'condition'
      ? (['true', 'false'] as const).find(value => !graph.edges.some(edge => edge.source === from && edge.branch === value)) : undefined
    const canAttach = selected?.id !== from || selected.kind !== 'condition' || Boolean(branch)
    if (canAttach && graph.edges.length >= 40) { setError('每个 Agent 最多支持 40 条连线，请先精简现有流程。'); return }
    const origin = graph.positions[from] ?? graph.positions.start
    const nextGraph: AgentBlueprintGraph = {
      edges: canAttach ? [...graph.edges, { id: `edge_${crypto.randomUUID()}`, source: from, target: id, ...(branch ? { branch } : {}) }] : graph.edges,
      positions: { ...graph.positions, [id]: point(origin.x + 330, origin.y + graph.edges.filter(edge => edge.source === from).length * 218) },
    }
    onChange({ ...blueprint, modules: [...blueprint.modules, module], graph: nextGraph })
    onSelectModule(id)
    setError(''); setNotice(''); setPaletteOpen(false)
  }
  function duplicateSelectedNode() {
    if (!selected || disabled) return
    try {
      const next = duplicateWorkflowModule(blueprint, selected.id)
      const copy = next.modules.find(module => !blueprint.modules.some(previous => previous.id === module.id))!
      onChange(next); onSelectModule(copy.id); setError(''); setNotice(next.graph ? '已复制节点配置。请为副本连接输入和后续路径，再保存或运行。' : '已复制节点并插入顺序流程，可单独编辑。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '复制节点失败') }
  }
  function deleteSelectedNode() {
    if (!selected || disabled) return
    const next = removeWorkflowModule(blueprint, selected.id)
    onChange(next)
    onSelectModule(next.modules[0]?.id ?? 'start')
    setSelectedEdge('')
    setConnecting(null)
  }
  function beginGesture(event: React.PointerEvent, moduleId?: string) {
    if (event.button !== 0 || (moduleId && disabled)) return
    // Buttons may render an SVG at their click center; keep view/edge controls out of pan gestures.
    if (!moduleId && event.target instanceof Element && event.target.closest('button, [role="button"], select, input, textarea')) return
    if (!moduleId && event.target !== event.currentTarget && !(event.target instanceof SVGSVGElement)) return
    event.preventDefault()
    event.stopPropagation()
    if (moduleId && event.currentTarget instanceof HTMLElement) event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: moduleId ? positionOf(moduleId) : pan, moduleId, moved: false }
    if (moduleId) onSelectModule(moduleId)
  }
  function moveGesture(event: React.PointerEvent) {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    const delta = { x: event.clientX - current.start.x, y: event.clientY - current.start.y }
    if (Math.abs(delta.x) + Math.abs(delta.y) > 3) current.moved = true
    if (current.moduleId) setDragging({ id: current.moduleId, position: point(current.origin.x + delta.x / zoom, current.origin.y + delta.y / zoom) })
    else setPan({ x: current.origin.x + delta.x, y: current.origin.y + delta.y })
  }
  function endGesture(event: React.PointerEvent, cancelled = false) {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    if (!cancelled && current.moduleId && current.moved) {
      const position = point(current.origin.x + (event.clientX - current.start.x) / zoom, current.origin.y + (event.clientY - current.start.y) / zoom)
      updateGraph({ ...graph, positions: { ...graph.positions, [current.moduleId]: position } })
    }
    gesture.current = null
    setDragging(null)
  }
  function nodeKey(event: React.KeyboardEvent, id: string) {
    const directions: Record<string, Point> = { ArrowLeft: { x: -24, y: 0 }, ArrowRight: { x: 24, y: 0 }, ArrowUp: { x: 0, y: -24 }, ArrowDown: { x: 0, y: 24 } }
    if (directions[event.key]) { event.preventDefault(); moveNode(id, directions[event.key]) }
  }
  function fitCanvas() {
    const rect = viewport.current?.getBoundingClientRect()
    if (!rect) return
    const positions = Object.values(graph.positions)
    const maxX = Math.max(...positions.map(position => position.x + nodeWidth), 400)
    const maxY = Math.max(...positions.map(position => position.y + nodeHeight), 300)
    setZoom(Math.min(1, Math.max(0.05, Math.min((rect.width - 50) / maxX, (rect.height - 50) / maxY))))
    setPan({ x: 20, y: 20 })
  }
  function edgeStatus(edge: AgentBlueprintEdge) {
    const targetStep = run?.steps.find(step => step.moduleId === edge.target)
    const sourceStep = run?.steps.find(step => step.moduleId === edge.source)
    return targetStep?.status === 'succeeded' && (edge.source === 'start' || sourceStep?.status === 'succeeded') ? 'succeeded' : targetStep?.status ?? ''
  }

  return <section className="aw-canvas" aria-label="节点画布">
    <div className="aw-toolbar">
      <div className="aw-toolbar-title"><Layers3 size={17} aria-hidden="true" /><strong>节点画布</strong><span>{blueprint.modules.length} 个节点 · {graph.edges.length} 条连线</span></div>
      <div className="aw-toolbar-actions">
        <button type="button" disabled={disabled} onClick={() => addModule('llm')}><Plus size={15} aria-hidden="true" />添加模型节点</button>
        <button type="button" disabled={disabled} onClick={() => addModule('condition')}><GitBranch size={15} aria-hidden="true" />添加条件节点</button>
        <button type="button" disabled={disabled} onClick={() => addModule('output')}><Plus size={15} aria-hidden="true" />添加输出节点</button>
        <button type="button" aria-expanded={paletteOpen} disabled={disabled} onClick={() => setPaletteOpen(value => !value)}><Plus size={15} aria-hidden="true" />更多处理节点</button>
        <button type="button" disabled={disabled} onClick={() => { updateGraph(arrangeWorkflowGraph(blueprint.modules, graph)); setPan({ x: 0, y: 0 }) }}><RotateCcw size={15} aria-hidden="true" />自动排列</button>
      </div>
    </div>
    {paletteOpen && <section className="aw-palette" aria-label="可添加的节点类型"><label className="aw-node-search"><Search size={16} aria-hidden="true" /><input aria-label="搜索节点类型" value={nodeSearch} onChange={event => setNodeSearch(event.target.value)} placeholder="搜索模型、模板、JSON、聚合…" /></label><div className="aw-palette-grid">{WORKFLOW_NODE_CATALOG.filter(node => `${node.name} ${node.description}`.toLowerCase().includes(nodeSearch.trim().toLowerCase())).map(node => <button type="button" disabled={disabled} key={node.kind} onClick={() => addModule(node.kind)}><span>{node.group}</span><strong>{node.name}</strong><small>{node.description}</small></button>)}</div></section>}
    {notice && <p className="aw-notice" role="status">{notice}</p>}
    <div className="aw-hint">拖动节点标题移动，或选中后用方向键移动。点击右侧端口，再点击目标节点左侧端口连线。聚焦画布空白处后可用方向键平移。</div>
    {(error || graphError) && <p className={`aw-message ${error ? 'aw-error' : ''}`} role={error ? 'alert' : 'status'}>{error || graphError}</p>}
    {connecting && <div className="aw-connecting" role="status">正在连接 {connecting.source === 'start' ? '开始' : blueprint.modules.find(module => module.id === connecting.source)?.name}{connecting.branch ? ` · ${connecting.branch === 'true' ? '真' : '假'}分支` : ''}，请选择目标节点。<button type="button" onClick={() => setConnecting(null)}>取消连线</button></div>}
    <div className="aw-viewport" ref={viewport} tabIndex={0} role="region" aria-label="工作流画布，聚焦后方向键平移" onPointerDown={event => beginGesture(event)} onPointerMove={moveGesture} onPointerUp={event => endGesture(event)} onPointerCancel={event => endGesture(event, true)} onKeyDown={event => {
      if (event.key === 'Escape') { setConnecting(null); setSelectedEdge('') }
      const deltas: Record<string, Point> = { ArrowLeft: { x: 60, y: 0 }, ArrowRight: { x: -60, y: 0 }, ArrowUp: { x: 0, y: 60 }, ArrowDown: { x: 0, y: -60 } }
      if (event.target === event.currentTarget && deltas[event.key]) { event.preventDefault(); const delta = deltas[event.key]; setPan(value => ({ x: value.x + delta.x, y: value.y + delta.y })) }
    }}>
      <div className="aw-world" style={{ width: worldWidth, height: worldHeight, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} onPointerDown={event => beginGesture(event)}>
        <svg className="aw-edges" width={worldWidth} height={worldHeight} aria-label="工作流连线">
          <defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="context-stroke" /></marker></defs>
          {graph.edges.map(edge => {
            const from = positionOf(edge.source), to = positionOf(edge.target)
            const sourceY = from.y + (edge.branch === 'true' ? 64 : edge.branch === 'false' ? 112 : 80)
            const targetY = to.y + 80
            const startX = from.x + nodeWidth, endX = to.x
            const bend = Math.max(70, Math.abs(endX - startX) / 2)
            const path = `M ${startX} ${sourceY} C ${startX + bend} ${sourceY}, ${endX - bend} ${targetY}, ${endX} ${targetY}`
            const label = `${edge.source === 'start' ? '开始' : blueprint.modules.find(module => module.id === edge.source)?.name ?? edge.source} → ${blueprint.modules.find(module => module.id === edge.target)?.name ?? edge.target}${edge.branch ? `（${edge.branch === 'true' ? '真' : '假'}）` : ''}`
            return <g key={edge.id} className={`aw-edge ${edgeStatus(edge)} ${selectedEdge === edge.id ? 'selected' : ''}`}><path className="aw-edge-visible" d={path} markerEnd={`url(#${markerId})`} /><path className="aw-edge-hit" d={path} role="button" aria-label={`选择连线 ${label}`} tabIndex={disabled ? -1 : 0} onClick={() => setSelectedEdge(edge.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedEdge(edge.id) } if ((event.key === 'Delete' || event.key === 'Backspace') && !disabled) { event.preventDefault(); updateGraph({ ...graph, edges: graph.edges.filter(item => item.id !== edge.id) }) } }} /></g>
          })}
        </svg>
        {['start', ...blueprint.modules.map(module => module.id)].map((id, index) => {
          const module = blueprint.modules.find(item => item.id === id)
          const kind = module?.kind ?? (id === 'start' ? 'start' : 'llm')
          const position = positionOf(id)
          const status = run?.steps.find(step => step.moduleId === id)?.status
          return <div key={id} className={`aw-node aw-kind-${kind} ${selectedModuleId === id ? 'selected' : ''} ${status ? `aw-status-${status}` : ''}`} style={{ left: position.x, top: position.y, width: nodeWidth }}>
            <button type="button" className="aw-node-title" disabled={disabled} aria-pressed={selectedModuleId === id} aria-label={`${id === 'start' ? '开始' : module?.name}，方向键移动`} onPointerDown={event => beginGesture(event, id)} onKeyDown={event => nodeKey(event, id)} onClick={() => { onSelectModule(id); setSelectedEdge('') }}><span className="aw-node-icon" aria-hidden="true">{kind === 'condition' ? <GitBranch size={18} /> : kind === 'start' || kind === 'output' ? <ArrowRight size={18} /> : <Layers3 size={18} />}</span><span>{id === 'start' ? '开始' : module?.name}</span><GripVertical size={15} className="aw-drag-icon" aria-hidden="true" /></button>
            <div className="aw-node-body"><span className="aw-node-type">{module ? `${String(index).padStart(2, '0')} / ${kindLabel(module)}` : '工作流输入'}</span><p>{id === 'start' ? blueprint.inputFields?.length ? `${blueprint.inputFields.length} 个可编辑输入：${blueprint.inputFields.map(field => field.label).join('、')}` : '点击配置自定义输入字段与默认值' : kind === 'condition' ? '按规则分流到真 / 假分支' : kind === 'output' ? '汇总前序内容，作为最终结果' : kind === 'template' ? module?.inputTemplate.slice(0, 75) || '点击编辑文本模板' : kind === 'json-extract' ? `读取 JSON 路径：${module?.jsonExtract?.path || '根对象'}` : kind === 'aggregate' ? `${module?.aggregate?.mode === 'concat' ? '按顺序拼接' : '取首个非空'}：${module?.aggregate?.sources.join('、') ?? '选择来源'}` : kind === 'text-process' ? `文本操作：${({trim:'去除首尾空格',uppercase:'转大写',lowercase:'转小写',replace:'文本替换',slice:'截取文本'} as const)[module?.textProcess?.operation ?? 'trim']}` : module?.prompt.trim() ? module.prompt.slice(0, 75) : '选择节点，配置模型与提示词'}</p><div className="aw-node-meta">{kind === 'llm' ? <span title={module?.modelId ? modelNames[module.modelId] ?? module.modelId : undefined}>{module?.modelId ? modelNames[module.modelId] ?? '已配置模型' : '待选择模型'}{module?.skillIds.length ? ` · ${module.skillIds.length} Skill` : ''}</span> : <span>{kind === 'condition' ? 'IF / ELSE' : kind === 'start' ? '可编辑输入' : kind === 'output' ? module?.outputFormat.toUpperCase() : '无需模型'}</span>}{status && <span className="aw-run-label">{status === 'succeeded' ? run?.steps.find(step => step.moduleId === id)?.fallback ? '⚑ 使用默认输出' : '✓ 已完成' : status === 'failed' ? '× 失败' : '− 已跳过'}</span>}</div></div>
            {id !== 'start' && <button type="button" className={`aw-port aw-input ${connecting ? 'aw-port-ready' : ''}`} disabled={disabled || !connecting} aria-label={`连接到 ${module?.name}`} title={`输入端口：${module?.name}`} onClick={() => { if (connecting) connect(connecting.source, id, connecting.branch) }} />}
            {kind !== 'output' && (kind === 'condition' ? (['true', 'false'] as const).map(branch => <button type="button" key={branch} className={`aw-port aw-output aw-branch-${branch} ${connecting?.source === id && connecting.branch === branch ? 'aw-port-active' : ''}`} disabled={disabled} aria-label={`从 ${module?.name} 的${branch === 'true' ? '真' : '假'}分支连线`} title={`${branch === 'true' ? '真' : '假'}分支输出`} onClick={() => setConnecting({ source: id, branch })}><span>{branch === 'true' ? '真' : '假'}</span></button>) : <button type="button" className={`aw-port aw-output ${connecting?.source === id ? 'aw-port-active' : ''}`} disabled={disabled} aria-label={`从 ${id === 'start' ? '开始' : module?.name} 连线`} title="点击后选择目标输入端口" onClick={() => setConnecting({ source: id })} />)}
          </div>
        })}
      </div>
      {!blueprint.modules.length && <div className="aw-empty"><Layers3 size={28} aria-hidden="true" /><strong>从一个节点开始搭建</strong><p>添加模型处理、条件判断，再连接最终输出。</p><button type="button" disabled={disabled} onClick={() => addModule('llm')}>添加第一个模型节点</button></div>}
      <div className="aw-zoom" aria-label="画布视图"><button type="button" aria-label="缩小画布" onClick={() => setZoom(value => Math.max(0.05, value - 0.1))}><Minus size={16} /></button><span aria-live="polite">{Math.round(zoom * 100)}%</span><button type="button" aria-label="放大画布" onClick={() => setZoom(value => Math.min(1.6, value + 0.1))}><Plus size={16} /></button><button type="button" aria-label="适应画布" onClick={fitCanvas}><Maximize2 size={16} /></button><button type="button" aria-label="重置画布视图" onClick={() => { setPan({ x: 0, y: 0 }); setZoom(0.85) }}><RotateCcw size={16} /></button></div>
    </div>
    <div className="aw-selection-tools"><span>{selectedName ? `已选中：${selectedName}` : '点击节点编辑配置 · 拖动画布空白处平移'}</span><div className="aw-node-move" aria-label="移动选中节点">{([{ name: '向左', delta: { x: -48, y: 0 }, Icon: ArrowLeft }, { name: '向右', delta: { x: 48, y: 0 }, Icon: ArrowRight }, { name: '向上', delta: { x: 0, y: -48 }, Icon: ArrowUp }, { name: '向下', delta: { x: 0, y: 48 }, Icon: ArrowDown }]).map(({ name, delta, Icon }) => <button type="button" key={name} title={`移动选中节点${name}`} aria-label={`移动选中节点${name}`} disabled={disabled || !selectedName} onClick={() => selectedName && moveNode(selectedModuleId, delta)}><Icon size={15} /></button>)}<button type="button" disabled={disabled || !selected} onClick={duplicateSelectedNode} aria-label="复制选中节点"><Copy size={15} aria-hidden="true" />复制节点</button><button type="button" disabled={disabled || !selected} onClick={deleteSelectedNode} aria-label="删除选中节点"><Trash2 size={15} aria-hidden="true" />删除节点</button></div></div>
    <details className="aw-connections"><summary>表单连线 <span>无需拖动，支持键盘操作 · {graph.edges.length} 条连接</span></summary><div className="aw-connect-form"><label>起点<select disabled={disabled} value={source} onChange={event => setFormSource(event.target.value)}>{sourceOptions.map(module => <option key={module.id} value={module.id}>{module.name}</option>)}</select></label>{blueprint.modules.find(module => module.id === source)?.kind === 'condition' && <label>条件分支<select disabled={disabled} value={formBranch} onChange={event => setFormBranch(event.target.value as Branch)}><option value="true">真 · 条件成立</option><option value="false">假 · 条件不成立</option></select></label>}<label>终点<select disabled={disabled || !blueprint.modules.length} value={target} onChange={event => setFormTarget(event.target.value)}>{!blueprint.modules.length && <option value="">先添加节点</option>}{blueprint.modules.map(module => <option key={module.id} value={module.id}>{module.name}</option>)}</select></label><button type="button" disabled={disabled || !target} onClick={() => connect(source, target, blueprint.modules.find(module => module.id === source)?.kind === 'condition' ? formBranch : undefined)}>创建连线</button></div><ul className="aw-edge-list">{graph.edges.map(edge => <li key={edge.id} className={selectedEdge === edge.id ? 'selected' : ''}><span>{edge.source === 'start' ? '开始' : blueprint.modules.find(module => module.id === edge.source)?.name ?? edge.source}{edge.branch ? ` · ${edge.branch === 'true' ? '真' : '假'}` : ''}<ArrowRight size={14} aria-hidden="true" />{blueprint.modules.find(module => module.id === edge.target)?.name ?? edge.target}</span><button type="button" disabled={disabled} aria-label={`删除连线 ${edge.source} 到 ${edge.target}`} onClick={() => { updateGraph({ ...graph, edges: graph.edges.filter(item => item.id !== edge.id) }); setSelectedEdge('') }}><Trash2 size={14} aria-hidden="true" />删除</button></li>)}</ul></details>
    {selectedEdge && <div className="aw-selected-edge" role="status">已选择连线<button type="button" disabled={disabled} onClick={() => { updateGraph({ ...graph, edges: graph.edges.filter(edge => edge.id !== selectedEdge) }); setSelectedEdge('') }}><Trash2 size={15} aria-hidden="true" />删除选中连线</button><button type="button" onClick={() => setSelectedEdge('')}>取消选择</button></div>}
  </section>
}
