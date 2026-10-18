import { agentGenerationInstructions } from './agentDesignerPrompts.js'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AgentBlueprint, AgentBlueprintCondition, AgentBlueprintModule, AgentBlueprintRun, AgentBlueprintExport, AgentBlueprintCatalog, AgentBlueprintNodeContext } from '../contracts/agentBlueprintContract.js'
import { getAgentBlueprintAncestors, getAgentBlueprintEdges, getAgentBlueprintExecutionModules, getAgentBlueprintGraphError } from '../contracts/agentBlueprintGraph.js'
import { agentJsonPath, agentSourceValue, executeAgentManualModule, joinAgentBlueprintText, resolveAgentBlueprintVariables, safeAgentInputName, testAgentCondition } from '../contracts/agentBlueprintManual.js'
import type { AiCapabilityActor } from './aiCapabilityService.js'

const conditionSchema = z.object({ source: z.string().min(1).max(55), operator: z.enum(['contains', 'not_contains', 'equals', 'not_equals', 'empty', 'not_empty', 'gt', 'gte', 'lt', 'lte']), value: z.string().max(1_000) }).strict()
const moduleSchema = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,47}$/), name: z.string().trim().min(1).max(100),
  kind: z.enum(['llm', 'condition', 'output', 'template', 'json-extract', 'aggregate', 'text-process']).optional(),
  modelId: z.union([z.string().uuid(), z.literal('')]), prompt: z.string().max(16_000),
  inputTemplate: z.string().max(16_000), skillIds: z.array(z.string().uuid()).max(4),
  outputFormat: z.enum(['text', 'markdown', 'json']), outputInstructions: z.string().max(4_000),
  condition: conditionSchema.optional(),
  conditionGroup: z.object({ mode: z.enum(['and', 'or']), rules: z.array(conditionSchema).min(1).max(8) }).strict().optional(),
  modelOptions: z.object({ temperature: z.number().finite().min(0).max(2).optional(), maxTokens: z.number().int().min(1).max(16_000).optional() }).strict().optional(),
  jsonExtract: z.object({ path: z.string().max(256), missing: z.enum(['empty', 'error']) }).strict().optional(),
  aggregate: z.object({ sources: z.array(z.string().min(1).max(55)).min(1).max(12), mode: z.enum(['first-non-empty', 'concat']), separator: z.string().max(1_000) }).strict().optional(),
  textProcess: z.object({ operation: z.enum(['trim', 'uppercase', 'lowercase', 'replace', 'slice']), search: z.string().max(4_000).optional(), replacement: z.string().max(16_000).optional(), start: z.number().int().min(-120_000).max(120_000).optional(), end: z.number().int().min(-120_000).max(120_000).optional() }).strict().optional(),
  errorPolicy: z.object({ retryCount: z.number().int().min(0).max(2), onFailure: z.enum(['stop', 'fallback']), fallbackOutput: z.string().max(16_000).optional() }).strict().optional(),
}).strict()
const inputFieldSchema = z.object({ name: z.string().max(48), label: z.string().trim().min(1).max(100), type: z.enum(['text', 'number', 'boolean', 'select']), required: z.boolean(), defaultValue: z.string().max(16_000).optional(), options: z.array(z.string().min(1).max(1_000)).min(1).max(30).optional() }).strict()
export const agentBlueprintSchema = z.object({ schemaVersion: z.literal(1), name: z.string().trim().min(1).max(100), description: z.string().max(2_000), modules: z.array(moduleSchema).min(1).max(12), inputFields: z.array(inputFieldSchema).max(8).optional(), graph: z.object({ edges: z.array(z.object({ id: z.string().min(1).max(100), source: z.string().min(1).max(48), target: z.string().min(1).max(48), branch: z.enum(['true', 'false']).optional() }).strict()).max(40), positions: z.record(z.string().min(1).max(48), z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }).strict()) }).strict().optional() }).strict()
const placeholders = /\{\{\s*([^{}]+?)\s*\}\}/g
function fail(message: string, status = 400, code = 'AGENT_BLUEPRINT_INVALID'): never { throw Object.assign(new Error(message), { status, code }) }
function checkedVariables(blueprint: AgentBlueprint, variables?: Record<string,string>, references?: Set<string>) {
  try { return resolveAgentBlueprintVariables(blueprint, variables, references) } catch (error) { fail(error instanceof Error ? error.message : '输入变量无效') }
}
function validSource(source: string, available: Set<string>, blueprint: AgentBlueprint): boolean {
  return ['input', 'previous'].includes(source) || available.has(source) || (source.startsWith('inputs.') && Boolean(blueprint.inputFields?.some((field) => field.name === source.slice(7))))
}
function validateModule(module: AgentBlueprintModule, blueprint: AgentBlueprint, available: Set<string>) {
  const kind = module.kind ?? 'llm'
  if (kind === 'llm' && (!module.modelId || !module.prompt.trim())) fail('模型节点需要模型与提示词')
  if (kind === 'condition' && (!blueprint.graph || (!module.condition && !module.conditionGroup))) fail('判断节点需要图编排和判断条件')
  if (kind !== 'llm' && module.skillIds.length) fail('非模型节点不加载 Skill')
  if (kind === 'output' && (module.condition || module.conditionGroup)) fail('输出节点不支持判断条件')
  if (module.condition && module.conditionGroup) fail('条件与条件组只能选择一种')
  if (kind === 'json-extract') { if (!module.jsonExtract) fail('请配置 JSON 提取路径'); try { agentJsonPath(module.jsonExtract.path) } catch { fail('JSON 路径无效或包含原型字段') } }
  if (kind === 'aggregate' && !module.aggregate) fail('请配置聚合来源')
  if (kind === 'text-process' && !module.textProcess) fail('请配置文本处理操作')
  if (module.textProcess?.operation === 'replace' && !module.textProcess.search) fail('替换查找文本不能为空')
  if (module.errorPolicy?.onFailure === 'fallback' && module.errorPolicy.fallbackOutput === undefined) fail('请配置失败备用输出')
  for (const template of [module.inputTemplate, module.errorPolicy?.fallbackOutput ?? '']) for (const match of template.matchAll(placeholders)) {
    const ref = match[1].trim(); const source = ref.startsWith('modules.') ? ref.slice(8) : ref
    if (!validSource(source, available, blueprint) || (!ref.startsWith('modules.') && !['input', 'previous'].includes(ref) && !ref.startsWith('inputs.'))) fail('输入只能引用原始输入、声明变量、上一步或祖先模块输出')
  }
  for (const source of [...(module.condition ? [module.condition.source] : []), ...(module.conditionGroup?.rules.map((rule) => rule.source) ?? []), ...(module.aggregate?.sources ?? [])]) if (!validSource(source, available, blueprint)) fail('来源只能引用原始输入、声明变量、上一步或祖先模块输出')
  if (new Set(module.skillIds).size !== module.skillIds.length) fail('模块 Skill 不可重复')
}
function parseBlueprint(value: unknown): AgentBlueprint {
  const blueprint = agentBlueprintSchema.parse(value)
  const fields = blueprint.inputFields ?? []
  if (fields.some((field) => !safeAgentInputName(field.name)) || new Set(fields.map((field) => field.name)).size !== fields.length) fail('输入变量名称无效或重复')
  for (const field of fields) {
    if (field.type === 'select' && (!field.options?.length || new Set(field.options).size !== field.options.length)) fail('选择变量需要不重复的选项')
    if (field.defaultValue !== undefined && field.defaultValue !== '') checkedVariables({ ...blueprint, inputFields: [{ ...field, required: false }] })
  }
  const ids = blueprint.modules.map((module) => module.id)
  if (new Set(ids).size !== ids.length || ids.some((id) => ['start','input','inputs','previous','modules'].includes(id))) fail('模块 ID 重复或使用了保留名称')
  return blueprint
}
export function validateAgentBlueprint(value: unknown): AgentBlueprint {
  const blueprint = parseBlueprint(value)
  const graphError = getAgentBlueprintGraphError(blueprint)
  if (graphError) fail(graphError)
  const seen = new Set<string>()
  for (const module of blueprint.modules) { validateModule(module, blueprint, blueprint.graph ? getAgentBlueprintAncestors(blueprint, module.id) : seen); seen.add(module.id) }
  return blueprint
}
export function renderAgentBlueprintInput(template: string, input: string, outputs: Record<string, string>, previous: string, variables: Record<string, string> = {}): string {
  const parts: string[] = []; let cursor = 0
  for (const match of template.matchAll(placeholders)) {
    const key = match[1].trim(); const source = key.startsWith('modules.') ? key.slice(8) : key
    parts.push(template.slice(cursor, match.index), agentSourceValue(source, input, outputs, previous, variables)); cursor = match.index + match[0].length
  }
  parts.push(template.slice(cursor)); return joinAgentBlueprintText(parts)
}
export function agentBlueprintConditionMatches(condition: AgentBlueprintCondition, input: string, outputs: Record<string, string>, previous: string, variables: Record<string, string> = {}) { return testAgentCondition(condition, input, outputs, previous, variables) }
function conditionMatches(module: AgentBlueprintModule, input: string, outputs: Record<string, string>, previous: string, variables: Record<string, string>): boolean {
  if (module.conditionGroup) { const results = module.conditionGroup.rules.map((rule) => testAgentCondition(rule, input, outputs, previous, variables)); return module.conditionGroup.mode === 'and' ? results.every(Boolean) : results.some(Boolean) }
  return !module.condition || testAgentCondition(module.condition, input, outputs, previous, variables)
}
async function executeStep(module: AgentBlueprintModule, input: string, outputs: Record<string,string>, previous: string, variables: Record<string,string>, execute: (module:AgentBlueprintModule,input:string)=>Promise<string>, started:number, signal?:AbortSignal) {
  let rendered = ''; let attempts = 0
  const limit = () => { signal?.throwIfAborted(); if (Date.now() - started >= 150_000) fail('流程执行超过 150 秒限制') }
  const checkOutput = (output:string) => { if (output.length > 120_000 || ((module.kind ?? 'llm') === 'llm' && !output.trim())) fail('模块输出为空或超过限制'); if (module.kind !== 'condition' && module.outputFormat === 'json') JSON.parse(output); return output }
  try {
    limit(); rendered = renderAgentBlueprintInput(module.inputTemplate, input, outputs, previous, variables)
    for (;;) {
      try {
        limit(); attempts++
        const output = module.kind === 'condition' ? previous : (module.kind ?? 'llm') === 'llm' ? await execute(module,rendered) : executeAgentManualModule(module,rendered,input,outputs,previous,variables)
        return { input:rendered, output:checkOutput(output), attempts, fallback:false }
      } catch (error) { if (signal?.aborted || Date.now()-started >= 150_000 || attempts > (module.errorPolicy?.retryCount ?? 0)) throw error }
    }
  } catch {
    if (!signal?.aborted && Date.now()-started < 150_000 && module.errorPolicy?.onFailure === 'fallback') {
      try { return { input:rendered, output:checkOutput(renderAgentBlueprintInput(module.errorPolicy.fallbackOutput!,input,outputs,previous,variables)), attempts, fallback:true } } catch { /* Invalid fallbacks fail the node like normal outputs. */ }
    }
    return { input:rendered, output:'', attempts, error: module.outputFormat === 'json' ? '模块执行失败，请检查模型配置、输入与 JSON 输出约束后重试' : '模块执行失败，请检查节点配置和输入后重试' }
  }
}
export async function executeAgentBlueprint(value: unknown, input: string, execute: (module: AgentBlueprintModule, input: string) => Promise<string>, throughModuleId?: string, signal?: AbortSignal, variableValues: Record<string,string> = {}): Promise<AgentBlueprintRun> {
  const blueprint = validateAgentBlueprint(value)
  if (input.length > 60_000) fail('原始输入超过 60000 字符限制')
  if (throughModuleId && !blueprint.modules.some((module) => module.id === throughModuleId)) fail('试跑模块不存在')
  const variables = checkedVariables(blueprint,variableValues)
  const selected = getAgentBlueprintExecutionModules(blueprint, throughModuleId); const edges = getAgentBlueprintEdges(blueprint)
  const started = Date.now(); let outputs:Record<string,string>={}; let previous=''; let failed=false
  const branchResults = new Map<string,boolean>(); const succeeded = new Set(['start']); const steps:AgentBlueprintRun['steps']=[]
  for (const module of selected) {
    const stepStarted=Date.now(); const step={moduleId:module.id,name:module.name,modelId:module.modelId,input:'',output:'',durationMs:0}
    const parents=edges.filter((edge)=>edge.target===module.id); const activeParents=parents.filter((edge)=>succeeded.has(edge.source)&&(edge.branch===undefined||branchResults.get(edge.source)===(edge.branch==='true')))
    if (failed || (blueprint.graph && !activeParents.length)) { steps.push({...step,status:'skipped'});continue }
    let directPrevious=''
    try { directPrevious=blueprint.graph?joinAgentBlueprintText(activeParents.slice().sort((a,b)=>blueprint.modules.findIndex((item)=>item.id===a.source)-blueprint.modules.findIndex((item)=>item.id===b.source)).map((edge)=>edge.source==='start'?input:outputs[edge.source]),'\n\n'):previous } catch { failed=true;steps.push({...step,status:'failed',error:'模块输入超过 120000 字符限制'});continue }
    const condition=conditionMatches(module,input,outputs,directPrevious,variables)
    if (module.kind!=='condition'&&!condition) {steps.push({...step,status:'skipped'});continue}
    const result=await executeStep(module,input,outputs,directPrevious,variables,execute,started,signal)
    if (result.error) {failed=true;steps.push({...step,...result,status:'failed',durationMs:Date.now()-stepStarted});continue}
    outputs={...outputs,[module.id]:result.output};succeeded.add(module.id)
    if(module.kind==='condition')branchResults.set(module.id,condition);else previous=result.output
    steps.push({...step,...result,fallback:result.fallback||undefined,conditionMatched:module.kind==='condition'?condition:undefined,status:'succeeded',durationMs:Date.now()-stepStarted})
  }
  return {id:randomUUID(),status:failed?'failed':'succeeded',steps,output:previous,durationMs:Date.now()-started}
}
export function validateAgentBlueprintNode(value:unknown,moduleId:string): {blueprint:AgentBlueprint,module:AgentBlueprintModule,ancestors:Set<string>} {
  const blueprint=parseBlueprint(value);const module=blueprint.modules.find((item)=>item.id===moduleId)
  if(!module)fail('试跑节点不存在')
  if(blueprint.graph) {
    const ids=new Set(blueprint.modules.map((item)=>item.id)); const edges=blueprint.graph.edges
    if(edges.some((edge)=>!ids.has(edge.target)||!(ids.has(edge.source)||edge.source==='start')||edge.source===edge.target))fail('连线端点无效')
    try { getAgentBlueprintExecutionModules(blueprint) } catch { fail('流程存在循环') }
  }
  const ancestors=getAgentBlueprintAncestors(blueprint,moduleId)
  validateModule(module,blueprint,ancestors)
  return {blueprint,module,ancestors}
}
export async function executeAgentBlueprintNode(value:unknown,moduleId:string,context:AgentBlueprintNodeContext,execute:(module:AgentBlueprintModule,input:string)=>Promise<string>,signal?:AbortSignal):Promise<AgentBlueprintRun> {
  const {blueprint,module,ancestors}=validateAgentBlueprintNode(value,moduleId)
  if(context.input.length>60_000||context.previous.length>120_000||Object.keys(context.outputs).length>12||Object.entries(context.outputs).some(([id,text])=>!ancestors.has(id)||typeof text!=='string'||text.length>120_000))fail('测试上下文只允许有界的合法祖先输出')
  const references=new Set<string>()
  for(const match of JSON.stringify(module).matchAll(/inputs\.([A-Za-z][A-Za-z0-9_]*)/g))references.add(match[1])
  const variables=checkedVariables(blueprint,context.variables,references);const started=Date.now()
  if(module.kind!=='condition'&&!conditionMatches(module,context.input,context.outputs,context.previous,variables))return {id:randomUUID(),status:'succeeded',steps:[{moduleId:module.id,name:module.name,modelId:module.modelId,status:'skipped',input:'',output:'',durationMs:0}],output:'',durationMs:0}
  const result=await executeStep(module,context.input,context.outputs,context.previous,variables,execute,started,signal)
  return {id:randomUUID(),status:result.error?'failed':'succeeded',steps:[{moduleId:module.id,name:module.name,modelId:module.modelId,...result,fallback:result.fallback||undefined,conditionMatched:module.kind==='condition'?conditionMatches(module,context.input,context.outputs,context.previous,variables):undefined,status:result.error?'failed':'succeeded',durationMs:Date.now()-started}],output:result.output,durationMs:Date.now()-started}
}

export function exportAgentBlueprint(value: unknown, format: 'json' | 'markdown'): AgentBlueprintExport {
  const blueprint = validateAgentBlueprint(value)
  const filename = blueprint.name.replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 80) || 'agent'
  const document = { format: 'cnvc-agent-blueprint', schemaVersion: 1, blueprint, portability: { execution: blueprint.graph ? 'directed-acyclic-graph' : 'sequential', previous: blueprint.graph ? 'Active direct parents, joined in module order with two newlines; start forwards original input.' : 'Most recent successful module output.', branches: 'Condition nodes forward their active parent content to the matching true/false edge; joins execute if any incoming edge is active.', references: ['{{input}}', '{{previous}}', '{{modules.ID}}', '{{inputs.NAME}}'], skills: 'instructions-only', credentials: 'Configure model credentials separately on the destination platform.' } }
  if (format === 'json') return { filename: `${filename}.json`, mimeType: 'application/json', content: JSON.stringify(document, null, 2) }
  const content = [`# ${blueprint.name}`, blueprint.description, blueprint.graph ? '执行方式：按图拓扑顺序执行；判断节点仅激活真或假分支，合流收到任一活跃路径即执行。previous 为直接活跃父节点输出，按模块顺序以两个换行拼接。Skill 仅加载指令，不执行脚本。模型凭据需在目标平台独立配置。' : '执行方式：按模块顺序执行；条件不满足时跳过。Skill 仅加载指令，不执行脚本。模型凭据需在目标平台独立配置。', ...blueprint.modules.map((module, index) => `## ${index + 1}. ${module.name}\n\n模块 ID：${module.id}\n\n模型 ID：${module.modelId}\n\nSkill：${module.skillIds.join(', ') || '无'}\n\n条件：${module.condition ? JSON.stringify(module.condition) : '始终执行'}\n\n### 提示词\n\n${module.prompt}\n\n### 输入映射\n\n${module.inputTemplate}\n\n### 输出要求\n\n${module.outputFormat}\n${module.outputInstructions}`)].join('\n\n')
  return { filename: `${filename}.md`, mimeType: 'text/markdown', content: `${content}\n\n## 完整可迁移配置（含节点参数、输入变量与图编排）\n\n\`\`\`json\n${JSON.stringify(blueprint, null, 2)}\n\`\`\`` }
}
export function importAgentBlueprint(document: unknown): AgentBlueprint {
  const envelope = z.object({ format: z.literal('cnvc-agent-blueprint'), schemaVersion: z.literal(1), blueprint: z.unknown(), portability: z.unknown().optional(), dependencies: z.unknown().optional() }).strict().safeParse(document)
  return validateAgentBlueprint(envelope.success ? envelope.data.blueprint : document)
}

// ponytail: single-service runtime uses per-user locks; use shared leases if deployed in multiple processes.
const running = new Set<string>()
const requests = new Map<string, number[]>()
export async function withAgentBlueprintRunLimit<T>(userId: string, work: () => Promise<T>): Promise<T> {
  if (running.has(userId)) fail('已有 Agent 正在生成或试跑，请等待完成', 409, 'AGENT_BLUEPRINT_BUSY')
  const now = Date.now()
  for (const [key, times] of requests) if (!times.some((time) => now - time < 60_000)) requests.delete(key)
  const recent = (requests.get(userId) ?? []).filter((time) => now - time < 60_000)
  if (recent.length >= 5) fail('操作过于频繁，请一分钟后重试', 429, 'AGENT_BLUEPRINT_RATE_LIMIT')
  requests.set(userId, [...recent, now]); running.add(userId)
  try { return await work() } finally { running.delete(userId) }
}

async function authorizedResources(actor: AiCapabilityActor) {
  const [{ listAvailableModels, resolveAiModelById }, { listAvailableCapabilities }] = await Promise.all([import('./aiModelSettingsService.js'), import('./aiCapabilityService.js')])
  const [models, capabilities] = await Promise.all([listAvailableModels(actor.role), listAvailableCapabilities(actor)])
  return { models, skills: capabilities.filter((item) => item.kind === 'skill' && ['builtin', 'uploaded'].includes(item.source)), resolveAiModelById }
}
export type AgentBlueprintRuntimeDependencies = {
  resources: typeof authorizedResources
  complete: typeof import('./aiGatewayService.js').requestAiGatewayCompletion
}
export async function runtimeDependencies(): Promise<AgentBlueprintRuntimeDependencies> {
  const { requestAiGatewayCompletion } = await import('./aiGatewayService.js')
  return { resources: authorizedResources, complete: requestAiGatewayCompletion }
}
export async function getAgentBlueprintCatalog(actor: AiCapabilityActor, dependencies?: AgentBlueprintRuntimeDependencies): Promise<AgentBlueprintCatalog> {
  const { models, skills } = await (dependencies?.resources ?? authorizedResources)(actor)
  return { models: models.map((model) => ({ id: model.id, name: model.displayName, modelKey: model.modelKey })), skills: skills.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description ?? '', executionMode: 'instructions-only' })) }
}
export async function skillInstructions(skill: Awaited<ReturnType<typeof authorizedResources>>['skills'][number]) {
  if (skill.source === 'uploaded') {
    const text = skill.config.instructions
    if (typeof text !== 'string' || !text.trim() || text.length > 64_000) fail('Skill 指令缺失或超过可加载限制', 400, 'AGENT_BLUEPRINT_SKILL_INVALID')
    return text
  }
  const { loadAiSkill } = await import('./aiSkillService.js')
  const loaded = await loadAiSkill(skill.capabilityKey)
  const instructions = `${loaded.instructions}\n${loaded.referenceInstructions}`
  if (instructions.length > 64_000) fail('Skill 指令超过可加载限制', 400, 'AGENT_BLUEPRINT_SKILL_INVALID')
  return instructions
}
async function authorizedModuleExecutor(actor: AiCapabilityActor, selected: AgentBlueprintModule[], runtime: AgentBlueprintRuntimeDependencies, signal: AbortSignal) {
  const { skills, resolveAiModelById } = await runtime.resources(actor)
  const models = new Map<string, NonNullable<Awaited<ReturnType<typeof resolveAiModelById>>>>()
  const instructions = new Map<string, string>()
  for (const module of selected.filter((item) => (item.kind ?? 'llm') === 'llm')) {
    if (!models.has(module.modelId)) {
      const model = await resolveAiModelById(module.modelId, actor.role)
      if (!model) fail('所选模型未授权、已停用或配置不完整，请重新选择', 403, 'AGENT_BLUEPRINT_MODEL_FORBIDDEN')
      models.set(module.modelId, model)
    }
    for (const id of module.skillIds) {
      const skill = skills.find((item) => item.id === id)
      if (!skill) fail('所选 Skill 未授权或已停用', 403, 'AGENT_BLUEPRINT_SKILL_FORBIDDEN')
      if (!instructions.has(id)) instructions.set(id, await skillInstructions(skill))
    }
  }
  return async (module: AgentBlueprintModule, rendered: string) => {
    signal.throwIfAborted()
    const model = models.get(module.modelId)!
    const result = await runtime.complete({ ...model, signal, timeoutMs: Math.min(model.timeoutMs, 60_000), maxTokens: module.modelOptions?.maxTokens ?? 6_000, ...(module.modelOptions?.temperature !== undefined ? { temperature: module.modelOptions.temperature } : {}), json: module.outputFormat === 'json', messages: [
      { role: 'system', content: `你正在执行用户设计的文本工作流。仅进行文本处理；不得声称运行了工具、脚本或访问了未提供的外部数据。\n${module.prompt}\n\n输出格式：${module.outputFormat}\n${module.outputInstructions}\n\n已授权 Skill 指令（仅作为文本指令加载）：\n${module.skillIds.map((id) => instructions.get(id)).join('\n\n')}` },
      { role: 'user', content: rendered },
    ] })
    return result.text
  }
}
function runSignal(callerSignal?: AbortSignal) { return callerSignal ? AbortSignal.any([callerSignal, AbortSignal.timeout(150_000)]) : AbortSignal.timeout(150_000) }
export async function runAgentBlueprint(actor: AiCapabilityActor, value: unknown, input: string, throughModuleId?: string, callerSignal?: AbortSignal, dependencies?: AgentBlueprintRuntimeDependencies, variables: Record<string,string> = {}) {
  const blueprint = validateAgentBlueprint(value)
  if (input.length > 60_000) fail('原始输入超过 60000 字符限制')
  checkedVariables(blueprint, variables)
  if (throughModuleId && !blueprint.modules.some((module) => module.id === throughModuleId)) fail('试跑模块不存在')
  return withAgentBlueprintRunLimit(actor.userId, async () => {
    const runtime=dependencies ?? await runtimeDependencies(); const signal=runSignal(callerSignal)
    const execute=await authorizedModuleExecutor(actor,getAgentBlueprintExecutionModules(blueprint,throughModuleId),runtime,signal)
    return executeAgentBlueprint(blueprint,input,execute,throughModuleId,signal,variables)
  })
}
export async function runAgentBlueprintNode(actor: AiCapabilityActor, value: unknown, moduleId: string, context: AgentBlueprintNodeContext, callerSignal?: AbortSignal, dependencies?: AgentBlueprintRuntimeDependencies) {
  const { module }=validateAgentBlueprintNode(value,moduleId)
  return withAgentBlueprintRunLimit(actor.userId,async()=>{
    const runtime=dependencies ?? await runtimeDependencies(); const signal=runSignal(callerSignal)
    const execute=await authorizedModuleExecutor(actor,[module],runtime,signal)
    return executeAgentBlueprintNode(value,moduleId,context,execute,signal)
  })
}
export async function generateAgentBlueprint(actor: AiCapabilityActor, description: string, modelId: string, callerSignal?: AbortSignal, dependencies?: AgentBlueprintRuntimeDependencies) {
  if (!description.trim() || description.length > 20_000) fail('需求描述不能为空且不可超过 20000 字符')
  return withAgentBlueprintRunLimit(actor.userId, async () => {
    const runtime = dependencies ?? await runtimeDependencies()
    const { models, skills, resolveAiModelById } = await runtime.resources(actor)
    const model = await resolveAiModelById(modelId, actor.role)
    if (!model) fail('请选择已授权且配置完整的模型', 403, 'AGENT_BLUEPRINT_MODEL_FORBIDDEN')
    const requestAiGatewayCompletion = runtime.complete
    let text: string
    try {
      const response = await requestAiGatewayCompletion({ ...model, timeoutMs: Math.min(model.timeoutMs, 60_000), signal: callerSignal ? AbortSignal.any([callerSignal, AbortSignal.timeout(65_000)]) : AbortSignal.timeout(65_000), maxTokens: 8_000, json: true, messages: [
        { role: 'system', content: '根据用户描述理解目的、受众、输入输出、约束与验收标准；信息不足时在说明中列出待确认与假设。输出且只输出 AgentBlueprint JSON。\n' + agentGenerationInstructions(modelId, skills) },
        { role: 'user', content: description },
      ] }); text = response.text
    } catch { fail('需求拆解失败，请检查所选模型配置后重试', 502, 'AGENT_BLUEPRINT_GENERATION_FAILED') }
    let generated: unknown
    try { generated = JSON.parse(text!) } catch { fail('模型未返回有效 JSON，请重试', 502, 'AGENT_BLUEPRINT_GENERATION_INVALID') }
    let blueprint: AgentBlueprint
    try { blueprint = validateAgentBlueprint(generated) } catch { fail('模型返回的流程未通过校验，请细化描述后重试', 502, 'AGENT_BLUEPRINT_GENERATION_INVALID') }
    if (blueprint!.modules.some((module) => (module.kind ?? 'llm') === 'llm' && (module.modelId !== modelId || !models.some((item) => item.id === module.modelId) || module.skillIds.some((id) => !skills.some((skill) => skill.id === id))))) fail('生成结果引用未授权的模型或 Skill，请重试', 502, 'AGENT_BLUEPRINT_GENERATION_INVALID')
    return { blueprint: blueprint! }
  })
}
export async function exportAuthorizedAgentBlueprint(actor: AiCapabilityActor, value: unknown, format: 'json' | 'markdown', dependencies?: AgentBlueprintRuntimeDependencies) {
  const blueprint = validateAgentBlueprint(value)
  const { models, skills } = await (dependencies?.resources ?? authorizedResources)(actor)
  const selectedSkills = [...new Set(blueprint.modules.flatMap((module) => module.skillIds))]
  const bundled = { models: blueprint.modules.filter((module) => (module.kind ?? 'llm') === 'llm').map((module) => { const model = models.find((item) => item.id === module.modelId); return { id: module.modelId, modelKey: model?.modelKey ?? null, displayName: model?.displayName ?? null } }), skills: await Promise.all(selectedSkills.map(async (id) => { const skill = skills.find((item) => item.id === id); if (!skill) fail('导出包含未授权 Skill', 403, 'AGENT_BLUEPRINT_SKILL_FORBIDDEN'); return { id, name: skill.name, instructions: await skillInstructions(skill) } })) }
  const exported = exportAgentBlueprint(blueprint, format)
  if (format === 'json') return { ...exported, content: JSON.stringify({ ...JSON.parse(exported.content), dependencies: bundled }, null, 2) }
  return { ...exported, content: `${exported.content}\n\n## 模型映射\n\n${bundled.models.map((model) => `${model.id}: ${model.modelKey ?? '需重新选择'}`).join('\n')}\n\n## Skill 指令\n\n${bundled.skills.map((skill) => `### ${skill.name}\n\n${skill.instructions}`).join('\n\n')}` }
}
