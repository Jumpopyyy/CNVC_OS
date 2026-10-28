import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { tsImport } from 'tsx/esm/api'

const { TwinPreferenceEditor } = await tsImport('../../src/components/dueDiligence/TwinPreferenceEditor.tsx', { parentURL: import.meta.url, tsconfig: new URL('../../tsconfig.app.json', import.meta.url).pathname })
const draft = { id: 'synthetic', name: '合成分身', role: '投资经理', rules: '先核验合同与回款，再形成判断。', cases: '' }
const proposal = { reply: '合成建议', description: '', rules: '建议补充核验客户集中度。', cases: '', followUps: [] }
const noop = () => {}
const render = (overrides = {}) => renderToStaticMarkup(<TwinPreferenceEditor draft={draft} proposal={null} outdated={false} busy={false} active onDraft={noop} onProposal={noop} onAdopt={noop} onDiscard={noop} {...overrides} />)

test('saved preferences are presented as a keyboard-accessible result with one explicit editing entrance', () => {
  const html = render()
  assert.match(html, /<h3>[\s\S]*分身偏好<\/h3>/)
  assert.match(html, /aria-expanded="false" aria-controls="[^"]+"/)
  assert.match(html, /手动编辑/)
  assert.match(html, /role="region" aria-label="当前偏好内容" tabindex="0"/)
  assert.ok(html.includes(draft.rules))
  assert.doesNotMatch(html, /<textarea|语音补充|暂停语音|麦克风/)
})
test('an unadopted suggestion starts as a result, preserving explicit compare, adopt and discard actions', () => {
  const html = render({ proposal })
  assert.match(html, /偏好内容切换/)
  assert.match(html, /aria-label="待采纳建议内容"/)
  assert.ok(html.includes(proposal.rules))
  assert.match(html, /采纳到当前偏好/)
  assert.match(html, /放弃建议/)
  assert.doesNotMatch(html, /<textarea|语音补充|直接修改下方建议/)
})
test('empty preferences direct the employee to dialogue or the optional manual editor', () => {
  const html = render({ draft: { ...draft, rules: '' } })
  assert.match(html, /暂无偏好，可通过对话补充需求/)
  assert.doesNotMatch(html, /<textarea/)
})
test('busy and inactive workspaces cannot start manual edits, and outdated suggestions remain flagged', () => {
  for (const overrides of [{ busy: true }, { active: false }]) {
    assert.match(render(overrides), /<button[^>]*disabled=""[^>]*aria-expanded="false"/)
  }
  const html = render({ proposal, outdated: true })
  assert.match(html, /建议需核对/)
  assert.match(html, /采纳前请核对当前偏好/)
})
