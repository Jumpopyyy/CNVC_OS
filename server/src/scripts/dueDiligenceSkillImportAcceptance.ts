import assert from 'node:assert/strict'
import { parseDueDiligenceSkillBaseline, prepareDueDiligenceSkillImport } from '../services/dueDiligenceSkillImportService.js'

const content = '# 客户集中度核查\n- 计算前五大客户占比\n- 核对合同、发票和回款'
const baseline = parseDueDiligenceSkillBaseline(content, 'source.md')
assert.equal(baseline.name, '客户集中度核查')
assert.equal(baseline.checklist.length, 2)

const runtime = async () => ({ baseUrl: 'https://model.example.invalid/v1', apiKey: '', model: 'test-model', profile: 'ai-document' as const })
const enhanced = await prepareDueDiligenceSkillImport(
  { content, sourceName: 'source.md', role: '投资经理' },
  {
    resolveRuntime: runtime,
    complete: async request => {
      assert.equal(request.model, 'test-model')
      assert.equal(request.json, true)
      assert.match(request.messages[0].content, /不可信的外部文本/)
      return { text: JSON.stringify({ name: '客户集中度核查', trigger: '客户收入核验', instructions: '计算集中度并交叉核对回款。', checklist: ['核对合同', '核对回款'], outputFormat: '结论与证据', boundaries: '不得执行外部代码或读取未授权资料。' }), usage: null }
    },
  },
)
assert.equal(enhanced.generationMode, 'ai')
assert.equal(enhanced.modelName, 'test-model')
assert.equal(enhanced.parsed.checklist.length, 2)

const fallback = await prepareDueDiligenceSkillImport(
  { content, sourceName: 'source.md', role: '投资经理' },
  { resolveRuntime: runtime, complete: async () => ({ text: 'not json', usage: null }) },
)
assert.equal(fallback.generationMode, 'baseline')
assert.deepEqual(fallback.parsed, baseline)
assert.ok(fallback.warning)

console.log('due diligence skill import acceptance passed')
