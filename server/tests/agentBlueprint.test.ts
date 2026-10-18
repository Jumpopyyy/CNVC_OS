import assert from 'node:assert/strict'
import test from 'node:test'
import { validateAgentBlueprint, renderAgentBlueprintInput, agentBlueprintConditionMatches, executeAgentBlueprint, exportAgentBlueprint, importAgentBlueprint } from '../src/services/agentBlueprintService.js'

const modelId = '11111111-1111-4111-8111-111111111111'
const blueprint = { schemaVersion: 1 as const, name: '研究助手', description: '分步研究', modules: [
  { id: 'research', name: '研究', modelId, prompt: '研究输入', inputTemplate: '{{input}}', skillIds: [], outputFormat: 'text' as const, outputInstructions: '' },
  { id: 'report', name: '报告', modelId, prompt: '汇总', inputTemplate: '{{modules.research}}\n{{previous}}', skillIds: [], outputFormat: 'markdown' as const, outputInstructions: '', condition: { source: 'research', operator: 'contains' as const, value: '继续' } },
] }
test('validates ordering, unique IDs and rejects code-like references', () => {
  assert.equal(validateAgentBlueprint(blueprint).modules.length, 2)
  assert.throws(() => validateAgentBlueprint({ ...blueprint, modules: [blueprint.modules[1], blueprint.modules[0]] }))
  assert.throws(() => validateAgentBlueprint({ ...blueprint, modules: [blueprint.modules[0], blueprint.modules[0]] }))
  assert.throws(() => validateAgentBlueprint({ ...blueprint, modules: [{ ...blueprint.modules[0], inputTemplate: '{{process.env}}' }] }))
})
test('renders only previous outputs and evaluates declarative conditions', () => {
  assert.equal(renderAgentBlueprintInput('{{input}}|{{previous}}|{{modules.research}}', 'hello', { research: '继续研究' }, '继续研究'), 'hello|继续研究|继续研究')
  assert.equal(agentBlueprintConditionMatches(blueprint.modules[1].condition!, 'hi', { research: '继续研究' }, '继续研究'), true)
  assert.equal(agentBlueprintConditionMatches(blueprint.modules[1].condition!, 'hi', { research: '停止' }, '停止'), false)
})
test('executes sequentially and preserves skipped/error step results without leaking provider details', async () => {
  const prompts: string[] = []
  const run = await executeAgentBlueprint(blueprint, '原始材料', async (module, input) => { prompts.push(input); return module.id === 'research' ? '继续研究' : '完成' })
  assert.equal(run.status, 'succeeded'); assert.deepEqual(prompts, ['原始材料', '继续研究\n继续研究']); assert.equal(run.output, '完成')
  const skipped = await executeAgentBlueprint(blueprint, '材料', async () => '停止')
  assert.equal(skipped.steps[1].status, 'skipped')
  const failure = await executeAgentBlueprint(blueprint, '材料', async () => { throw new Error('secret sk-abc123') })
  assert.equal(failure.status, 'failed'); assert.ok(!JSON.stringify(failure).includes('sk-abc123')); assert.equal(failure.steps[1].status, 'skipped')
})
test('portable export round trips prompts and rejects secrets/unknown schemas', () => {
  const portable = exportAgentBlueprint(blueprint, 'json')
  assert.deepEqual(importAgentBlueprint(JSON.parse(portable.content)), blueprint)
  assert.match(exportAgentBlueprint(blueprint, 'markdown').content, /研究输入/)
  assert.throws(() => importAgentBlueprint({ schemaVersion: 2, blueprint }))
  assert.throws(() => validateAgentBlueprint({ ...blueprint, apiKey: 'secret' }))
})

test('runtime authorization, chosen model, instruction loading and portable mappings', async () => {
  const { runAgentBlueprint, generateAgentBlueprint, exportAuthorizedAgentBlueprint, getAgentBlueprintCatalog, withAgentBlueprintRunLimit } = await import('../src/services/agentBlueprintService.js')
  const actor = { userId: 'runtime-owner', userName: 'Owner', role: '研究员', department: '研究' }
  const skillId = '22222222-2222-4222-8222-222222222222'
  const calls: unknown[] = []
  const deps = {
    resources: async () => ({ models: [{ id: modelId, displayName: '授权模型', modelKey: 'test-model' }], skills: [{ id: skillId, name: '研究规则', source: 'uploaded', kind: 'skill', config: { instructions: '请核验证据' } }], resolveAiModelById: async (id: string) => id === modelId ? { modelId, model: 'test-model', baseUrl: 'https://example.invalid', apiKey: 'not-exported-secret', timeoutMs: 1000, providerId: 'p' } : null }),
    complete: async (request: { messages: { content: string }[] }) => { calls.push(request); return { text: '继续研究', usage: null } },
  } as unknown as import('../src/services/agentBlueprintService.js').AgentBlueprintRuntimeDependencies
  const workflow = { ...blueprint, modules: [{ ...blueprint.modules[0], skillIds: [skillId] }] }
  const run = await runAgentBlueprint(actor, workflow, '输入', undefined, undefined, deps)
  assert.equal(run.status, 'succeeded'); assert.match(JSON.stringify(calls), /请核验证据/)
  await assert.rejects(runAgentBlueprint(actor, { ...workflow, modules: [{ ...workflow.modules[0], modelId: skillId }] }, '', undefined, undefined, deps), { code: 'AGENT_BLUEPRINT_MODEL_FORBIDDEN' })
  await assert.rejects(runAgentBlueprint(actor, { ...workflow, modules: [{ ...workflow.modules[0], skillIds: [modelId] }] }, '', undefined, undefined, deps), { code: 'AGENT_BLUEPRINT_SKILL_FORBIDDEN' })
  const exported = await exportAuthorizedAgentBlueprint(actor, workflow, 'json', deps)
  assert.match(exported.content, /test-model/); assert.match(exported.content, /请核验证据/); assert.ok(!exported.content.includes('not-exported-secret'))
  assert.deepEqual(importAgentBlueprint(JSON.parse(exported.content)), workflow)
  const markdown = await exportAuthorizedAgentBlueprint(actor, workflow, 'markdown', deps)
  assert.match(markdown.content, /请核验证据/)
  const catalog = await getAgentBlueprintCatalog(actor, deps)
  assert.equal(catalog.skills[0].executionMode, 'instructions-only')
  const generation = { ...deps, complete: async () => ({ text: JSON.stringify(workflow), usage: null }) }
  assert.equal((await generateAgentBlueprint({ ...actor, userId: 'generator' }, '帮我研究材料', modelId, undefined, generation)).blueprint.name, blueprint.name)
  await assert.rejects(generateAgentBlueprint({ ...actor, userId: 'bad-generation' }, '需求', modelId, undefined, { ...deps, complete: async () => { throw new Error('secret key') } }), (error: Error) => !error.message.includes('secret'))
  let release!: () => void
  const pending = withAgentBlueprintRunLimit('concurrent-owner', () => new Promise<void>((resolve) => { release = resolve }))
  await assert.rejects(withAgentBlueprintRunLimit('concurrent-owner', async () => {}), { code: 'AGENT_BLUEPRINT_BUSY' })
  release(); await pending
  await withAgentBlueprintRunLimit('concurrent-owner', async () => {})
  for (let index = 0; index < 5; index++) await withAgentBlueprintRunLimit('rate-owner', async () => {})
  await assert.rejects(withAgentBlueprintRunLimit('rate-owner', async () => {}), { code: 'AGENT_BLUEPRINT_RATE_LIMIT' })
})

test('execution validates JSON, bounds, partial test selection and original-input conditions', async () => {
  assert.equal(agentBlueprintConditionMatches({ source: 'input', operator: 'equals', value: ' x ' }, 'x', {}, ''), true)
  assert.equal(agentBlueprintConditionMatches({ source: 'previous', operator: 'not_contains', value: 'x' }, '', {}, 'y'), true)
  assert.equal(agentBlueprintConditionMatches({ source: 'previous', operator: 'not_empty', value: '' }, '', {}, ' '), false)
  assert.equal((await executeAgentBlueprint(blueprint, '', async () => '继续', 'research')).steps.length, 1)
  await assert.rejects(executeAgentBlueprint(blueprint, '', async () => '', 'missing'))
  const json = { ...blueprint, modules: [{ ...blueprint.modules[0], outputFormat: 'json' as const }] }
  assert.equal((await executeAgentBlueprint(json, '', async () => 'broken JSON')).status, 'failed')
  assert.equal((await executeAgentBlueprint(json, '', async () => '{"ok":true}')).status, 'succeeded')
  assert.equal((await executeAgentBlueprint(blueprint, '', async () => '')).status, 'failed')
  assert.equal((await executeAgentBlueprint(blueprint, '', async () => 'x'.repeat(120001))).status, 'failed')
  assert.throws(() => validateAgentBlueprint({ ...blueprint, modules: [{ ...blueprint.modules[0], skillIds: [modelId, modelId] }] }))
})

test('skipped modules named like object properties never resolve inherited values', async () => {
  assert.equal(renderAgentBlueprintInput('{{modules.constructor}}', '', {}, ''), '')
  assert.equal(agentBlueprintConditionMatches({ source: 'constructor', operator: 'not_empty', value: '' }, '', {}, ''), false)
  const workflow = { ...blueprint, modules: [
    { ...blueprint.modules[0], id: 'constructor', condition: { source: 'input', operator: 'contains' as const, value: 'run' } },
    { ...blueprint.modules[0], id: 'last', inputTemplate: '{{modules.constructor}}', condition: { source: 'constructor', operator: 'not_empty' as const, value: '' } },
  ] }
  const result = await executeAgentBlueprint(workflow, 'skip', async () => 'unexpected')
  assert.deepEqual(result.steps.map((step) => step.status), ['skipped', 'skipped'])
})
