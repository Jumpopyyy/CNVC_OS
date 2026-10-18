import assert from 'node:assert/strict'
import test from 'node:test'
import { buildQuestionReview, combineGeneratedQuestions, normalizeQuestionTitle, stableQuestionKey, validateGeneratedEvidence, type GeneratedQuestionDraft } from '../src/services/dueDiligenceQuestionMergeService.js'

const draft = (overrides: Partial<GeneratedQuestionDraft> = {}): GeneratedQuestionDraft => ({ title: '核实客户集中度与回款质量', category: '业务', priority: '中', evidenceRequirement: '客户明细', rationale: '通用', sourceNames: [], publicationIds: [], ...overrides })
test('stable keys ignore punctuation/case but retain template identity after edits', () => {
  assert.equal(normalizeQuestionTitle('核实：AI 客户？'), normalizeQuestionTitle('核实ai客户'))
  assert.equal(stableQuestionKey(draft({ templateItemId: 'customer-01' })), stableQuestionKey(draft({ title: '员工改写标题', templateItemId: 'customer-01' })))
})
test('AI enrichment survives same-title baseline and keeps both identities and evidence', () => {
  const [row] = combineGeneratedQuestions([draft({ sourceKind: '标准模板', templateItemId: 'customer-01' }), draft({ sourceKind: '专家分身', priority: '高', rationale: '客户A占比超过一半', attentionSource: '领导 v3', publicationIds: ['pub'], evidence: [{ fileId: 'f', fileVersion: 2, excerpt: '客户A占比百分之六十' }] })])
  assert.equal(row.rationale, '客户A占比超过一半'); assert.equal(row.attentionSource, '领导 v3'); assert.equal(row.priority, '高')
  assert.deepEqual(row.publicationIds, ['pub']); assert.equal(row.evidence?.length, 1); assert.ok(row.generationKeys?.includes('template:customer-01'))
})
test('existing edits and deleted template decisions are not recreated', () => {
  const generated = [draft({ templateItemId: 'customer-01' })]
  assert.equal(buildQuestionReview(generated, [{ id: 'old', title: '员工已经改写', generationKey: 'template:customer-01', version: 3 }])[0].action, 'existing')
  assert.equal(buildQuestionReview(generated, [{ id: 'old', title: '员工已经改写', generationKey: 'template:customer-01', version: 3, deletedAt: new Date() }])[0].action, 'suppressed')
})
test('similar topics only suggest a merge; unrelated topics are new', () => {
  assert.equal(buildQuestionReview([draft({ title: '核实主要客户集中度与回款质量' })], [{ id: 'old', title: draft().title, version: 1 }])[0].action, 'similar')
  assert.equal(buildQuestionReview([draft({ title: '确认核心专利权属及授权边界' })], [{ id: 'old', title: draft().title, version: 1 }])[0].action, 'new')
})
test('merged historical source keys make repeated apply idempotent', () => {
  const q = draft()
  assert.equal(buildQuestionReview([q], [{ id: 'old', title: '人工新标题', version: 7, generationKeys: [stableQuestionKey(q)] }])[0].action, 'existing')
})
test('only authorized current-version literal evidence survives', () => {
  const files = [{ id: 'allowed', version: 2, contentText: '客户A收入占比百分之六十，回款期限为九十天。', sha256: 'hash' }]
  const evidence = validateGeneratedEvidence([
    { fileId: 'allowed', fileVersion: 2, excerpt: '客户A收入占比百分之六十' },
    { fileId: 'allowed', fileVersion: 1, excerpt: '客户A收入占比百分之六十' },
    { fileId: 'secret', fileVersion: 2, excerpt: '客户A收入占比百分之六十' },
    { fileId: 'allowed', fileVersion: 2, excerpt: '模型编造的材料原文不存在' },
  ], files)
  assert.equal(evidence.length, 1); assert.equal(evidence[0].contentHash, 'hash')
})
