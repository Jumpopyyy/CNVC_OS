import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { tsImport } from 'tsx/esm/api'

register('data:text/javascript,' + encodeURIComponent(`export async function load(url, context, nextLoad) {
  return url.includes('.css') ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context)
}`), import.meta.url)
const { AgentBlueprintBuilder, AgentBlueprintProposal, AgentRunResults, agentBlueprintRunNotice, blueprintReferenceProblem, reorderBlueprintModules, readBlueprintImport } = await tsImport('../../src/components/AgentBlueprintBuilder.tsx', {
  parentURL: import.meta.url,
  tsconfig: new URL('../../tsconfig.app.json', import.meta.url).pathname,
})
const module = (id: string, inputTemplate = '{{input}}') => ({ id, name: id, modelId: 'model', prompt: 'Process', inputTemplate, skillIds: [], outputFormat: 'markdown' as const, outputInstructions: '' })

test('builder renders named authoring controls and loading feedback without a server', () => {
  const html = renderToStaticMarkup(<AgentBlueprintBuilder initialMode="simple" />)
  for (const label of ['Agent 工作台', '用一句话设计 Agent', '个人模板', '空白创建', '导入 JSON', '保存模板', '导出 JSON', '导出 Markdown', '模块流程', '模块名称', '使用模型', '目标与提示词', '输入映射', '输出格式', '试运行输入']) {
    assert.ok(html.includes(label), label)
  }
  assert.ok(html.includes('role="status"'))
  assert.match(html, /<fieldset[^>]*disabled=""/, 'do not edit until permissions and model catalog are loaded')
})

test('references allow only prior modules, including conditions, so reorder cannot silently change input provenance', () => {
  const first = module('research')
  const second = module('report', '{{modules.research}}')
  assert.equal(blueprintReferenceProblem([first, second]), '')
  const reordered = reorderBlueprintModules([first, second], 'report', -1)
  assert.match(blueprintReferenceProblem(reordered), /research/)
  assert.deepEqual([first, second].map(item => item.id), ['research', 'report'], 'reorder is immutable')
  assert.match(blueprintReferenceProblem([module('only', '{{modules.absent}}')]), /absent/)
  assert.match(blueprintReferenceProblem([{ ...first, condition: { source: 'report', operator: 'not_empty', value: '' } }, second]), /report/)
  assert.equal(blueprintReferenceProblem([{ ...second, inputTemplate: '{{previous}}' }]), '')
})

test('moving boundary or unknown modules leaves the workflow order intact', () => {
  const modules = [module('first'), module('second')]
  assert.deepEqual(reorderBlueprintModules(modules, 'first', -1), modules)
  assert.deepEqual(reorderBlueprintModules(modules, 'second', 1), modules)
  assert.deepEqual(reorderBlueprintModules(modules, 'missing', 1), modules)
})

test('portable exports with large Skill dependencies import only the blueprint and enforce a byte ceiling', async () => {
  const blueprint = { schemaVersion: 1, name: 'portable', description: '', modules: [module('first')] }
  const exported = { format: 'cnvc-agent-blueprint', schemaVersion: 1, blueprint, dependencies: { skills: [{ instructions: '中'.repeat(700_000) }] } }
  const file = new File([JSON.stringify(exported)], 'agent.json', { type: 'application/json' })
  assert.ok(file.size > 1024 * 1024, 'valid exports can exceed 1 MB')
  assert.deepEqual(await readBlueprintImport(file), blueprint)
  assert.deepEqual(await readBlueprintImport(new File([JSON.stringify(blueprint)], 'raw.json')), blueprint)
  await assert.rejects(readBlueprintImport(new File(['invalid'], 'invalid.json')), /有效的 JSON/)
  await assert.rejects(readBlueprintImport(new File([new Uint8Array(16 * 1024 * 1024 + 1)], 'large.json')), /16 MB/)
})

test('manual canvas is the default path and retains explicit undo and single-node testing',()=>{
  const html=renderToStaticMarkup(<AgentBlueprintBuilder />)
  for(const label of ['手动搭建','节点画布','撤销修改','重做修改','仅测试当前节点','直接父节点输出','本节点原始输入']) assert.ok(html.includes(label),label)
  assert.ok(html.includes('AI 搭建对话'),'manual canvas must expose a right-hand conversational designer')
  assert.ok(html.includes('节点配置'))
  assert.ok(!html.includes('告诉 AI 帮我搭建模块'),'replace the top generation form with the conversation panel')
})

test('workflow summaries make fallback, attempt count and condition outcome visible before expansion', () => {
  const run = { id: 'r', status: 'succeeded', durationMs: 2, output: '默认输出', steps: [
    { moduleId: 'extract', name: '字段提取', modelId: '', status: 'succeeded', input: '{}', output: '默认输出', durationMs: 1, fallback: true, attempts: 2 },
    { moduleId: 'condition', name: '分支判断', modelId: '', status: 'succeeded', input: '默认输出', output: '默认输出', durationMs: 1, attempts: 1, conditionMatched: false },
  ] }
  const html = renderToStaticMarkup(<AgentRunResults run={run} />)
  const summaries = [...html.matchAll(/<summary>(.*?)<\/summary>/g)].map(match => match[1])
  assert.match(summaries[0], /使用默认输出 · 尝试 2 次/)
  assert.match(summaries[1], /条件不满足（假） · 尝试 1 次/)
  assert.equal(agentBlueprintRunNotice(run), '试运行完成；部分节点使用了默认输出，请检查运行结果')
  assert.equal(agentBlueprintRunNotice({ ...run, status: 'failed' }), '试运行中断，请查看失败模块；部分节点使用了默认输出，请检查运行结果')
  assert.equal(agentBlueprintRunNotice({ ...run, steps: [] }), '试运行完成')
})

test('AI proposal previews escaped module instructions and explicit adopt/discard actions', () => {
  const blueprint = { schemaVersion: 1, name: '待确认方案', description: '采用前保留原画布', modules: [{ ...module('review'), name: '资料核查', prompt: '<script>untrusted()</script>', inputTemplate: '{{input}}' }] }
  const html = renderToStaticMarkup(<AgentBlueprintProposal blueprint={blueprint} onApply={() => {}} onDiscard={() => {}} />)
  for (const text of ['AI 搭建方案预览', '资料核查', '采用方案并替换画布', '保留原画布，放弃方案', '可以撤销', '{{input}}']) assert.ok(html.includes(text), text)
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('&lt;script&gt;'))
})
