import { db, pool } from '../db/client.js'
import { checkDueDiligenceSchema, DUE_DILIGENCE_SCHEMA_VERSION } from '../services/dueDiligenceSchemaReadinessService.js'
import { resolveAiModelRoute } from '../services/aiModelSettingsService.js'
import { getDueDiligenceAsrCapability } from '../services/dueDiligenceAsrService.js'

type Check = { name: string; ready: boolean; required: boolean; detail: string }
const checks: Check[] = []
const required = (name: string, ready: boolean, detail: string) => checks.push({ name, ready, required: true, detail })
const optional = (name: string, ready: boolean, detail: string) => checks.push({ name, ready, required: false, detail })

try {
  const origins = (process.env.AUTH_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
  const productionOriginReady = process.env.NODE_ENV !== 'production' || origins.includes('https://cybernaut.newmin.cn')
  required('production-origin', productionOriginReady, process.env.NODE_ENV !== 'production' ? '非生产环境，不校验生产域名' : productionOriginReady ? '生产域名已加入可信来源' : '需设置 AUTH_ALLOWED_ORIGINS=https://cybernaut.newmin.cn')

  const schemaChecks = await checkDueDiligenceSchema()
  required(`database-schema-${DUE_DILIGENCE_SCHEMA_VERSION}`, schemaChecks.every(Boolean), schemaChecks.every(Boolean) ? '长录音、清单、分身及平台能力绑定数据已就绪' : `请先执行数据库迁移至 ${DUE_DILIGENCE_SCHEMA_VERSION}`)

  const [documentModel, interactiveModel] = await Promise.all([
    resolveAiModelRoute('ai-document').catch(() => null),
    resolveAiModelRoute('interactive-assistant').catch(() => null),
  ])
  optional('ai-document', Boolean(documentModel), documentModel ? `已配置 ${documentModel.model}` : '未配置；标准尽调清单仍可用')
  optional('interactive-assistant', Boolean(interactiveModel), interactiveModel ? `已配置 ${interactiveModel.model}` : '未配置；分身对话和智能提炼不可用')
  const asr = getDueDiligenceAsrCapability()
  optional('background-asr', asr.configured, asr.configured ? `已配置 ${asr.model}` : '未配置；仍可保存录音和浏览器转写')
} finally {
  await pool.end()
}

console.log(JSON.stringify({ ok: checks.filter(item => item.required).every(item => item.ready), checks }, null, 2))
if (checks.some(item => item.required && !item.ready)) process.exitCode = 1
