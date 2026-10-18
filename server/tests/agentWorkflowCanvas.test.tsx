import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { tsImport } from 'tsx/esm/api'

register('data:text/javascript,' + encodeURIComponent(`export async function load(url, context, nextLoad) {
  return url.includes('.css') ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context)
}`), import.meta.url)
const { AgentWorkflowCanvas, createSequentialGraph, workflowConnectionProblem, arrangeWorkflowGraph, removeWorkflowModule } = await tsImport('../../src/components/AgentWorkflowCanvas.tsx', {
  parentURL: import.meta.url,
  tsconfig: new URL('../../tsconfig.app.json', import.meta.url).pathname,
})
const module = (id: string, kind: 'llm' | 'condition' | 'output' = 'llm') => ({ id, kind, name: id, modelId: 'model', prompt: 'Process', inputTemplate: '{{previous}}', skillIds: [], outputFormat: 'markdown' as const, outputInstructions: '' })
const blueprint = { schemaVersion: 1 as const, name: 'Agent', description: '', modules: [module('research'), module('report')] }

test('sequential migration preserves module configuration and creates persistent start and module positions', () => {
  const before = JSON.stringify(blueprint)
  const graph = createSequentialGraph(blueprint.modules)
  assert.deepEqual(graph.edges.map(edge => [edge.source, edge.target]), [['start', 'research'], ['research', 'report']])
  assert.ok(graph.positions.start.x < graph.positions.research.x)
  assert.ok(graph.positions.research.x < graph.positions.report.x)
  assert.equal(JSON.stringify(blueprint), before)
})

test('connection validation rejects cycles, duplicates, terminal outputs and ambiguous condition ports', () => {
  const draft = { ...blueprint, modules: [...blueprint.modules, module('decision', 'condition'), module('answer', 'output')], graph: createSequentialGraph(blueprint.modules) }
  assert.match(workflowConnectionProblem(draft, 'report', 'research'), /循环/)
  assert.match(workflowConnectionProblem(draft, 'start', 'research'), /已存在/)
  assert.match(workflowConnectionProblem(draft, 'answer', 'report'), /输出节点/)
  assert.match(workflowConnectionProblem(draft, 'research', 'answer', 'true'), /条件节点/)
  assert.match(workflowConnectionProblem(draft, 'decision', 'answer'), /分支/)
  assert.equal(workflowConnectionProblem(draft, 'decision', 'answer', 'true'), '')
  const withBranch = { ...draft, graph: { ...draft.graph, edges: [...draft.graph.edges, { id: 'yes', source: 'decision', target: 'answer', branch: 'true' as const }] } }
  assert.match(workflowConnectionProblem(withBranch, 'decision', 'report', 'true'), /已有连线/)
  assert.match(workflowConnectionProblem(draft, 'missing', 'report'), /不存在/)
})

test('auto layout respects graph depth and keeps same-depth branches on separate rows', () => {
  const modules = [module('decision', 'condition'), module('yes'), module('no')]
  const graph = { edges: [{ id: 'a', source: 'start', target: 'decision' }, { id: 'b', source: 'decision', target: 'yes', branch: 'true' as const }, { id: 'c', source: 'decision', target: 'no', branch: 'false' as const }], positions: { start: { x: 1, y: 2 } } }
  const arranged = arrangeWorkflowGraph(modules, graph)
  assert.equal(arranged.positions.yes.x, arranged.positions.no.x)
  assert.notEqual(arranged.positions.yes.y, arranged.positions.no.y)
  assert.ok(arranged.positions.yes.x > arranged.positions.decision.x)
  assert.equal(graph.positions.start.x, 1)
})

test('removing a module removes its position and touching edges without mutating the source', () => {
  const draft = { ...blueprint, graph: createSequentialGraph(blueprint.modules) }
  const next = removeWorkflowModule(draft, 'research')
  assert.deepEqual(next.modules.map(item => item.id), ['report'])
  assert.equal(next.graph.edges.length, 0)
  assert.equal(next.graph.positions.research, undefined)
  assert.equal(draft.graph.edges.length, 2)
})

test('canvas renders authoring controls, keyboard alternatives, node types and disabled states', () => {
  const html = renderToStaticMarkup(<AgentWorkflowCanvas blueprint={blueprint} onChange={() => {}} selectedModuleId="research" onSelectModule={() => {}} disabled />)
  for (const label of ['节点画布', '添加模型节点', '添加条件节点', '添加输出节点', '自动排列', '放大画布', '缩小画布', '表单连线', '起点', '终点', '创建连线', '移动选中节点向左', '删除选中节点', '开始', 'research', 'report']) assert.ok(html.includes(label), label)
  assert.match(html, /aria-pressed="true"/)
  assert.match(html, /disabled=""/)
  assert.match(html, /方向键移动/)
})

test('empty workflow has guidance and still exposes the start node', () => {
  const html = renderToStaticMarkup(<AgentWorkflowCanvas blueprint={{ ...blueprint, modules: [] }} onChange={() => {}} selectedModuleId="" onSelectModule={() => {}} />)
  assert.ok(html.includes('添加第一个模型节点'))
  assert.ok(html.includes('开始'))
})

test('branch ports, terminal output and run results are distinguishable without color alone', () => {
  const modules = [module('decision', 'condition'), module('yes'), module('answer', 'output')]
  const graph = arrangeWorkflowGraph(modules, { edges: [{ id: 'a', source: 'start', target: 'decision' }, { id: 'b', source: 'decision', target: 'yes', branch: 'true' }, { id: 'c', source: 'decision', target: 'answer', branch: 'false' }], positions: {} })
  const run = { id: 'run', status: 'succeeded', output: 'done', durationMs: 1, steps: [{ moduleId: 'yes', name: 'yes', modelId: 'model', status: 'succeeded', input: '', output: 'done', durationMs: 1 }] }
  const html = renderToStaticMarkup(<AgentWorkflowCanvas blueprint={{ ...blueprint, modules, graph }} onChange={() => {}} selectedModuleId="yes" onSelectModule={() => {}} run={run} modelNames={{ model: '演示模型' }} />)
  assert.ok(html.includes('从 decision 的真分支连线'))
  assert.ok(html.includes('从 decision 的假分支连线'))
  assert.ok(!html.includes('从 answer 连线'))
  assert.ok(html.includes('演示模型'))
  assert.ok(html.includes('✓ 已完成'))
})


test('manual data nodes have distinct editable summaries and start is a configurable input node', () => {
  const modules = [
    { ...module('format'), kind:'template', inputTemplate:'公司：{{input}}' },
    { ...module('extract'), kind:'json-extract', jsonExtract:{path:'company.name',missing:'error'} },
    { ...module('merge'), kind:'aggregate', aggregate:{sources:['previous'],mode:'first-non-empty',separator:'\n'} },
    { ...module('clean'), kind:'text-process', textProcess:{operation:'trim'} },
  ]
  const html = renderToStaticMarkup(<AgentWorkflowCanvas blueprint={{ ...blueprint, modules, inputFields:[{name:'company',label:'公司名称',type:'text',required:true}] }} onChange={()=>{}} selectedModuleId="start" onSelectModule={()=>{}} />)
  for (const label of ['模板转换','JSON 字段提取','变量聚合','文本处理','company.name','公司名称','可编辑输入','复制选中节点','更多处理节点','无需模型','已选中：开始']) assert.ok(html.includes(label),label)
})
