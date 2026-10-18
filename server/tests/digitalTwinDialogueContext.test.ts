import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { twinDialogueContextKey } from '../src/services/digitalTwinDialogueContext.js'
import type { TwinRuntimeSnapshot } from '../src/services/dueDiligenceTwinRuntimeService.js'

const privateSnapshot: TwinRuntimeSnapshot = { twinId: 'twin', twinName: '合成分身', twinVersion: 2, visibility: 'private', skills: [{ id: 'skill', name: '核查', version: 1 }], excludedSkillIds: [] }
const publicSnapshot: TwinRuntimeSnapshot = { ...privateSnapshot, visibility: 'public', publicationId: 'published', skills: [] }
test('private conversation keys remain compatible including project knowledge', () => {
  for (const fingerprint of [undefined, 'source-v2']) {
    const previous = createHash('sha256').update(JSON.stringify({ ...privateSnapshot, excludedSkillIds: undefined, ...(fingerprint ? { knowledge: fingerprint } : {}) })).digest('hex')
    assert.equal(twinDialogueContextKey(privateSnapshot, undefined, fingerprint), previous)
  }
})
test('same-version public rules and boundaries each isolate earlier answers', () => {
  const first = twinDialogueContextKey(publicSnapshot, '规则：关注文化。边界：仅参考。')
  assert.equal(first, twinDialogueContextKey(publicSnapshot, '规则：关注文化。边界：仅参考。'))
  assert.notEqual(first, twinDialogueContextKey(publicSnapshot, '规则：关注财务。边界：仅参考。'))
  assert.notEqual(first, twinDialogueContextKey(publicSnapshot, '规则：关注文化。边界：只适用于成熟企业。'))
  assert.notEqual(first, twinDialogueContextKey(publicSnapshot, '规则：关注文化。边界：仅参考。', 'new-source'))
  assert.match(first, /^[a-f0-9]{64}$/)
})
test('old public messages without content identity are not reused as verified current history', () => {
  const legacy = createHash('sha256').update(JSON.stringify({ ...publicSnapshot, excludedSkillIds: undefined })).digest('hex')
  assert.notEqual(twinDialogueContextKey(publicSnapshot, '公开规则'), legacy)
  assert.throws(() => twinDialogueContextKey(publicSnapshot), /公开分身上下文缺失/)
})
test('skill and private versions still isolate changed private runtime context', () => {
  const initial = twinDialogueContextKey(privateSnapshot)
  assert.notEqual(initial, twinDialogueContextKey({ ...privateSnapshot, skills: [] }))
  assert.notEqual(initial, twinDialogueContextKey({ ...privateSnapshot, twinVersion: 3 }))
  assert.equal(initial, twinDialogueContextKey({ ...privateSnapshot, excludedSkillIds: ['unused'] }))
})
