import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAiResponsesBody, buildAiChatFallbackBody } from '../src/services/aiGatewayService.js'


test('optional node sampling settings reach both gateway protocols and never default other calls', () => {
  const base = { model: 'test-model', messages: [{ role: 'user' as const, content: 'test' }], maxTokens: 128 }
  for (const build of [buildAiResponsesBody, buildAiChatFallbackBody]) {
    assert.equal('temperature' in build(base), false)
    assert.equal((build({ ...base, temperature: 0 }) as Record<string, unknown>).temperature, 0)
    assert.equal((build({ ...base, temperature: 1.5 }) as Record<string, unknown>).temperature, 1.5)
    for (const temperature of [NaN, Infinity, -1, 2.1]) assert.throws(() => build({ ...base, temperature }), /temperature/)
  }
})
