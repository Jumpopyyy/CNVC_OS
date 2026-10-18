import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { tsImport } from 'tsx/esm/api'

const { ProjectPreddPanel } = await tsImport('../../src/components/ProjectPreddPanel.tsx', {
  parentURL: import.meta.url,
  tsconfig: new URL('../../tsconfig.app.json', import.meta.url).pathname,
})

test('PreDD form supplies fixed PDF context with optional instructions and materials', () => {
  const html = renderToStaticMarkup(<ProjectPreddPanel lead={{ id: 'lead-1', name: '测试芯片' }} onClose={() => {}} />)
  for (const text of ['测试芯片', '项目 PreDD', '评分方法论', '补充分析要求', '补充项目附件', '开始分析', '历史分析']) assert.ok(html.includes(text), text)
  assert.ok(html.includes('accept=".pdf,.docx,.pptx,.txt,.md,.markdown"'))
  assert.ok(html.includes('aria-label="测试芯片 · 项目 PreDD"'))
})

test('discovery opens PreDD independently of project conversion and supports a targeted AI conversation', async () => {
  const page = await readFile(new URL('../../src/pages/ProjectDiscoveryPage.tsx', import.meta.url), 'utf8')
  const panel = await readFile(new URL('../../src/components/ProjectPreddPanel.tsx', import.meta.url), 'utf8')
  const assistant = await readFile(new URL('../../src/pages/AIAssistantPage.tsx', import.meta.url), 'utf8')
  assert.match(page, /onPredd=\{\(\) => setPreddLead\(lead\)\}/)
  assert.match(panel, /\/project-discovery\/leads\/\$\{lead.id\}\/predd/)
  assert.match(panel, /agent\.abort/)
  assert.match(panel, /normalizeAgentMessages/)
  assert.match(panel, /历史分析/)
  assert.match(assistant, /searchParams.get\('conversation'\)/)
  assert.match(assistant, /\/conversations\/\$\{encodeURIComponent\(requestedConversationId\)\}/, 'older explicit conversations must be loaded rather than falling back to another chat')
})
