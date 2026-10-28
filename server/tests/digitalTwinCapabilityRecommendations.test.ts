import assert from 'node:assert/strict'
import test from 'node:test'
import { mayApplyTwinRecommendation, recommendTwinCapabilities, twinInitialDraftMessage, twinLibrarySelectionIdentity } from '../src/contracts/digitalTwinCapabilityRecommendations.js'
import { LibrarySelectionSchema, libraryKey, type LibraryItem, type LibrarySelection } from '../src/contracts/dueDiligenceLibrary.js'

const item = (id: string, name: string, kind: 'skill' | 'agent' = 'skill', description = ''): LibraryItem => ({
  source: kind === 'agent' ? 'prompt-agent' : 'prompt-skill', id, name, kind, description, version: 1, hash: 'a'.repeat(64), execution: 'instructions',
})
const catalog = [item('financial', '财务三表勾稽检查'), item('cash', '营运资本与现金流异常'), item('customer', '客户访谈'), item('market', '行业研究'), item('meeting', '会议纪要与待办'), item('report', '报告写作'), item('finance-agent', '财务与融资公告交叉核验 Agent', 'agent'), item('research-agent', '行业赛道研究 Agent', 'agent'), item('execution-agent', '跨项目任务跟进 Agent', 'agent')]

test('finance, research and office starting points recommend relevant authorized metadata', () => {
  const finance = recommendTwinCapabilities(['finance', 'earnings', 'customers'], catalog)
  assert.deepEqual(new Set(finance.selection.skills.map(ref => ref.id)), new Set(['financial', 'cash', 'customer']))
  assert.equal(finance.selection.agent?.id, 'finance-agent')
  assert.ok(finance.reasons.every(reason => reason.focuses.length > 0))
  const research = recommendTwinCapabilities(['market'], catalog)
  assert.deepEqual(research.selection.skills.map(ref => ref.id), ['market'])
  assert.equal(research.selection.agent?.id, 'research-agent')
  const office = recommendTwinCapabilities(['meeting', 'execution'], catalog)
  assert.deepEqual(office.selection.skills.map(ref => ref.id), ['meeting', 'customer'])
  assert.equal(office.selection.agent?.id, 'execution-agent')
})
test('empty, unknown or unmatched focuses do not force unrelated agents or capabilities', () => {
  for (const ids of [[], ['unknown'], ['confidentiality']]) {
    assert.deepEqual(recommendTwinCapabilities(ids, catalog).selection, { skills: [], agent: null, replaceBindings: true })
  }
  assert.equal(recommendTwinCapabilities(['finance'], catalog.filter(ref => ref.kind === 'skill')).selection.agent, null)
})
test('recommendations are deterministic, bounded, deduplicated, and retain exact versions', () => {
  const many = [...Array.from({ length: 9 }, (_, i) => item(`finance-${i}`, '财务核验')), ...catalog]
  const latest = { ...many[0], version: 2, hash: 'b'.repeat(64) }
  const list = [...many, latest, { ...item('invalid', '财务核验'), hash: 'not-a-hash' }]
  const forward = recommendTwinCapabilities(['finance', 'finance', 'market'], list)
  const reverse = recommendTwinCapabilities(['market', 'finance'], [...list].reverse())
  assert.deepEqual(forward, reverse)
  assert.equal(forward.selection.skills.length, 4)
  assert.ok(LibrarySelectionSchema.safeParse(forward.selection).success)
  assert.equal(new Set(forward.selection.skills.map(libraryKey)).size, 4)
  assert.ok(forward.selection.skills.some(ref => ref.id === 'market'), 'cover a second selected topic instead of only four financial methods')
  const duplicate = recommendTwinCapabilities(['finance'], [many[0], latest])
  assert.deepEqual(duplicate.selection.skills, [{ source: latest.source, id: latest.id, version: 2, hash: latest.hash }])
})
test('a direct name match outranks a broad descriptive mention', () => {
  const result = recommendTwinCapabilities(['finance'], [item('agent-mention', '通用办公 Agent', 'agent', '适用于财务和多种场景'), item('agent-specific', '财务核验 Agent', 'agent')])
  assert.equal(result.selection.agent?.id, 'agent-specific')
})
test('manual choices, explicit no-capability choices, and saved common choices require confirmation', () => {
  const empty: LibrarySelection = { skills: [], agent: null, replaceBindings: true }
  const chosen = recommendTwinCapabilities(['finance'], catalog).selection
  assert.equal(mayApplyTwinRecommendation(empty, false), true)
  assert.equal(mayApplyTwinRecommendation(empty, true), false)
  assert.equal(mayApplyTwinRecommendation(chosen, false), false)
  assert.equal(mayApplyTwinRecommendation(chosen, true), false)
  assert.equal(mayApplyTwinRecommendation(chosen, true, twinLibrarySelectionIdentity(chosen)), true)
  assert.equal(mayApplyTwinRecommendation({ ...chosen, skills: [] }, true, twinLibrarySelectionIdentity(chosen)), false)
})
test('initial generation retains employee supplement and does not pretend to save or establish expertise', () => {
  const message = twinInitialDraftMessage('关注现金流', '保留我对客户复购的关注。')
  assert.match(message, /可编辑的数字分身初稿/)
  assert.match(message, /保留已有手写偏好/)
  assert.match(message, /不虚构/)
  assert.match(message, /不自动保存或发布/)
  assert.match(message, /保留我对客户复购的关注。/)
  assert.throws(() => twinInitialDraftMessage('现有偏好', '长'.repeat(8000)), /原文仍保留/)
})
