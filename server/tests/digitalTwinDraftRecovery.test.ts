import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyTwinBuilderDraft, nextTwinDraftRecord, recoverTwinDraft, TWIN_DRAFT_TTL, type TwinRecoveryContent } from '../../src/components/dueDiligence/twinDraftRecovery.js'

const owner = 'employee-a'
const id = '00000000-0000-4000-8000-000000000001'
const assetId = '00000000-0000-4000-8000-000000000002'
const content: TwinRecoveryContent = {
  draftId: id,
  draft: { id, expectedVersion: 3, name: '合成分身', role: '投资经理', rules: '待保存的偏好', cases: '私有案例', assetAdoptions: [{ assetId, traits: '员工修订', expectedSuggestion: '原始建议' }] },
  builder: { message: '未发送的需求', proposal: { reply: '候选', description: '关注回款', rules: '可编辑建议', cases: '适用边界', followUps: [{ question: '如何核验？', options: ['合同', '银行流水'] }] }, proposalAsset: { assetId, name: '合成材料.txt', status: 'ready', traits: '原始建议' } },
}

test('draft recovery keeps unconfirmed text, suggestions and material CAS references without promoting them', () => {
  const saved = nextTwinDraftRecord(undefined, owner, 0, content)
  assert.deepEqual(recoverTwinDraft(saved, owner).content, content)
  assert.equal(saved.revision, 1)
  assert.equal(saved.content?.draft.expectedVersion, 3)
  assert.equal(saved.content?.builder.proposalAsset?.status, 'ready')
  assert.deepEqual(emptyTwinBuilderDraft(), { message: '', proposal: null, proposalAsset: null })
})
test('another user, expired content and malformed content cannot be restored', () => {
  const saved = nextTwinDraftRecord(undefined, owner, 0, content)
  assert.equal(recoverTwinDraft(saved, 'employee-b').content, null)
  assert.equal(recoverTwinDraft(saved, owner, saved.updatedAt + TWIN_DRAFT_TTL + 1).content, null)
  assert.equal(recoverTwinDraft({ ...saved, content: { draft: 'invalid' } }, owner).content, null)
  assert.equal(recoverTwinDraft({ ...saved, updatedAt: Date.now() + 120_000 }, owner).content, null)
})
test('a stale browser tab cannot overwrite a newer snapshot or resurrect discarded edits', () => {
  const saved = nextTwinDraftRecord(undefined, owner, 0, content)
  const discarded = nextTwinDraftRecord(saved, owner, 1, null)
  assert.equal(discarded.content, null)
  assert.throws(() => nextTwinDraftRecord(discarded, owner, 1, content), /另一页面/)
  assert.throws(() => nextTwinDraftRecord(saved, 'employee-b', 1, content), /账号不匹配/)
})
test('new unsaved twins retain their creation idempotency key; oversized drafts are rejected', () => {
  const fresh = { ...content, draft: { ...content.draft, id: '', expectedVersion: undefined } }
  const saved = nextTwinDraftRecord(undefined, owner, 0, fresh)
  assert.equal(recoverTwinDraft(saved, owner).content?.draftId, id)
  assert.equal(saved.content?.draft.id, '')
  assert.throws(() => nextTwinDraftRecord(undefined, owner, 0, { ...content, draft: { ...content.draft, rules: 'x'.repeat(4_000_001) } }), /草稿过大/)
})
