import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveTwinDescription, summarizeTwinFocus, twinFocusOptions, twinFocusRules, twinTemplates } from '../src/contracts/digitalTwinTemplates.js'

test('exact selected template rules produce concise, deduplicated focus labels', () => {
  for (const template of twinTemplates) {
    const rules = twinFocusRules([...template.focusIds])
    const labels = twinFocusOptions.filter(item => (template.focusIds as readonly string[]).includes(item.id)).map(item => item.label)
    assert.equal(summarizeTwinFocus(`${rules}\n${rules}`), `关注${labels.join('、')}。`)
  }
})
test('free-form summaries remove repeated sentences without inventing focus labels', () => {
  const rule = '先区分已核验事实、管理层口径与待补证假设；同时列出关键证据与反证。'
  assert.equal(summarizeTwinFocus(`• ${rule}\n- ${rule} ${rule}`), `偏好摘录：${rule}`)
  assert.equal(summarizeTwinFocus('不关注财务，只关注文化。'), '偏好摘录：不关注财务，只关注文化。')
  assert.equal(summarizeTwinFocus(`不要采用以下规则：${twinFocusOptions[0].rule}`), `偏好摘录：不要采用以下规则：${twinFocusOptions[0].rule}`)
  assert.equal(summarizeTwinFocus(`不要采用以下规则：\n${twinFocusRules(['culture'])}`), `偏好摘录：不要采用以下规则： ${twinFocusOptions[0].rule}`)
})
test('custom boundaries remain visible alongside template focus labels', () => {
  const rules = `${twinFocusRules(['finance'])}\n不以估值高低直接决定投资。`
  assert.equal(summarizeTwinFocus(rules), `偏好摘录：${twinFocusOptions.find(item => item.id === 'finance')!.rule} 不以估值高低直接决定投资。`)
})
test('empty and long rules have bounded, explicitly truncated summaries', () => {
  assert.equal(summarizeTwinFocus(' \n• \n- '), '')
  const summary = summarizeTwinFocus('核验'.repeat(200) + '🔎')
  assert.equal(Array.from(summary).length, 180)
  assert.ok(summary.endsWith('…'))
})
test('auto summaries refresh from rules without mutating stored descriptions', () => {
  const twin = { rules: twinFocusRules(['channel']), description: '旧的重复说明', descriptionMode: 'auto' }
  assert.equal(resolveTwinDescription(twin), '关注渠道建设。')
  assert.equal(twin.description, '旧的重复说明')
  assert.equal(resolveTwinDescription({ ...twin, rules: '' }), '')
})
test('manual and explicitly blank descriptions survive rule or template changes', () => {
  const twin = { rules: twinFocusRules(['finance']), description: '员工确认的说明', descriptionMode: 'manual' }
  assert.equal(resolveTwinDescription(twin), '员工确认的说明')
  assert.equal(resolveTwinDescription({ ...twin, rules: twinFocusRules(['culture']) }), '员工确认的说明')
  assert.equal(resolveTwinDescription({ ...twin, description: '' }), '')
})
