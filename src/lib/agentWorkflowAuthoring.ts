import type { AgentBlueprint, AgentBlueprintModule } from '../../server/src/contracts/agentBlueprintContract'

export const WORKFLOW_NODE_CATALOG = [
  { kind: 'llm', name: '模型处理', group: '模型', description: '选择模型、提示词与 Skill，处理上游输入' },
  { kind: 'template', name: '模板转换', group: '数据', description: '插入变量与上游结果，确定性生成文本' },
  { kind: 'json-extract', name: 'JSON 字段提取', group: '数据', description: '按字段路径读取 JSON，无需模型调用' },
  { kind: 'aggregate', name: '变量聚合', group: '数据', description: '收敛互斥分支，或按顺序拼接多个来源' },
  { kind: 'text-process', name: '文本处理', group: '数据', description: '去除空格、替换、截取及大小写转换' },
  { kind: 'condition', name: '条件判断', group: '流程', description: '组合判断规则，选择真或假执行路径' },
  { kind: 'output', name: '最终输出', group: '流程', description: '指定流程返回的内容与格式' },
] as const
export type WorkflowNodeKind = typeof WORKFLOW_NODE_CATALOG[number]['kind']
export const workflowNodeName = (kind: AgentBlueprintModule['kind']) => WORKFLOW_NODE_CATALOG.find(node => node.kind === (kind ?? 'llm'))?.name ?? '节点'

export function createWorkflowModule(kind: WorkflowNodeKind, modelId = '', id = `module_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`): AgentBlueprintModule {
  return {
    id, kind, name: workflowNodeName(kind), modelId: kind === 'llm' ? modelId : '', prompt: '',
    inputTemplate: '{{previous}}', skillIds: [], outputFormat: kind === 'json-extract' ? 'json' : 'markdown', outputInstructions: '',
    ...(kind === 'condition' ? { condition: { source: 'previous', operator: 'not_empty', value: '' } as const } : {}),
    ...(kind === 'json-extract' ? { jsonExtract: { path: '', missing: 'error' } as const } : {}),
    ...(kind === 'aggregate' ? { aggregate: { sources: ['previous'], mode: 'first-non-empty' as const, separator: '\n\n' } } : {}),
    ...(kind === 'text-process' ? { textProcess: { operation: 'trim' } as const } : {}),
  }
}

export function duplicateWorkflowModule(blueprint: AgentBlueprint, moduleId: string, copyId = `module_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`): AgentBlueprint {
  const index = blueprint.modules.findIndex(module => module.id === moduleId)
  if (index < 0) throw new Error('选中的节点不存在')
  if (blueprint.modules.length >= 12) throw new Error('每个 Agent 最多支持 12 个节点')
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(copyId) || ['start', 'input', 'inputs', 'modules', 'previous'].includes(copyId) || blueprint.modules.some(module => module.id === copyId)) throw new Error('副本节点 ID 无效或重复')
  const original = blueprint.modules[index]
  const copy = { ...structuredClone(original), id: copyId, name: `${original.name.slice(0, 97)} 副本` }
  if (!blueprint.graph) return { ...blueprint, modules: [...blueprint.modules.slice(0, index + 1), copy, ...blueprint.modules.slice(index + 1)] }
  const position = blueprint.graph.positions[moduleId] ?? { x: 394, y: 140 }
  return { ...blueprint, modules: [...blueprint.modules, copy], graph: { ...blueprint.graph, positions: { ...blueprint.graph.positions, [copyId]: { x: Math.min(100000, position.x + 48), y: Math.min(100000, position.y + 200) } } } }
}
