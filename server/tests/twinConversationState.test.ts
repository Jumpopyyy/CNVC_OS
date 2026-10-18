import assert from 'node:assert/strict'
import test from 'node:test'
import { createTwinConversationGate, inputAfterTwinReply } from '../../src/components/dueDiligence/twinConversationState.js'

test('a reply consumes only the submitted text, not typing for the next turn or an unsent option draft', () => {
  assert.equal(inputAfterTwinReply('核验激励兑现', '核验激励兑现'), '')
  assert.equal(inputAfterTwinReply('下一条：核验渠道', '核验激励兑现'), '下一条：核验渠道')
  assert.equal(inputAfterTwinReply('核验激励兑现\n补充回款依据', '核验激励兑现'), '核验激励兑现\n补充回款依据')
  assert.equal(inputAfterTwinReply('尚未发送的个人补充', null), '尚未发送的个人补充')
})

test('double send is locked synchronously and late history cannot overwrite the reply', () => {
  const gate = createTwinConversationGate()
  const history = gate.beginLoad()
  const send = gate.beginWrite()!
  assert.equal(gate.beginWrite(), null)
  assert.equal(gate.isWriting(), true)
  assert.equal(gate.isCurrent(history), false)
  assert.equal(gate.isCurrent(send), true)
  assert.equal(gate.finishWrite(send), true)
  assert.equal(gate.isWriting(), false)
  assert.notEqual(gate.beginWrite(), null)
})

test('a late response from a closed or previous project cannot unlock or overwrite the new request', () => {
  const gate = createTwinConversationGate()
  const previous = gate.beginWrite()!
  gate.invalidate()
  const load = gate.beginLoad()
  const current = gate.beginWrite()!
  assert.equal(gate.isCurrent(previous), false)
  assert.equal(gate.isCurrent(load), false)
  assert.equal(gate.finishWrite(previous), false)
  assert.equal(gate.isWriting(), true)
  assert.equal(gate.isCurrent(current), true)
  gate.invalidate()
  assert.equal(gate.isCurrent(current), false)
  assert.equal(gate.finishWrite(current), false)
})
