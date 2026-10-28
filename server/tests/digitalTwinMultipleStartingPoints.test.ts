import assert from 'node:assert/strict'
import test from 'node:test'
import { replaceTwinFocusRules, splitTwinFocusRules, twinTemplates } from '../src/contracts/digitalTwinTemplates.js'
import { selectedFocuses, selectionFromFocuses, toggleStartingFocus, toggleStartingPoint } from '../../src/components/dueDiligence/twinStartingPointSelection.js'

test('multiple starting points combine focuses, deduplicate overlaps and retain remaining focuses when removed', () => {
  let selected = selectionFromFocuses([])
  selected = toggleStartingPoint(selected, 'investment')
  selected = toggleStartingPoint(selected, 'financial')
  assert.deepEqual(selected.templateIds, ['investment', 'financial'])
  const combined = selectedFocuses(selected)
  assert.equal(new Set(combined).size, combined.length)
  assert.ok(combined.includes('finance') && combined.includes('earnings') && combined.includes('legal'))
  selected = toggleStartingPoint(selected, 'investment')
  assert.ok(selectedFocuses(selected).includes('finance'))
  assert.ok(selectedFocuses(selected).includes('earnings'))
  assert.ok(!selectedFocuses(selected).includes('legal'))
})

test('saved rule blocks restore a unique combined cover, keeping handwritten text intact', () => {
  const chosen = twinTemplates.filter(item => item.id === 'investment' || item.id === 'financial')
  const focuses = [...new Set(chosen.flatMap(item => [...item.focusIds]))]
  const saved = replaceTwinFocusRules('手写偏好：结论必须有证据。', focuses)
  const parsed = splitTwinFocusRules(saved)
  assert.equal(parsed.customRules, '手写偏好：结论必须有证据。')
  assert.deepEqual(new Set(selectionFromFocuses(parsed.focusIds).templateIds), new Set(['investment', 'financial']))
})

test('manual focuses are retained when toggling starting points; removing a shared focus clears dependent selections', () => {
  let selected = selectionFromFocuses(['finance'])
  selected = toggleStartingPoint(selected, 'investment')
  selected = toggleStartingPoint(selected, 'financial')
  selected = toggleStartingPoint(selected, 'investment')
  assert.ok(selectedFocuses(selected).includes('finance'))
  selected = toggleStartingFocus(selected, 'finance')
  assert.ok(!selectedFocuses(selected).includes('finance'))
  assert.ok(!selected.templateIds.includes('financial'))
  assert.ok(selectedFocuses(selected).includes('earnings'))
})
