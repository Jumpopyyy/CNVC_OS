import { createHash } from 'node:crypto'
import { LibraryReferenceSchema, libraryKey, type LibraryBinding, type LibraryItem, type LibraryReference, type LibrarySelection, type LibrarySnapshot, type LibraryTask } from '../contracts/dueDiligenceLibrary.js'
import type { AgentBlueprint, AgentBlueprintRun } from '../contracts/agentBlueprintContract.js'
import type { AiCapabilityActor } from './aiCapabilityService.js'

export type LibraryResource = LibraryItem & { instructions: string; blueprint?: AgentBlueprint }
export type LibraryDependencies = {
  list: (actor: AiCapabilityActor, projectId?: string | null) => Promise<{ items: LibraryResource[]; warnings: string[] }>
  get: (actor: AiCapabilityActor, ref: Pick<LibraryReference, 'source' | 'id'>, projectId?: string | null) => Promise<LibraryResource>
  run: (actor: AiCapabilityActor, blueprint: AgentBlueprint, input: string, signal?: AbortSignal, projectId?: string | null) => Promise<AgentBlueprintRun>
}
const fail = (message: string, status = 409) => Object.assign(new Error(message), { status, code: status === 409 ? 'LIBRARY_VERSION_CHANGED' : 'LIBRARY_FORBIDDEN' })
export const libraryContentHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function librarySummary(item: LibraryResource): LibraryItem {
  const { instructions: _instructions, blueprint: _blueprint, ...summary } = item
  return summary
}

async function defaultDependencies(): Promise<LibraryDependencies> {
  const [{ createPromptLibraryService }, { mysqlPromptLibraryRepository }, { BUILTIN_PROMPT_TEMPLATES }, capabilities, agents, runtime] = await Promise.all([
    import('./promptLibraryService.js'), import('../repositories/mysql/mysqlPromptLibraryRepository.js'), import('../data/builtinPromptTemplates.js'),
    import('./aiCapabilityService.js'), import('../repositories/agentBlueprintRepository.js'), import('./agentBlueprintService.js'),
  ])
  const prompts = createPromptLibraryService(mysqlPromptLibraryRepository, BUILTIN_PROMPT_TEMPLATES, async () => {})
  const actors = new Map<string, Promise<AiCapabilityActor>>()
  const currentActor = (actor: AiCapabilityActor) => {
    if (!actors.has(actor.userId)) actors.set(actor.userId, (async () => {
      const [{ db }, { users }, { and, eq }] = await Promise.all([import('../db/client.js'), import('../db/schema.js'), import('drizzle-orm')])
      const [user] = await db.select({ name: users.name, role: users.role, department: users.department }).from(users).where(and(eq(users.id, actor.userId), eq(users.status, '启用'))).limit(1)
      if (!user) throw fail('员工账号已停用或不存在', 403)
      return { ...actor, userName: user.name, role: user.role, department: user.department }
    })())
    return actors.get(actor.userId)!
  }
  const availableCache = new Map<string, ReturnType<typeof capabilities.listAvailableCapabilities>>()
  const availableFor = (actor: AiCapabilityActor, projectId?: string | null) => {
    const key = `${actor.userId}:${projectId || ''}`
    if (!availableCache.has(key)) availableCache.set(key, capabilities.listAvailableCapabilities(actor, projectId))
    return availableCache.get(key)!
  }
  const make = (source: LibraryItem['source'], id: string, version: number, name: string, description: string, instructions: string, blueprint?: AgentBlueprint, dependencies?: Array<{ id: string; name: string; version: number; hash: string }>): LibraryResource => ({
    source, id, version, name, description, instructions, blueprint, kind: source === 'prompt-skill' || source === 'capability-skill' ? 'skill' : 'agent',
    execution: blueprint ? 'workflow' : 'instructions', dependencies, hash: libraryContentHash({ source, id, version, instructions, blueprint, dependencies }),
  })
  async function get(actor: AiCapabilityActor, ref: Pick<LibraryReference, 'source' | 'id'>, projectId?: string | null): Promise<LibraryResource> {
    actor = await currentActor(actor)
    if (projectId) await (await import('./projectAccessService.js')).requireAccessibleProject(actor.userId, projectId)
    if (ref.source === 'prompt-skill' || ref.source === 'prompt-agent') {
      const row = await prompts.get(actor, ref.id)
      if (row.kind !== (ref.source === 'prompt-skill' ? 'skill' : 'agent') || row.visibility !== 'organization' && row.ownerUserId !== actor.userId) throw fail('无权使用此私人模板', 403)
      return make(ref.source, row.id, row.version, row.name, row.description, row.markdown)
    }
    if (!(await import('../config/extensionFeatureFlags.js')).resolveExtensionFeatureFlags().aiCapabilitiesEnabled) throw fail('平台能力扩展已停用', 503)
    const available = await availableFor(actor, projectId)
    if (ref.source === 'capability-skill') {
      const row = available.find(item => item.id === ref.id && item.kind === 'skill' && ['builtin', 'uploaded'].includes(item.source))
      if (!row) throw fail('Skill 已停用或无调用权限', 403)
      return make(ref.source, row.id, row.version, row.name, row.description || '', await runtime.skillInstructions(row))
    }
    const row = await agents.getCallableAgentBlueprint(actor, ref.id)
    // Fingerprint nested methods as well: changing a workflow Skill invalidates old bindings.
    const methods = []
    for (const id of [...new Set(row.blueprint.modules.flatMap(module => module.skillIds))]) {
      const skill = available.find(item => item.id === id && item.kind === 'skill' && ['builtin', 'uploaded'].includes(item.source))
      if (!skill) throw fail('智能体引用的 Skill 未授权或已停用', 403)
      methods.push({ id, name: skill.name, version: skill.version, hash: libraryContentHash(await runtime.skillInstructions(skill)) })
    }
    return make(ref.source, row.id, row.version, row.blueprint.name, row.blueprint.description, '', row.blueprint, methods)
  }
  return {
    get,
    run: async (actor, blueprint, input, signal, projectId) => {
      actor = await currentActor(actor)
      const deps = await runtime.runtimeDependencies()
      const models = await import('./aiModelSettingsService.js')
      deps.resources = async caller => ({ models: await models.listAvailableModels(caller.role), skills: (await availableFor(caller, projectId)).filter(item => item.kind === 'skill' && ['builtin', 'uploaded'].includes(item.source)), resolveAiModelById: models.resolveAiModelById })
      return runtime.runAgentBlueprint(actor, blueprint, input, undefined, signal, deps)
    },
    list: async (actor, projectId) => {
      actor = await currentActor(actor)
      if (projectId) await (await import('./projectAccessService.js')).requireAccessibleProject(actor.userId, projectId)
      const refs: Pick<LibraryReference, 'source' | 'id'>[] = [], warnings: string[] = []
      for (const kind of ['skill', 'agent'] as const) {
        try { for (const row of await prompts.list(actor, kind)) if (row.visibility === 'organization' || row.ownerUserId === actor.userId) refs.push({ source: kind === 'skill' ? 'prompt-skill' : 'prompt-agent', id: row.id }) }
        catch { warnings.push(`平台 ${kind === 'skill' ? 'Skill' : 'Agent 提示词'}库读取失败`) }
      }
      try { for (const row of await availableFor(actor, projectId)) if (row.kind === 'skill' && ['builtin', 'uploaded'].includes(row.source)) refs.push({ source: 'capability-skill', id: row.id }) }
      catch { warnings.push('运行能力目录读取失败') }
      try { for (const row of await agents.listCallableAgentBlueprints(actor)) refs.push({ source: 'workflow', id: row.id }) }
      catch { warnings.push('工作流智能体目录读取失败') }
      const items: LibraryResource[] = []
      // Bounded sequential loading avoids bursts against MySQL and local Skill files.
      for (const ref of refs.slice(0, 300)) {
        try { const item = await get(actor, ref, projectId); items.push({ ...librarySummary(item), instructions: '' }) } catch { warnings.push(`部分${ref.source === 'workflow' ? '工作流智能体' : '方法'}暂不可用，已排除`) }
      }
      return { items, warnings: [...new Set(warnings)] }
    },
  }
}

export async function getDueDiligenceLibrary(actor: AiCapabilityActor, projectId?: string | null, dependencies?: LibraryDependencies) {
  const result = await (dependencies ?? await defaultDependencies()).list(actor, projectId)
  return { list: result.items.map(librarySummary), warnings: result.warnings }
}
export async function loadLibraryReference(actor: AiCapabilityActor, ref: LibraryReference, projectId?: string | null, dependencies?: LibraryDependencies) {
  const value = LibraryReferenceSchema.parse(ref)
  const item = await (dependencies ?? await defaultDependencies()).get(actor, value, projectId)
  if (item.version !== value.version || item.hash !== value.hash) throw fail(`${item.name} 已更新，请查看新版本后重新选择`)
  return item
}
export async function validateLibraryBindings(actor: AiCapabilityActor, bindings: LibraryBinding[], dependencies?: LibraryDependencies) {
  const keys = new Set<string>()
  for (const binding of bindings) {
    if (keys.has(libraryKey(binding))) throw fail('同一能力不能重复绑定', 400)
    keys.add(libraryKey(binding))
    if (binding.enabled) await loadLibraryReference(actor, binding, null, dependencies)
  }
  for (const task of ['checklist', 'conversation', 'builder'] as const) if (bindings.filter(item => item.enabled && item.tasks.includes(task) && ['workflow', 'prompt-agent'].includes(item.source)).length > 1) throw fail('每个场景最多绑定一个执行智能体', 400)
}

export type ResolvedLibrary = { resources: LibraryResource[]; snapshot: LibrarySnapshot[]; prompt: string; warnings: string[]; projectId?: string | null }
export async function resolveDueDiligenceLibrary(input: { actor: AiCapabilityActor; projectId?: string | null; task: LibraryTask; selection?: LibrarySelection; bindings?: LibraryBinding[]; useSkills?: boolean }, dependencies?: LibraryDependencies): Promise<ResolvedLibrary> {
  const deps = dependencies ?? await defaultDependencies(), resources: LibraryResource[] = [], warnings: string[] = []
  const explicit = [...(input.selection?.skills ?? []), ...(input.selection?.agent ? [input.selection.agent] : [])]
  for (const ref of explicit) {
    const item = await loadLibraryReference(input.actor, ref, input.projectId, deps)
    if (ref !== input.selection?.agent && item.kind !== 'skill' || ref === input.selection?.agent && item.kind !== 'agent') throw fail('能力类型不匹配', 400)
    if (!resources.some(existing => libraryKey(existing) === libraryKey(item))) resources.push(item)
  }
  if (input.useSkills !== false && !input.selection?.replaceBindings) for (const ref of input.bindings ?? []) {
    if (!ref.enabled || !ref.tasks.includes(input.task) || input.selection?.agent && ['workflow', 'prompt-agent'].includes(ref.source)) continue
    if (resources.some(existing => libraryKey(existing) === libraryKey(ref))) continue
    try { resources.push(await loadLibraryReference(input.actor, ref, input.projectId, deps)) }
    catch { warnings.push('部分绑定能力已更新、撤回或不可访问，本次未使用；请在数字分身中复核绑定') }
  }
  if (resources.filter(item => item.kind === 'agent').length > 1) throw fail('一次只能调用一个执行智能体', 400)
  if (resources.length > 9 || resources.reduce((sum, item) => sum + item.instructions.length, 0) > 48000) throw fail('本次能力内容过多，请减少选择', 400)
  const methodKeys = new Set(resources.filter(item => item.kind === 'agent').flatMap(item => item.blueprint?.modules.flatMap(module => module.skillIds) ?? []))
  const unique = resources.filter(item => !(item.source === 'capability-skill' && methodKeys.has(item.id)))
  return { resources: unique, projectId: input.projectId, snapshot: unique.map(librarySummary), warnings: [...new Set(warnings)], prompt: unique.filter(item => item.execution === 'instructions').map(item => `【${item.kind === 'skill' ? '核查方法' : '执行智能体说明'}：${item.name} v${item.version}】\n${item.instructions}`).join('\n\n') }
}

let workflowBusy = false
export async function executeDueDiligenceLibrary(actor: AiCapabilityActor, context: ResolvedLibrary, input: string, signal?: AbortSignal, dependencies?: LibraryDependencies) {
  const workflow = context.resources.find(item => item.blueprint)
  if (!workflow?.blueprint) return null
  if (input.length > 60000) throw fail('智能体输入超过限制，请减少本次材料', 400)
  signal?.throwIfAborted()
  if (workflowBusy) throw Object.assign(new Error('另一个尽调工作流正在处理，请稍后重试'), { status: 429, code: 'DD_WORKFLOW_BUSY' })
  workflowBusy = true
  try {
    const result = await (dependencies ?? await defaultDependencies()).run(actor, workflow.blueprint, input, signal, context.projectId)
    if (result.status !== 'succeeded') throw Object.assign(new Error('所选智能体执行失败，未使用其不完整结果'), { status: 502, code: 'DD_WORKFLOW_FAILED' })
    return result
  } finally { workflowBusy = false }
}
