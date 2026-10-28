import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { tsImport } from 'tsx/esm/api'

const { LibraryPicker } = await tsImport('../../src/components/dueDiligence/LibraryPicker.tsx', { parentURL: import.meta.url, tsconfig: new URL('../../tsconfig.app.json', import.meta.url).pathname })
const { TwinAuxiliaryCapabilities } = await tsImport('../../src/components/dueDiligence/TwinAuxiliaryCapabilities.tsx', { parentURL: import.meta.url, tsconfig: new URL('../../tsconfig.app.json', import.meta.url).pathname })
test('library selector keeps explicit labels, defaults to no external agent, and disables pending requests', () => {
  const html = renderToStaticMarkup(<LibraryPicker task="checklist" value={{ skills: [], agent: null }} onChange={() => {}} />)
  for (const label of ['选择平台方法与智能体', '执行智能体（可不选）', '使用平台默认流程', '使用 Skill（最多 4 项，可不选）', '搜索可用 Skill']) assert.ok(html.includes(label), label)
  assert.match(html, /<fieldset[^>]*disabled=""/)
  assert.ok(html.includes('role="status"'))
})
test('one compact capability bar replaces the two independent selection entrances', () => {
  const html = renderToStaticMarkup(<TwinAuxiliaryCapabilities twinId="synthetic" onChange={() => {}} />)
  assert.ok(html.includes('辅助能力'))
  assert.ok(html.includes('使用分身常用'))
  assert.equal((html.match(/>调整<\/button>/g) || []).length, 1)
  assert.ok(!html.includes('<select'), 'ability editing opens only when requested')
  assert.doesNotMatch(html, /分身常用 Skill 与智能体|本次对话参考/)
})
test('new-twin preview has a visible default flow without pretending any capability was invoked', () => {
  const html = renderToStaticMarkup(<TwinAuxiliaryCapabilities preview onChange={() => {}} />)
  assert.match(html, /使用平台默认流程/)
  assert.doesNotMatch(html, /不可用能力|执行成功|role="dialog"/)
})
