import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { tsImport } from 'tsx/esm/api'
import { twinTemplates, twinTemplateGroups, twinFocusOptions, twinFocusRules, replaceTwinFocusRules, splitTwinFocusRules } from '../src/contracts/digitalTwinTemplates.js'
import { expertFocusQuestions, matchExpertFocus } from '../src/services/digitalTwinChecklistService.js'

const { TwinStartingPoints, TwinStartingPointPicker } = await tsImport('../../src/components/dueDiligence/TwinStartingPoints.tsx', { parentURL: import.meta.url, tsconfig: new URL('../../tsconfig.app.json', import.meta.url).pathname })

test('professional catalogue has unique, complete options across due diligence, research and office', () => {
  assert.equal(twinTemplates.length, 15)
  assert.equal(new Set(twinTemplates.map(item => item.id)).size, twinTemplates.length)
  assert.equal(new Set(twinFocusOptions.map(item => item.id)).size, twinFocusOptions.length)
  for (const group of twinTemplateGroups) assert.ok(twinTemplates.filter(item => item.group === group.id).length >= 4)
  for (const template of twinTemplates) {
    assert.ok(template.description.length > 20)
    assert.ok(template.focusIds.every(id => twinFocusOptions.some(item => item.id === id)))
    assert.equal(new Set(template.focusIds).size, template.focusIds.length)
    const custom = '只依据核验过的事实，不代替负责人决策。'
    const next = replaceTwinFocusRules(custom, [...template.focusIds])
    assert.equal(splitTwinFocusRules(next).customRules, custom)
    assert.equal(replaceTwinFocusRules(next, []), custom)
  }
})

test('office profiles never produce empty or unrelated baseline due diligence questions', () => {
  for (const template of twinTemplates.filter(item => item.group === 'office')) {
    const expert = { id: template.id, ownerName: '合成办公分身', version: 1, rules: twinFocusRules([...template.focusIds]) }
    assert.deepEqual(expertFocusQuestions([expert]), [])
    assert.match(matchExpertFocus(expert).warning, /办公协作/)
  }
  const mixed = { id: 'mixed', ownerName: '合成复合分身', version: 1, rules: twinFocusRules(['earnings', 'meeting']) }
  assert.equal(expertFocusQuestions([mixed]).length, 1)
  assert.match(expertFocusQuestions([mixed])[0].title, /现金流/)
})

test('new investment and research preferences retain evidence and reject unsupported free text', () => {
  const expert = { id: 'research', ownerName: '合成研究分身', version: 1, rules: twinFocusRules(['market', 'competition', 'valuation']) }
  assert.equal(expertFocusQuestions([expert]).length, 3)
  assert.ok(expertFocusQuestions([expert]).every(item => item.title && item.evidenceRequirement && item.evidence?.length === 0))
  assert.equal(matchExpertFocus({ ...expert, rules: '不要机械套用行业增长' }).options.length, 0)
  assert.deepEqual(matchExpertFocus({ ...expert, rules: '关注行业空间与产业链' }).options.map(item => item.id), ['market'])
})

test('starting point cards identify selection with text and pressed state, and restore the applicable group', () => {
  const render = (ids: string[], disabled = false) => renderToStaticMarkup(<TwinStartingPointPicker rules={twinFocusRules(ids)} disabled={disabled} onChange={() => {}} />)
  const office = render(['writing', 'confidentiality'])
  assert.match(office, /已应用：报告写作与汇报/)
  assert.match(office, /aria-pressed="true"[^>]*>办公协作/)
  assert.match(office, /搜索全部专业起点/)
  assert.match(office, /移除关注点：结构化写作与汇报/)
  assert.match(office, /保留手写内容/)
  assert.match(render(['finance']), /自定义关注组合/)
  assert.match(render([], true), /<button[^>]*disabled=""[^>]*aria-pressed="false"/)
})

test('workspace shows a compact starting point summary, not the full catalogue', () => {
  const html = renderToStaticMarkup(<TwinStartingPoints rules={twinFocusRules(['writing', 'confidentiality'])} onChange={() => {}} />)
  assert.match(html, /报告写作与汇报/)
  assert.match(html, /更换起点/)
  assert.doesNotMatch(html, /role="dialog"|搜索全部专业起点|起点场景分类/)
  assert.doesNotMatch(html, /bg-gradient|bg-violet|bg-teal/)
  const empty = renderToStaticMarkup(<TwinStartingPoints rules="手工规则" disabled onChange={() => {}} />)
  assert.match(empty, /尚未选择，可直接对话完善/)
  assert.match(empty, /disabled=""[^>]*>选择起点/)
})

test('a starting point fully covered by another is distinguished from an explicit selection', () => {
  const html = renderToStaticMarkup(<TwinStartingPointPicker rules={twinFocusRules(['meeting', 'execution', 'confidentiality'])} onChange={() => {}} />)
  assert.match(html, /已应用：会议纪要与复盘/)
  assert.match(html, /已涵盖[\s\S]*项目推进与协作/)
})
