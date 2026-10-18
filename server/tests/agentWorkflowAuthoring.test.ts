import test from 'node:test'
import assert from 'node:assert/strict'
import { WORKFLOW_NODE_CATALOG, createWorkflowModule, duplicateWorkflowModule } from '../../src/lib/agentWorkflowAuthoring.js'
import type { AgentBlueprint } from '../src/contracts/agentBlueprintContract.js'

test('manual palette exposes real model, control and deterministic data nodes with editable defaults', () => {
  assert.deepEqual(WORKFLOW_NODE_CATALOG.map(node => node.kind).sort(), ['aggregate', 'condition', 'json-extract', 'llm', 'output', 'template', 'text-process'])
  const model = createWorkflowModule('llm', 'model-id', 'model_node')
  assert.equal(model.modelId, 'model-id')
  assert.equal(model.prompt, '')
  const template = createWorkflowModule('template', 'unused', 'template_node')
  assert.equal(template.modelId, '')
  assert.equal(template.inputTemplate, '{{previous}}')
  assert.deepEqual(createWorkflowModule('json-extract', '', 'extract_node').jsonExtract, { path: '', missing: 'error' })
  assert.deepEqual(createWorkflowModule('aggregate', '', 'aggregate_node').aggregate, { sources: ['previous'], mode: 'first-non-empty', separator: '\n\n' })
  assert.deepEqual(createWorkflowModule('text-process', '', 'text_node').textProcess, { operation: 'trim' })
})

test('duplicate deep copies each editable field, gets a unique ID and keeps graph edges unchanged', () => {
  const original = createWorkflowModule('llm', 'model-id', 'research')
  const blueprint: AgentBlueprint = { schemaVersion: 1, name: 'manual', description: '', modules: [{ ...original, prompt: 'original', skillIds: ['skill-id'] }], graph: { positions: { start: {x:64,y:140}, research:{x:394,y:140} }, edges: [{id:'start-research',source:'start',target:'research'}] } }
  const next = duplicateWorkflowModule(blueprint, 'research', 'research_copy')
  assert.equal(next.modules[1].id, 'research_copy')
  assert.equal(next.modules[1].name, '模型处理 副本')
  assert.notEqual(next.modules[1].skillIds, blueprint.modules[0].skillIds)
  next.modules[1].skillIds.push('copy-only')
  assert.deepEqual(blueprint.modules[0].skillIds, ['skill-id'])
  assert.deepEqual(next.graph?.edges, blueprint.graph?.edges, 'copies must be deliberately connected, not accidentally duplicate branch wiring')
  assert.ok(next.graph?.positions.research_copy)
  assert.equal(blueprint.modules.length, 1)
})

test('sequential duplicate inserts after the selected node and rejects invalid or excessive copies', () => {
  const blueprint: AgentBlueprint = { schemaVersion:1,name:'manual',description:'',modules:[createWorkflowModule('llm','','first'),createWorkflowModule('template','','second')] }
  assert.deepEqual(duplicateWorkflowModule(blueprint,'first','copy').modules.map(node=>node.id),['first','copy','second'])
  assert.throws(()=>duplicateWorkflowModule(blueprint,'absent','copy'),/不存在/)
  assert.throws(()=>duplicateWorkflowModule(blueprint,'first','second'),/ID/)
  assert.throws(()=>duplicateWorkflowModule(blueprint,'first','start'),/ID/)
  assert.throws(()=>duplicateWorkflowModule({...blueprint,modules:Array.from({length:12},(_,i)=>createWorkflowModule('llm','',`node_${i}`))},'node_0','copy'),/12/)
})
