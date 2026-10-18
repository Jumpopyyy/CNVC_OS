import type { AgentBlueprint, AgentBlueprintEdge, AgentBlueprintModule } from './agentBlueprintContract.js'

/** Browser-safe graph semantics shared by the editor and runtime. No code or tools execute here. */
export function getAgentBlueprintEdges(blueprint: AgentBlueprint): AgentBlueprintEdge[] {
  return blueprint.graph?.edges ?? blueprint.modules.map((module, index) => ({ id: `sequence-${module.id}`, source: index ? blueprint.modules[index - 1].id : 'start', target: module.id }))
}
export function getAgentBlueprintAncestors(blueprint: AgentBlueprint, id: string): Set<string> {
  const edges = getAgentBlueprintEdges(blueprint)
  const visit = (pending: string[], visited: Set<string>): Set<string> => {
    if (!pending.length) return visited
    const [current, ...rest] = pending
    if (visited.has(current)) return visit(rest, visited)
    return visit([...rest, ...edges.filter((edge) => edge.target === current).map((edge) => edge.source)], new Set([...visited, current]))
  }
  const found = visit(edges.filter((edge) => edge.target === id).map((edge) => edge.source), new Set())
  found.delete('start'); return found
}
/** Returns a human-readable validation error, so incomplete editor drafts can remain editable. */
export function getAgentBlueprintGraphError(blueprint: AgentBlueprint): string | null {
  const ids = blueprint.modules.map((module) => module.id)
  if (new Set(ids).size !== ids.length || ids.some((id) => ['start', 'input', 'previous'].includes(id))) return '模块 ID 重复或使用了保留名称'
  if (!blueprint.graph) return null
  const edges = blueprint.graph.edges
  if (new Set(edges.map((edge) => edge.id)).size !== edges.length) return '连线 ID 不可重复'
  if (new Set(edges.map((edge) => `${edge.source}/${edge.target}/${edge.branch ?? ''}`)).size !== edges.length) return '连线不可重复'
  for (const edge of edges) {
    if (!(edge.source === 'start' || ids.includes(edge.source)) || !ids.includes(edge.target) || edge.source === edge.target) return '连线端点无效'
    const source = blueprint.modules.find((module) => module.id === edge.source)
    if (source?.kind === 'output') return '输出节点必须是终点'
    if (source?.kind === 'condition' ? !edge.branch : Boolean(edge.branch)) return '判断节点需连接真或假分支，其他节点不可指定分支'
  }
  for (const module of blueprint.modules) {
    const outgoing = edges.filter((edge) => edge.source === module.id)
    if (module.kind === 'condition' && (outgoing.length !== 2 || new Set(outgoing.map((edge) => edge.branch)).size !== 2)) return '判断节点需要真、假两个分支'
  }
  const visited = new Set(['start'])
  for (let pass = 0; pass <= ids.length; pass++) for (const edge of edges) if (visited.has(edge.source)) visited.add(edge.target)
  if (ids.some((id) => !visited.has(id))) return '所有节点必须连接到开始节点'
  const remaining = new Set(ids)
  for (let pass = 0; pass < ids.length; pass++) for (const id of remaining) if (edges.filter((edge) => edge.target === id).every((edge) => !remaining.has(edge.source))) remaining.delete(id)
  return remaining.size ? '流程存在循环，请使用有向无环连线' : null
}
export function getAgentBlueprintExecutionModules(blueprint: AgentBlueprint, throughModuleId?: string): AgentBlueprintModule[] {
  if (throughModuleId && !blueprint.modules.some((module) => module.id === throughModuleId)) throw new Error('试跑模块不存在')
  const selected = throughModuleId ? new Set([...getAgentBlueprintAncestors(blueprint, throughModuleId), throughModuleId]) : new Set(blueprint.modules.map((module) => module.id))
  const edges = getAgentBlueprintEdges(blueprint)
  const ordered: AgentBlueprintModule[] = []
  const remaining = blueprint.modules.filter((module) => selected.has(module.id))
  while (remaining.length) {
    const index = remaining.findIndex((module) => edges.filter((edge) => edge.target === module.id).every((edge) => !remaining.some((candidate) => candidate.id === edge.source)))
    if (index === -1) throw new Error('流程存在循环')
    ordered.push(remaining[index]); remaining.splice(index, 1)
  }
  return ordered
}
