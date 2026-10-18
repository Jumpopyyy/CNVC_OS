import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { tsImport } from 'tsx/esm/api'

const { LibraryPicker } = await tsImport('../../src/components/dueDiligence/LibraryPicker.tsx', { parentURL: import.meta.url, tsconfig: new URL('../../tsconfig.app.json', import.meta.url).pathname })
const { TwinLibraryBindings } = await tsImport('../../src/components/dueDiligence/TwinLibraryBindings.tsx', { parentURL: import.meta.url, tsconfig: new URL('../../tsconfig.app.json', import.meta.url).pathname })
test('library selector keeps explicit labels, defaults to no external agent, and disables pending requests', () => {
  const html = renderToStaticMarkup(<LibraryPicker task="checklist" value={{ skills: [], agent: null }} onChange={() => {}} />)
  for (const label of ['选择平台方法与智能体', '执行智能体（可不选）', '使用平台默认流程', '使用 Skill（最多 4 项，可不选）', '搜索可用 Skill']) assert.ok(html.includes(label), label)
  assert.match(html, /<fieldset[^>]*disabled=""/)
  assert.ok(html.includes('role="status"'))
})
test('binding management stays a single optional action rather than a new daily workspace', () => {
  const html = renderToStaticMarkup(<TwinLibraryBindings twinId="synthetic" onSaved={() => {}} onLearned={async () => {}} />)
  assert.ok(html.includes('管理辅助 Skill 与智能体'))
  assert.ok(!html.includes('<select'), 'ability editing opens only when requested')
})
