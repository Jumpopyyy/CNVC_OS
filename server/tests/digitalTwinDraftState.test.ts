import assert from 'node:assert/strict'
import test from 'node:test'
import { stageTwinAsset } from '../../src/components/dueDiligence/twinDraftState.js'
import { twinFocusOptions, twinFocusRules } from '../src/contracts/digitalTwinTemplates.js'

const draft = { id: 'twin', name: '合成分身', role: '投资经理', rules: '已有偏好', cases: '私有案例' }
const adoption = { assetId: 'asset-a', traits: '检查真实回款', expectedSuggestion: '核验回款' }
test('asset adoption only stages immutable draft and deduplicates repeated clicks', () => {
  const staged = stageTwinAsset(draft, adoption)
  assert.equal(draft.rules, '已有偏好')
  assert.equal(staged.rules, '已有偏好\n\n检查真实回款')
  assert.deepEqual(staged.assetAdoptions, [adoption])
  assert.equal(stageTwinAsset(staged, adoption), staged)
})
test('builder replacement retains edited suggestions and previous source references', () => {
  const first = stageTwinAsset(draft, adoption)
  const nextAdoption = { assetId: 'asset-b', traits: '编辑后的建议', expectedSuggestion: '原始建议' }
  const result = stageTwinAsset(first, nextAdoption, { ...first, rules: '员工确认后的完整偏好', description: '手动备注', descriptionMode: 'manual' })
  assert.equal(result.rules, '员工确认后的完整偏好')
  assert.equal(result.cases, '私有案例')
  assert.equal(result.description, '手动备注')
  assert.deepEqual(result.assetAdoptions, [adoption, nextAdoption])
})
test('focus selection derives from current rules after material or manual changes', () => {
  const selected = (rules: string) => twinFocusOptions.filter(option => rules.includes(option.rule)).map(option => option.id)
  assert.deepEqual(selected(twinFocusRules(['culture'])), ['culture'])
  assert.deepEqual(selected(twinFocusRules(['sales', 'channel'])), ['sales', 'channel'])
  assert.deepEqual(selected('员工改写的自由文本'), [])
})
