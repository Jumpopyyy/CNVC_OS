import assert from 'node:assert/strict'
import test from 'node:test'
import { dueDiligenceModelConfigurationError } from '../src/middleware/dueDiligenceModelErrors.js'
import { apiErrorFromResponse } from '../src/contracts/apiErrorContract.js'

test('missing model has an actionable fixed message through the real API error contract', () => {
  const result = dueDiligenceModelConfigurationError({ code: 'DUE_DILIGENCE_MODEL_ROUTE_UNAVAILABLE', status: 503, message: 'secret-provider-detail' })!
  assert.equal(result.status, 409)
  const ui = apiErrorFromResponse(result.status, result, null)
  assert.match(ui.message, /模型配置及角色权限/)
  assert.match(ui.message, /标准清单/)
  assert.doesNotMatch(JSON.stringify(result), /secret-provider-detail/)
})
test('credential failures expose no key, provider response or stack', () => {
  for (const code of ['MODEL_ENCRYPTION_KEY_INVALID', 'MODEL_CREDENTIAL_DECRYPT_FAILED']) {
    const result = dueDiligenceModelConfigurationError({ status: 503, code, message: 'SECRET', stack: 'SECRET' })!
    assert.equal(result.status, 409)
    assert.match(result.message, /管理员/)
    assert.doesNotMatch(JSON.stringify(result), /SECRET/)
  }
})
test('unknown errors and authentication failures retain the existing safe handler', () => {
  for (const error of [null, 'text', { status: 500, code: 'INTERNAL_ERROR' }, { status: 503, code: 'constructor' }, { status: 403, code: 'DUE_DILIGENCE_MODEL_ROUTE_UNAVAILABLE' }, { status: 503, code: 'TWIN_BUILDER_UNAVAILABLE' }]) assert.equal(dueDiligenceModelConfigurationError(error), null)
  assert.equal(apiErrorFromResponse(503, { code: 'INTERNAL_ERROR', message: 'SECRET' }, null).message, '服务暂时不可用，请稍后重试')
})
