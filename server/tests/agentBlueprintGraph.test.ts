import assert from 'node:assert/strict'
import test from 'node:test'
import { executeAgentBlueprint, validateAgentBlueprint, exportAgentBlueprint, importAgentBlueprint, runAgentBlueprint, renderAgentBlueprintInput } from '../src/services/agentBlueprintService.js'
const modelId = '11111111-1111-4111-8111-111111111111'
const module = (id: string, extra = {}) => ({ id, name: id, modelId, prompt: 'process', inputTemplate: '{{previous}}', skillIds: [], outputFormat: 'text' as const, outputInstructions: '', ...extra })
const graph = () => ({ schemaVersion: 1 as const, name: '分支图', description: '', modules: [module('end', { kind: 'output', modelId: '', prompt: '' }), module('no'), module('yes'), module('judge', { kind: 'condition', modelId: '', prompt: '', condition: { source: 'input', operator: 'contains', value: 'yes' } })], graph: { positions: { start: { x: 0, y: 0 } }, edges: [{ id: 's', source: 'start', target: 'judge' }, { id: 'y', source: 'judge', target: 'yes', branch: 'true' }, { id: 'n', source: 'judge', target: 'no', branch: 'false' }, { id: 'ye', source: 'yes', target: 'end' }, { id: 'ne', source: 'no', target: 'end' }] } })
test('graph executes topologically, chooses a real branch and merges only active parents without model calls for control nodes', async () => {
  for (const [input, chosen] of [['yes please', 'yes'], ['other', 'no']]) {
    const calls: string[] = []
    const result = await executeAgentBlueprint(graph(), input, async (node, text) => { calls.push(node.id); assert.equal(text, input); return `result:${node.id}` })
    assert.deepEqual(calls, [chosen]); assert.equal(result.output, `result:${chosen}`)
    assert.deepEqual(result.steps.map((step) => step.moduleId), ['judge', 'no', 'yes', 'end'])
    assert.equal(result.steps.find((step) => step.moduleId === (chosen === 'yes' ? 'no' : 'yes'))?.status, 'skipped')
  }
})
test('graph rejects cycles, disconnected nodes, invalid branch wiring, reserved IDs and non-ancestor references', () => {
  assert.equal(validateAgentBlueprint(graph()).modules.length, 4)
  const change = (edges: unknown[]) => ({ ...graph(), graph: { ...graph().graph, edges } })
  assert.throws(() => validateAgentBlueprint(change([...graph().graph.edges, { id: 'cycle', source: 'end', target: 'judge' }])))
  assert.throws(() => validateAgentBlueprint(change(graph().graph.edges.filter((edge) => edge.target !== 'no'))))
  assert.throws(() => validateAgentBlueprint(change(graph().graph.edges.map((edge) => edge.id === 'y' ? { ...edge, branch: undefined } : edge))))
  assert.throws(() => validateAgentBlueprint({ ...graph(), modules: graph().modules.map((node) => node.id === 'yes' ? { ...node, inputTemplate: '{{modules.no}}' } : node) }))
  assert.throws(() => validateAgentBlueprint({ ...graph(), modules: [module('start')] }))
})
test('throughModuleId restricts execution to its ancestors and failure retains preceding results', async () => {
  const calls: string[] = []
  const partial = await executeAgentBlueprint(graph(), 'yes', async (node) => { calls.push(node.id); return node.id }, 'yes')
  assert.deepEqual(calls, ['yes']); assert.deepEqual(partial.steps.map((step) => step.moduleId), ['judge', 'yes'])
  const linear = { schemaVersion: 1, name: '链', description: '', modules: [module('a'), module('b'), module('c')], graph: { positions: {}, edges: [{ id: 's', source: 'start', target: 'a' }, { id: 'b', source: 'a', target: 'b' }, { id: 'c', source: 'b', target: 'c' }] } }
  const failed = await executeAgentBlueprint(linear, 'x', async (node) => { if (node.id === 'b') throw new Error('secret'); return 'kept' })
  assert.equal(failed.status, 'failed'); assert.equal(failed.output, 'kept'); assert.deepEqual(failed.steps.map((step) => step.status), ['succeeded', 'failed', 'skipped'])
})
test('exports graph with layout and portable execution semantics', () => {
  const exported = exportAgentBlueprint(graph(), 'json')
  assert.deepEqual(importAgentBlueprint(JSON.parse(exported.content)), graph())
  assert.equal(JSON.parse(exported.content).portability.execution, 'directed-acyclic-graph')
  assert.match(exportAgentBlueprint(graph(), 'markdown').content, /```json/)
})
test('control nodes need no model authorization; unrelated partial nodes are not authorized', async () => {
  const resolved: string[] = []
  const deps = { resources: async () => ({ models: [], skills: [], resolveAiModelById: async (id: string) => { resolved.push(id); return id === modelId ? { modelId, model: 'test', timeoutMs: 1_000 } : null } }), complete: async () => ({ text: 'ok' }) } as unknown as import('../src/services/agentBlueprintService.js').AgentBlueprintRuntimeDependencies
  const value = graph(); value.modules = value.modules.map((node) => node.id === 'no' ? { ...node, modelId: '22222222-2222-4222-8222-222222222222' } : node)
  const actor = { userId: 'graph-owner', userName: 'x', role: '研究员', department: '' }
  assert.equal((await runAgentBlueprint(actor, value, 'yes', 'yes', undefined, deps)).output, 'ok')
  assert.deepEqual(resolved, [modelId])
  await assert.rejects(runAgentBlueprint({ ...actor, userId: 'graph-denied' }, value, 'yes', undefined, undefined, deps), { code: 'AGENT_BLUEPRINT_MODEL_FORBIDDEN' })
})
test('legacy sequential workflows continue after a skipped intermediate node', async () => {
  const value = { schemaVersion: 1, name: '旧模板', description: '', modules: [module('a'), module('skip', { condition: { source: 'input', operator: 'equals', value: 'never' } }), module('c')] }
  const calls: string[] = []
  const result = await executeAgentBlueprint(value, 'input', async (node) => { calls.push(node.id); return node.id })
  assert.deepEqual(calls, ['a', 'c']); assert.equal(result.output, 'c')
})
test('graph merges multiple active parents in stable module order and allows ancestor references across array order', async () => {
  const value = { schemaVersion: 1, name: '合流', description: '', modules: [module('b'), module('end', { kind: 'output', modelId: '', prompt: '', inputTemplate: '{{previous}}|{{modules.a}}' }), module('a')], graph: { positions: {}, edges: [{ id: 'a', source: 'start', target: 'a' }, { id: 'b', source: 'start', target: 'b' }, { id: 'ae', source: 'a', target: 'end' }, { id: 'be', source: 'b', target: 'end' }] } }
  const result = await executeAgentBlueprint(value, 'input', async (node) => node.id)
  assert.equal(result.output, 'b\n\na|a')
})
test('a disconnected caller stops before the next node and keeps completed output', async () => {
  const controller = new AbortController()
  const value = { schemaVersion: 1, name: 'cancel', description: '', modules: [module('a'), module('b')] }
  const calls: string[] = []
  const result = await executeAgentBlueprint(value, 'x', async (node) => { calls.push(node.id); controller.abort(); return 'kept' }, undefined, controller.signal)
  assert.deepEqual(calls, ['a']); assert.equal(result.status, 'failed'); assert.equal(result.output, 'kept')
})
test('the 150 second run budget stops the next step and preserves prior output', async (t) => {
  let now = 1_000
  t.mock.method(Date, 'now', () => now)
  const calls: string[] = []
  const result = await executeAgentBlueprint({ schemaVersion: 1, name: '预算', description: '', modules: [module('a'), module('b')] }, 'x', async (node) => { calls.push(node.id); now += 150_001; return 'saved' })
  assert.deepEqual(calls, ['a']); assert.equal(result.status, 'failed'); assert.equal(result.output, 'saved')
})
test('invalid control nodes and conditional cross-branch sources cannot be saved', () => {
  const value = graph()
  assert.throws(() => validateAgentBlueprint({ ...value, modules: value.modules.map((node) => node.id === 'judge' ? { ...node, condition: undefined } : node) }))
  assert.throws(() => validateAgentBlueprint({ ...value, modules: value.modules.map((node) => node.id === 'no' ? { ...node, condition: { source: 'yes', operator: 'equals', value: '' } } : node) }))
  assert.throws(() => validateAgentBlueprint({ ...value, graph: { ...value.graph, edges: [...value.graph.edges, value.graph.edges[0]] } }))
  assert.throws(() => validateAgentBlueprint({ ...value, graph: { ...value.graph, edges: value.graph.edges.map((edge) => edge.id === 's' ? { ...edge, target: 'missing' } : edge) } }))
})

test('bounded interpolation rejects a reference expansion before creating the result', () => {
  assert.throws(() => renderAgentBlueprintInput('{{input}}{{input}}{{input}}', 'x'.repeat(60_000), {}, ''), /120000/)
  assert.equal(renderAgentBlueprintInput('{{input}}{{input}}', 'x'.repeat(60_000), {}, '').length, 120_000)
})
test('maximum legal placeholder templates cannot amplify the run response or render skipped nodes', async () => {
  const template = '{{input}}'.repeat(1_777)
  const value = { schemaVersion: 1, name: 'bounded', description: '', modules: Array.from({ length: 12 }, (_, index) => module(`step${index}`, { inputTemplate: index ? template : '{{input}}' })) }
  const calls: string[] = []
  const result = await executeAgentBlueprint(value, 'x'.repeat(60_000), async (node) => { calls.push(node.id); return 'kept' })
  assert.deepEqual(calls, ['step0']); assert.equal(result.status, 'failed'); assert.equal(result.output, 'kept')
  assert.equal(result.steps[1].status, 'failed'); assert.equal(result.steps[1].input, '')
  assert.ok(result.steps.slice(2).every((step) => step.status === 'skipped' && step.input === ''))
  assert.ok(JSON.stringify(result).length < 65_000)
})
test('inactive branches and false sequential conditions do not render oversized inputs', async () => {
  const value = graph()
  value.modules = value.modules.map((node) => node.id === 'no' ? { ...node, inputTemplate: '{{input}}'.repeat(1_777) } : node)
  const input = 'yes' + 'x'.repeat(59_997)
  const result = await executeAgentBlueprint(value, input, async () => 'ok')
  assert.equal(result.status, 'succeeded'); assert.equal(result.steps.find((step) => step.moduleId === 'no')?.input, '')
  const sequential = await executeAgentBlueprint({ schemaVersion: 1, name: 'skip', description: '', modules: [module('skip', { inputTemplate: '{{input}}'.repeat(1_777), condition: { source: 'input', operator: 'equals', value: 'never' } })] }, input, async () => 'unexpected')
  assert.equal(sequential.status, 'succeeded'); assert.equal(sequential.steps[0].status, 'skipped'); assert.equal(sequential.steps[0].input, '')
})
test('joining active parent outputs enforces the same budget before allocating joined text', async () => {
  const value = { schemaVersion: 1, name: 'join-bound', description: '', modules: [module('a'), module('b'), module('end', { kind: 'output', modelId: '', prompt: '' })], graph: { positions: {}, edges: [{ id: 'a', source: 'start', target: 'a' }, { id: 'b', source: 'start', target: 'b' }, { id: 'ae', source: 'a', target: 'end' }, { id: 'be', source: 'b', target: 'end' }] } }
  const result = await executeAgentBlueprint(value, 'input', async () => 'x'.repeat(60_000))
  assert.equal(result.status, 'failed'); assert.equal(result.steps[2].input, '')
  assert.equal(result.output.length, 60_000)
})
