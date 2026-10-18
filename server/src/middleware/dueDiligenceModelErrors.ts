import type { ErrorRequestHandler } from 'express'

// Only fixed, non-sensitive configuration messages may bypass the generic 5xx mask.
// Do not forward provider messages, URLs, credentials, or arbitrary exception text.
const configurationMessages: Readonly<Record<string, string>> = {
  DUE_DILIGENCE_MODEL_ROUTE_UNAVAILABLE: '当前账号暂无可用的尽调模型，请管理员检查模型配置及角色权限。可先使用标准清单、分身模板和手动编辑；本次输入已保留。',
  MODEL_ENCRYPTION_KEY_INVALID: '平台模型凭据配置尚未就绪，请管理员检查配置。可先使用标准清单、分身模板和手动编辑。',
  MODEL_CREDENTIAL_DECRYPT_FAILED: '平台暂时无法读取模型凭据，请管理员检查配置。可先使用标准清单、分身模板和手动编辑。',
}

export function dueDiligenceModelConfigurationError(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error) || !('status' in error) || error.status !== 503 || typeof error.code !== 'string') return null
  if (!Object.prototype.hasOwnProperty.call(configurationMessages, error.code)) return null
  return { status: 409, code: error.code, message: configurationMessages[error.code] }
}

export const dueDiligenceModelErrors: ErrorRequestHandler = (error, _req, res, next) => {
  const known = dueDiligenceModelConfigurationError(error)
  if (!known) { next(error); return }
  const requestId = String(res.locals.requestId || '')
  console.warn(JSON.stringify({ event: 'due_diligence_model_configuration_unavailable', code: known.code, requestId }))
  res.status(known.status).json({ code: known.code, message: known.message, requestId })
}
