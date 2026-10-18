import assert from 'node:assert/strict'
import test from 'node:test'
import { LibraryBindingSchema, LibrarySelectionSchema } from '../src/contracts/dueDiligenceLibrary.js'
import { executeDueDiligenceLibrary, getDueDiligenceLibrary, libraryContentHash, loadLibraryReference, resolveDueDiligenceLibrary, validateLibraryBindings, type LibraryDependencies, type LibraryResource } from '../src/services/dueDiligenceLibraryService.js'
import { resolveDueDiligenceTwinContext, safePublicTwinContext } from '../src/services/dueDiligenceTwinRuntimeService.js'
import { runAgentBlueprint } from '../src/services/agentBlueprintService.js'

const actor = { userId: 'owner', userName: '合成员工', role: '研究员' }
const skill: LibraryResource = { source: 'prompt-skill', id: 'builtin:cash-check', version: 2, hash: 'a'.repeat(64), name: '现金流核查', description: '合成核查方法', kind: 'skill', execution: 'instructions', instructions: '比对银行原始流水与回款合同，记录反证。' }
const blueprint = { schemaVersion: 1 as const, name: '合成工作流', description: '', modules: [{ id: 'analyse', name: '核查', modelId: '11111111-1111-4111-8111-111111111111', prompt: '核查输入中的证据缺口', inputTemplate: '{{input}}', skillIds: [], outputFormat: 'text' as const, outputInstructions: '输出问题建议' }] }
const agent: LibraryResource = { source: 'workflow', id: '22222222-2222-4222-8222-222222222222', version: 1, hash: 'b'.repeat(64), name: '合成分析智能体', description: '', kind: 'agent', execution: 'workflow', instructions: '', blueprint }
const deps: LibraryDependencies = {
  list: async () => ({ items: [skill, agent], warnings: [] }),
  get: async (_actor, ref) => { const item = [skill, agent].find(item => item.id === ref.id && item.source === ref.source); if (!item) throw Object.assign(new Error('禁止访问私人能力'), { status: 403 }); return item },
  run: async () => ({ id: 'synthetic-run', status: 'succeeded', steps: [], output: '核对回款证据', durationMs: 1 }),
}
test('catalog exports authorized metadata only, never raw instructions or blueprints', async () => {
  const result = await getDueDiligenceLibrary(actor, undefined, deps)
  assert.equal(result.list.length, 2)
  assert.ok(!JSON.stringify(result).includes('比对银行原始流水'))
  assert.ok(!JSON.stringify(result).includes('modelId'))
})
test('public method is actually included in controlled analysis context and traced by exact version', async () => {
  const result = await resolveDueDiligenceLibrary({ actor, task: 'checklist', selection: { skills: [skill], agent } }, deps)
  assert.match(result.prompt, /比对银行原始流水/)
  assert.equal(result.snapshot[0].version, 2)
  assert.equal(result.snapshot[0].hash, skill.hash)
  assert.equal((await executeDueDiligenceLibrary(actor, result, '合成材料', undefined, deps))?.output, '核对回款证据')
})
test('changed versions, content changes and private references cannot be forged', async () => {
  await assert.rejects(loadLibraryReference(actor, { ...skill, version: 1 }, null, deps), { status: 409 })
  await assert.rejects(loadLibraryReference(actor, { ...skill, hash: 'c'.repeat(64) }, null, deps), { status: 409 })
  await assert.rejects(loadLibraryReference(actor, { ...skill, id: 'private-other' }, null, deps), { status: 403 })
  await assert.rejects(resolveDueDiligenceLibrary({ actor, task: 'checklist', selection: { skills: [agent] } }, deps), { status: 400 })
})
test('inactive, wrong-task, revoked or superseded bindings cannot execute', async () => {
  const binding = LibraryBindingSchema.parse({ ...skill, tasks: ['conversation'] })
  assert.equal((await resolveDueDiligenceLibrary({ actor, task: 'checklist', bindings: [binding] }, deps)).snapshot.length, 0)
  assert.equal((await resolveDueDiligenceLibrary({ actor, task: 'conversation', bindings: [{ ...binding, enabled: false }] }, deps)).snapshot.length, 0)
  assert.equal((await resolveDueDiligenceLibrary({ actor, task: 'conversation', bindings: [binding], useSkills: false }, deps)).snapshot.length, 0)
  const result = await resolveDueDiligenceLibrary({ actor, task: 'conversation', bindings: [{ ...binding, version: 1 }] }, deps)
  assert.equal(result.snapshot.length, 0); assert.equal(result.warnings.length, 1)
  await assert.rejects(validateLibraryBindings(actor, [binding, binding], deps), /重复绑定/)
})
test('explicit and bound duplicate methods load once; only one agent is allowed per task', async () => {
  const binding = LibraryBindingSchema.parse({ ...skill, tasks: ['checklist'] })
  const result = await resolveDueDiligenceLibrary({ actor, task: 'checklist', bindings: [binding], selection: { skills: [skill] } }, deps)
  assert.equal(result.snapshot.length, 1)
  const two = [agent, { ...agent, id: 'another' }].map(item => LibraryBindingSchema.parse({ ...item, tasks: ['checklist'] }))
  const sameDeps = { ...deps, get: async (_actor: typeof actor, ref: { id: string }) => ({ ...agent, id: ref.id }) }
  await assert.rejects(validateLibraryBindings(actor, two, sameDeps), /最多绑定一个/)
})
test('method already loaded by a workflow is not injected again as a separate runtime Skill', async () => {
  const runtimeSkill = { ...skill, source: 'capability-skill' as const, id: '33333333-3333-4333-8333-333333333333' }
  const workflow = { ...agent, blueprint: { ...blueprint, modules: [{ ...blueprint.modules[0], skillIds: [runtimeSkill.id] }] } }
  const result = await resolveDueDiligenceLibrary({ actor, task: 'checklist', selection: { skills: [runtimeSkill], agent: workflow } }, { ...deps, get: async (_actor, ref) => ref.source === 'workflow' ? workflow : runtimeSkill })
  assert.equal(result.resources.length, 1)
})
test('no model, plugin, network, or executable is needed for empty/default selection', async () => {
  const result = await resolveDueDiligenceLibrary({ actor, task: 'checklist' }, { ...deps, get: async () => { throw new Error('must not load') }, run: async () => { throw new Error('must not execute') } })
  assert.equal(result.prompt, ''); assert.equal(await executeDueDiligenceLibrary(actor, result, '合成文本', undefined, deps), null)
  assert.equal(LibrarySelectionSchema.safeParse({ skills: Array(5).fill(skill) }).success, false)
  assert.equal(LibraryBindingSchema.safeParse({ ...skill, tasks: [] }).success, false)
})
test('existing workflow engine is reused and receives only authorized supplied input', async () => {
  const result = await resolveDueDiligenceLibrary({ actor, task: 'checklist', selection: { skills: [], agent }, projectId: 'project' }, deps)
  let called = 0
  const run: LibraryDependencies['run'] = async (caller, workflow, input, signal, projectId) => {
    assert.equal(caller.userId, actor.userId); assert.equal(projectId, 'project')
    return runAgentBlueprint(caller, workflow, input, undefined, signal, {
      resources: async () => ({ models: [], skills: [], resolveAiModelById: async () => ({ id: blueprint.modules[0].modelId, baseUrl: 'https://synthetic.invalid', apiKey: '', model: 'synthetic', timeoutMs: 1000 }) as never }),
      complete: async options => { called++; assert.match(JSON.stringify(options.messages), /合成材料/); return { text: '建议核实客户回款', model: 'synthetic' } as never },
    })
  }
  assert.equal((await executeDueDiligenceLibrary(actor, result, '合成材料', undefined, { ...deps, run }))?.status, 'succeeded')
  assert.equal(called, 1)
})
test('failed or cancelled workflows never deliver incomplete output and release capacity', async () => {
  const context = await resolveDueDiligenceLibrary({ actor, task: 'checklist', selection: { skills: [], agent } }, deps)
  await assert.rejects(executeDueDiligenceLibrary(actor, context, 'x', undefined, { ...deps, run: async () => ({ id: 'r', status: 'failed', output: 'INCOMPLETE', steps: [], durationMs: 1 }) }), { status: 502 })
  await assert.rejects(executeDueDiligenceLibrary(actor, context, 'x'.repeat(60001), undefined, deps), { status: 400 })
  const controller = new AbortController()
  const running = executeDueDiligenceLibrary(actor, context, 'x', controller.signal, { ...deps, run: async (_actor, _bp, _input, signal) => new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })) })
  await assert.rejects(executeDueDiligenceLibrary(actor, context, 'x', undefined, deps), { status: 429 })
  controller.abort(); await assert.rejects(running, /cancelled/)
  assert.equal((await executeDueDiligenceLibrary(actor, context, 'x', undefined, deps))?.status, 'succeeded')
})
test('bound methods enter own twin snapshot; public twin never receives private bindings or cases', async () => {
  const library = await resolveDueDiligenceLibrary({ actor, task: 'conversation', selection: { skills: [skill] } }, deps)
  const result = await resolveDueDiligenceTwinContext({ userId: actor.userId, twinId: 'twin', task: 'conversation' }, {
    twin: async () => ({ id: 'twin', name: '本人分身', ownerUserId: actor.userId, activeVersion: 3, rules: '核对原件', cases: 'PRIVATE_CASE', libraryBindings: [LibraryBindingSchema.parse({ ...skill, tasks: ['conversation'] })] }),
    skills: async () => [], sourceAccessible: async () => true, projectAccessible: async () => true, library: async () => library,
  })
  assert.equal(result.snapshot.library?.[0].id, skill.id); assert.match(result.prompt, /比对银行原始流水/)
  const publicText = safePublicTwinContext({ introduction: '公开简介', publicRules: '公开规则', publicCases: 'PRIVATE_CASE' })
  assert.doesNotMatch(publicText, /PRIVATE_CASE|比对银行原始流水/)
  assert.notEqual(libraryContentHash(result.snapshot), libraryContentHash({ ...result.snapshot, library: [] }))
})
test('saved workflow sharing is owner-controlled and withdrawal immediately denies other employees', async () => {
  for (const [key, value] of Object.entries({ DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_DATABASE: 'isolated_unit_test', DB_USERNAME: 'unit', DB_PASSWORD: 'unused', DB_FREFIX: 'unit_' })) process.env[key] ??= value
  const { getCallableAgentBlueprint, setAgentBlueprintSharing, canCallSavedAgent } = await import('../src/repositories/agentBlueprintRepository.js')
  const now = new Date()
  let row = { id: agent.id, version: 1, source: 'agent-builder', kind: 'agent', createdBy: actor.userId, config: { blueprint, blueprintVisibility: 'private' }, createdAt: now, updatedAt: now }
  const audit: unknown[] = []
  const executor = {
    transaction: async (work: (tx: unknown) => Promise<unknown>) => work(executor),
    select: () => ({ from: () => ({ where: () => ({ limit: () => Object.assign(Promise.resolve([row]), { for: async () => [row] }) }) }) }),
    update: () => ({ set: (patch: Partial<typeof row>) => ({ where: async () => { row = { ...row, ...patch }; return [{ affectedRows: 1 }] } }) }),
    insert: () => ({ values: async (value: unknown) => { audit.push(value) } }),
  } as unknown as NonNullable<Parameters<typeof getCallableAgentBlueprint>[2]>
  const other = { ...actor, userId: 'another-employee' }
  assert.equal(canCallSavedAgent(row, other.userId), false)
  await assert.rejects(setAgentBlueprintSharing(other, row.id, 1, 'organization', executor), { status: 404 })
  await assert.rejects(getCallableAgentBlueprint(other, row.id, executor), { status: 404 })
  const shared = await setAgentBlueprintSharing(actor, row.id, 1, 'organization', executor)
  assert.equal(shared.version, 2); assert.equal((await getCallableAgentBlueprint(other, row.id, executor)).id, row.id)
  await assert.rejects(setAgentBlueprintSharing(actor, row.id, 1, 'private', executor), { status: 409 })
  await setAgentBlueprintSharing(actor, row.id, 2, 'private', executor)
  await assert.rejects(getCallableAgentBlueprint(other, row.id, executor), { status: 404 })
  assert.equal(audit.length, 2)
  assert.equal(canCallSavedAgent({ ...row, source: 'uploaded', config: { blueprintVisibility: 'organization' } }, other.userId), false)
})
