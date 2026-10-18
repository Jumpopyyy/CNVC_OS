import assert from 'node:assert/strict'
import test from 'node:test'
import { replaceTwinFocusRules, splitTwinFocusRules, twinFocusOptions, twinFocusRules, twinTemplates } from '../src/contracts/digitalTwinTemplates.js'

test('generated templates restore their exact options and can be replaced or cleared', () => {
  for (const template of twinTemplates) {
    const rules = twinFocusRules([...template.focusIds])
    const ids = twinFocusOptions.filter(item => (template.focusIds as readonly string[]).includes(item.id)).map(item => item.id)
    assert.deepEqual(splitTwinFocusRules(rules), { focusIds: ids, customRules: '' })
    assert.equal(replaceTwinFocusRules(rules, ['finance']), twinFocusRules(['finance']))
    assert.equal(replaceTwinFocusRules(rules, []), '')
  }
})

test('a custom sentence containing a template rule is never selected or removed', () => {
  const rule = twinFocusOptions[0].rule
  for (const custom of [`不要采用：${rule}`, `仅在有一线访谈证据时：${rule}`, `${rule}但不能仅凭管理层口述。`]) {
    assert.deepEqual(splitTwinFocusRules(custom), { focusIds: [], customRules: custom })
    assert.equal(replaceTwinFocusRules(custom, ['sales']), `${twinFocusRules(['sales'])}\n\n${custom}`)
  }
})

test('quoted or negated multiline rules remain opaque after the first custom line', () => {
  for (const custom of [`不要采用以下规则：\n${twinFocusRules(['culture'])}`, `历史案例，不代表当前偏好：\r\n${twinFocusRules(['finance', 'legal']).replaceAll('\n', '\r\n')}`]) {
    assert.equal(splitTwinFocusRules(custom).focusIds.length, 0)
    const next = replaceTwinFocusRules(custom, ['channel'])
    assert.equal(splitTwinFocusRules(next).customRules, custom)
    assert.equal(replaceTwinFocusRules(next, []), custom)
  }
})

test('editing options preserves custom conditions and later quoted rules without reordering', () => {
  const custom = `仅限成熟企业；初创企业另行核查。\n反例：不要直接套用以下判断。\n${twinFocusRules(['product'])}`
  const before = `${twinFocusRules(['culture', 'finance'])}\n\n${custom}`
  assert.deepEqual(splitTwinFocusRules(before).focusIds, ['culture', 'finance'])
  const after = replaceTwinFocusRules(before, ['sales', 'channel'])
  assert.equal(after, `${twinFocusRules(['sales', 'channel'])}\n\n${custom}`)
  assert.equal(splitTwinFocusRules(after).customRules, custom)
  assert.equal(replaceTwinFocusRules(after, []), custom)
})

test('repeated selections do not duplicate generated rules or handwritten content', () => {
  const custom = `不要以估值高低直接决定投资。\n${twinFocusOptions[0].rule}`
  let rules = custom
  for (const ids of [['finance'], ['culture', 'channel'], ['finance', 'finance'], ['finance']]) rules = replaceTwinFocusRules(rules, ids)
  assert.equal(rules, `${twinFocusRules(['finance'])}\n\n${custom}`)
  assert.deepEqual(splitTwinFocusRules(rules).focusIds, ['finance'])
})

test('non-generated bullets and plain-text template sentences remain employee text', () => {
  for (const custom of [twinFocusOptions[0].rule, `- ${twinFocusOptions[0].rule}`, `• 我的自定义条件。\n${twinFocusRules(['finance'])}`]) {
    assert.equal(splitTwinFocusRules(custom).customRules, custom)
    assert.deepEqual(splitTwinFocusRules(custom).focusIds, [])
  }
  assert.deepEqual(splitTwinFocusRules(`\n ${twinFocusRules(['culture'])}\r\n\r\n`), { focusIds: ['culture'], customRules: '' })
})
