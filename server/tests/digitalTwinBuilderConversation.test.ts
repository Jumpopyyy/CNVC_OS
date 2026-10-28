import assert from 'node:assert/strict'
import test from 'node:test'
import { historyBeforeTwinBuilderEdit, visibleTwinBuilderMessages, type TwinBuilderMessage } from '../src/contracts/digitalTwinBuilderConversation.js'

const turn = (id: string, role: string, content: string, replaces?: string): TwinBuilderMessage => ({ id, role, content, ...(replaces ? { metadata: { twinBuildReplacesMessageId: replaces } } : {}) })
const history = [turn('u1', 'user', '关注收入'), turn('a1', 'assistant', '核查收入建议'), turn('u2', 'user', '再关注渠道'), turn('a2', 'assistant', '渠道建议')]

test('editing a sent message excludes the old message and its subsequent turns from model context', () => {
  assert.deepEqual(historyBeforeTwinBuilderEdit(history, { messageId: 'u2', expectedContent: '再关注渠道', expectedLastMessageId: 'a2' }), history.slice(0, 2))
  assert.deepEqual(historyBeforeTwinBuilderEdit(history, { messageId: 'u1', expectedContent: '关注收入', expectedLastMessageId: 'a2' }), [])
})

test('saved revisions replace the visible branch after refresh without deleting audit history', () => {
  const raw = [...history, turn('u3', 'user', '改为关注回款', 'u1'), turn('a3', 'assistant', '回款建议')]
  const snapshot = JSON.stringify(raw)
  const visible = visibleTwinBuilderMessages(raw)
  assert.deepEqual(visible.map(item => item.content), ['改为关注回款', '回款建议'])
  assert.equal(JSON.stringify(raw), snapshot)
  assert.equal(raw[0].content, '关注收入')
  assert.equal(raw.length, 6)
  assert.deepEqual(visibleTwinBuilderMessages(JSON.parse(JSON.stringify(raw))), visible)
})

test('a revised message can be edited again and new turns continue from the revised branch', () => {
  const raw = [...history, turn('u3', 'user', '关注终端动销', 'u2'), turn('a3', 'assistant', '动销建议'), turn('u4', 'user', '核验退货', 'u3'), turn('a4', 'assistant', '退货建议'), turn('u5', 'user', '关注返利'), turn('a5', 'assistant', '返利建议')]
  assert.deepEqual(visibleTwinBuilderMessages(raw).map(item => item.id), ['u1', 'a1', 'u4', 'a4', 'u5', 'a5'])
})

test('stale content or a newer conversation turn prevents editing, preserving the current history', () => {
  const edit = { messageId: 'u2', expectedContent: '再关注渠道', expectedLastMessageId: 'a2' }
  assert.throws(() => historyBeforeTwinBuilderEdit(history, { ...edit, expectedContent: '过期文本' }), { status: 409 })
  assert.throws(() => historyBeforeTwinBuilderEdit([...history, turn('u3', 'user', '新增内容')], edit), { status: 409 })
  assert.throws(() => historyBeforeTwinBuilderEdit(history, { ...edit, messageId: 'another-conversation' }), { status: 400 })
  assert.throws(() => historyBeforeTwinBuilderEdit(history, { ...edit, messageId: 'a2', expectedContent: '渠道建议' }), { status: 400 })
  assert.equal(history.length, 4)
})

test('an obsolete branch cannot be brought back by editing a superseded message', () => {
  const visible = visibleTwinBuilderMessages([...history, turn('u3', 'user', '改为关注回款', 'u1'), turn('a3', 'assistant', '回款建议')])
  assert.throws(() => historyBeforeTwinBuilderEdit(visible, { messageId: 'u2', expectedContent: '再关注渠道', expectedLastMessageId: 'a3' }), { status: 400 })
})
