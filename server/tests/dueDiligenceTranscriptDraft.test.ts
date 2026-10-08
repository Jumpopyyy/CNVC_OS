import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldReplaceTranscriptDraft } from '../../src/components/dueDiligence/interviewTranscriptDraft.js'

test('a newer persisted transcript refreshes an unchanged editor', () => {
  assert.equal(shouldReplaceTranscriptDraft('已保存转写', '已保存转写', 1, 2), true)
  assert.equal(shouldReplaceTranscriptDraft('', '', null, 1), true)
})

test('saving an earlier snapshot never replaces speech appended during the request', () => {
  const sentSnapshot = '第一句'
  const editorAfterMoreSpeech = '第一句\n保存期间新说的第二句'
  assert.equal(shouldReplaceTranscriptDraft(editorAfterMoreSpeech, sentSnapshot, 1, 2), false)
})

test('incoming persisted data preserves local manual edits and unsaved removals', () => {
  assert.equal(shouldReplaceTranscriptDraft('人工修订内容', '原转写', 1, 2), false)
  assert.equal(shouldReplaceTranscriptDraft('', '原转写', 1, 2), false)
})

test('unchanged versions do not rewrite an editor even if its contents are clean', () => {
  assert.equal(shouldReplaceTranscriptDraft('已保存转写', '已保存转写', 2, 2), false)
  assert.equal(shouldReplaceTranscriptDraft('', '', null, null), false)
})

test('a late older response never rolls back the saved transcript version', () => {
  assert.equal(shouldReplaceTranscriptDraft('已保存最新转写', '已保存最新转写', 3, 2), false)
  assert.equal(shouldReplaceTranscriptDraft('已保存最新转写', '已保存最新转写', 3, null), false)
  assert.equal(shouldReplaceTranscriptDraft('', '', undefined, 1), true)
})
