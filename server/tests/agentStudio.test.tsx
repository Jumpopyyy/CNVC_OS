import assert from 'node:assert/strict'
import test from 'node:test'
import { register } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { tsImport } from 'tsx/esm/api'
import { createMarkdownAgent, readAgentMarkdown } from '../../src/lib/agentBlueprintAuthoring.js'

register('data:text/javascript,' + encodeURIComponent(`export async function load(url, context, nextLoad) { return url.includes('.css') ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context) }`), import.meta.url)

test('Markdown authoring preserves the complete prompt without a model request', async () => {
  const markdown = '# 研究方法\n\n## 步骤\n保留证据，不执行外部脚本。\n\n```sh\necho example\n```'
  const draft = createMarkdownAgent(markdown, '11111111-1111-4111-8111-111111111111')
  assert.equal(draft.name, '研究方法')
  assert.equal(draft.modules.length, 1)
  assert.equal(draft.modules[0].prompt, markdown)
  assert.equal(draft.modules[0].inputTemplate, '{{input}}')
  assert.deepEqual(draft.modules[0].skillIds, [])
  assert.equal(await readAgentMarkdown(new File([markdown], '方法.md')), markdown)
  assert.throws(() => createMarkdownAgent('', 'model'), /Markdown/)
  assert.throws(() => createMarkdownAgent(markdown, ''), /模型/)
  assert.throws(() => createMarkdownAgent('字'.repeat(16001), 'model'), /16000/)
  await assert.rejects(readAgentMarkdown(new File([new Uint8Array([0xff])], 'bad.md')), /UTF-8/)
  await assert.rejects(readAgentMarkdown(new File(['text'], 'script.js')), /Markdown/)
})

test('Studio keeps the existing prompt library alongside saved workflow Agents', async () => {
  const { AgentStudio } = await tsImport('../../src/components/AgentStudio.tsx', { parentURL: import.meta.url, tsconfig: new URL('../../tsconfig.app.json', import.meta.url).pathname })
  const html = renderToStaticMarkup(<AgentStudio renderPromptLibrary={() => <section>原有提示词库仍在</section>} />)
  for (const text of ['Agent 库', '搭建 Agent', '我的 Agent', '提示词模板', '原有提示词库仍在', '简易搭建', '高级画布']) assert.ok(html.includes(text), text)
})


test('Markdown validation and portable round trip preserve leading and trailing prompt text', async () => {
  const { validateAgentBlueprint, exportAgentBlueprint, importAgentBlueprint } = await tsImport('../src/services/agentBlueprintService.ts', { parentURL: import.meta.url })
  const markdown = '\n\n# 原文\n\n保留换行与代码。\n\n'
  const draft = createMarkdownAgent(markdown, '11111111-1111-4111-8111-111111111111')
  assert.equal(validateAgentBlueprint(draft).modules[0].prompt, markdown)
  assert.equal(importAgentBlueprint(JSON.parse(exportAgentBlueprint(draft, 'json').content)).modules[0].prompt, markdown)
})
