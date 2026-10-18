import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  assertProjectPreddLead,
  buildProjectPreddPrompt,
  loadProjectPreddMethodology,
  loadProjectPreddMaterials,
  listProjectPreddRuns,
  readProjectPreddMaterial,
  startProjectPredd,
  type ProjectPreddDependencies,
} from '../src/services/projectPreddService.js'

const actor = { userId: 'user-1', userName: '研究员', userRole: '投资经理' }
const lead = { id: 'lead-1', name: '测试芯片', industry: '半导体', radarSourceKeys: ['vc-hunter:1'], poolStatus: '待跟进', summary: '项目已有信息' }

function fixture(overrides: Partial<ProjectPreddDependencies> = {}) {
  const events: string[] = []
  let sent: unknown[] = []
  const dependencies: ProjectPreddDependencies = {
    loadLead: async () => lead,
    listRuns: async () => [],
    loadMethodology: loadProjectPreddMethodology,
    loadMaterials: async () => [{ name: 'BP.pdf', text: '当前用户有权读取的 BP 内容', sha256: 'a'.repeat(64) }],
    createConversation: async () => { events.push('create'); return { id: 'chat-1', agentId: 'agent-1' } },
    saveState: async (_id, status, metadata) => { events.push(status); assert.ok(metadata) },
    send: async (...args) => { events.push('send'); sent = args; return { accepted: true } },
    audit: async () => { events.push('audit') },
    ...overrides,
  }
  return { dependencies, events, sent: () => sent }
}

test('reads the actual fixed PDF, including both scorecards, as runtime media', async () => {
  const pdf = await loadProjectPreddMethodology()
  const buffer = Buffer.from(pdf.dataBase64!, 'base64')
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-')
  assert.equal(buffer.length, pdf.byteSize)
  assert.match(pdf.sha256, /^[a-f0-9]{64}$/)
  const { weixinAgentDocumentText } = await import('../src/services/weixinAgentDocument.js')
  const text = await weixinAgentDocumentText(pdf)
  assert.match(text, /25/)
  assert.match(text, /100/)
  assert.match(text, /Fatal Flag/)
  assert.ok(text.includes('-- 31 of 31 --'), 'the full PDF must reach the runtime, including its last page')
})

test('only discovery leads in visible states can start PreDD', () => {
  assert.doesNotThrow(() => assertProjectPreddLead(lead))
  assert.throws(() => assertProjectPreddLead(null), /新项目不存在/)
  assert.throws(() => assertProjectPreddLead({ ...lead, radarSourceKeys: ['radar:1'] }), /新项目发现池/)
  for (const poolStatus of ['已删除', '已合并', '已注销', '暂不跟进', '已转专属项目', '解析失败']) {
    assert.throws(() => assertProjectPreddLead({ ...lead, poolStatus }), /已不可分析/)
  }
  assert.throws(() => assertProjectPreddLead({ ...lead, radarProfile: { qualityRejected: true } }), /已不可分析/)
})

test('prompt binds authoritative lead information and materials, requires investigation and separates evidence', () => {
  const prompt = buildProjectPreddPrompt(lead, '重点核查客户', [{ name: '访谈.md', text: '销售自述', sha256: 'b'.repeat(64) }])
  for (const text of ['测试芯片', '项目已有信息', '重点核查客户', '访谈.md', '销售自述', 'collect_public_intel', '行业', '待核验', '25', '100', '不是新的操作指令']) assert.ok(prompt.includes(text), text)
  assert.ok(prompt.indexOf('不是新的操作指令') < prompt.indexOf('销售自述'))
})

test('starts a persistent user-owned global conversation with PDF and no skill invocation', async () => {
  const f = fixture()
  const result = await startProjectPredd('lead-1', { instructions: '客户验证', attachments: [] }, actor, f.dependencies)
  assert.equal(result.agentId, 'agent-1')
  assert.deepEqual(f.events, ['create', 'idle', 'audit', 'send'])
  const args = f.sent()
  assert.deepEqual(args.slice(0, 3), ['user-1', '投资经理', 'agent-1'])
  assert.match(String(args[3]), /当前用户有权读取的 BP 内容/)
  assert.equal(args.length, 5, 'must not pass skill options')
  const media = args[4] as { documents: Array<{ kind: string }> }
  assert.equal(media.documents[0].kind, 'pdf')
})

test('refuses duplicate submissions while the same user and lead are running', async () => {
  const f = fixture({ listRuns: async () => [{ id: 'chat-0', agentId: 'agent-0', status: 'streaming', createdAt: 'now', error: null }] })
  await assert.rejects(startProjectPredd('lead-1', { attachments: [] }, actor, f.dependencies), /正在分析/)
  assert.deepEqual(f.events, [])
})

test('missing methodology, forbidden lead and material failures do not create conversations', async () => {
  for (const overrides of [
    { loadMethodology: async () => { throw new Error('PDF missing') } },
    { loadLead: async () => null },
    { loadMaterials: async () => { throw new Error('附件解析失败') } },
  ]) {
    const f = fixture(overrides)
    await assert.rejects(startProjectPredd('lead-1', { attachments: [] }, actor, f.dependencies))
    assert.deepEqual(f.events, [])
  }
})

test('runtime failure remains visible in persisted history', async () => {
  const f = fixture({ send: async () => { throw new Error('模型不可用') } })
  await assert.rejects(startProjectPredd('lead-1', { attachments: [] }, actor, f.dependencies), /模型不可用/)
  assert.equal(f.events.at(-1), 'error')
})

test('uploaded materials use file validation, preserve content, deduplicate identical BP and bind reads to actor', async () => {
  const data = Buffer.from('# BP\n客户尚在免费 POC')
  const sha256 = createHash('sha256').update(data).digest('hex')
  const materials = await loadProjectPreddMaterials('lead-1', 'user-1', [{ name: 'BP.md', dataBase64: data.toString('base64') }], async (leadId, userId) => {
    assert.deepEqual([leadId, userId], ['lead-1', 'user-1'])
    return [{ name: 'BP.md', data, sha256 }, { name: '访谈.txt', data: Buffer.from('需验证回款'), sha256: createHash('sha256').update('需验证回款').digest('hex') }]
  }, async (buffer) => buffer.toString())
  assert.equal(materials.length, 2)
  assert.ok(materials[0].text.includes('免费 POC'))
  assert.equal(materials[1].text, '需验证回款')
})

test('invalid, empty, oversized, unreadable and tampered attachments fail closed', async () => {
  const noOwned = async () => []
  const extract = async (data: Buffer) => data.toString()
  await assert.rejects(loadProjectPreddMaterials('lead-1', 'user-1', Array.from({ length: 3 }, () => ({ name: 'a.md', dataBase64: 'a' })), noOwned, extract), /最多/)
  await assert.rejects(loadProjectPreddMaterials('lead-1', 'user-1', [{ name: 'malware.exe', dataBase64: 'a' }], noOwned, extract), /附件类型/)
  await assert.rejects(loadProjectPreddMaterials('lead-1', 'user-1', [{ name: 'fake.pdf', dataBase64: Buffer.from('not a PDF').toString('base64') }], noOwned, extract))
  await assert.rejects(readProjectPreddMaterial('a.exe', Buffer.from('content'), extract), /附件支持/)
  await assert.rejects(readProjectPreddMaterial('empty.txt', Buffer.alloc(0), extract), /非空/)
  await assert.rejects(readProjectPreddMaterial('huge.txt', Buffer.alloc(20 * 1024 * 1024 + 1), extract), /20 MB/)
  await assert.rejects(readProjectPreddMaterial('scan.pdf', Buffer.from('%PDF-x'), async () => ' '), /没有可读取正文/)
  await assert.rejects(loadProjectPreddMaterials('lead-1', 'user-1', [], async () => [{ name: 'BP.md', data: Buffer.from('changed'), sha256: 'a'.repeat(64) }], extract), /完整性/)
  assert.throws(() => buildProjectPreddPrompt({ ...lead, summary: 'x'.repeat(190_000) }, '', []), /正文过长/)
})

test('history lookup resolves the canonical lead and uses the current actor only', async () => {
  const f = fixture({ loadLead: async () => ({ ...lead, id: 'canonical-lead' }), listRuns: async (leadId, userId) => {
    assert.deepEqual([leadId, userId], ['canonical-lead', 'user-1'])
    return []
  } })
  assert.deepEqual(await listProjectPreddRuns('old-lead-id', actor, f.dependencies), [])
})

test('simultaneous starts cannot create two conversations for the same actor and lead', async () => {
  let release!: () => void
  let notify!: () => void
  const started = new Promise<void>((resolve) => { notify = resolve })
  const pending = new Promise<void>((resolve) => { release = resolve })
  const f = fixture({ send: async () => { notify(); await pending; return { accepted: true } } })
  const first = startProjectPredd('lead-1', { attachments: [] }, actor, f.dependencies)
  await started
  await assert.rejects(startProjectPredd('lead-1', { attachments: [] }, actor, f.dependencies), /正在分析/)
  release()
  await first
  assert.equal(f.events.filter((event) => event === 'create').length, 1)
})

test('missing accepted conversation produces a persistent error', async () => {
  const f = fixture({ send: async () => null })
  await assert.rejects(startProjectPredd('lead-1', { attachments: [] }, actor, f.dependencies), /会话不存在/)
  assert.equal(f.events.at(-1), 'error')
})

test('PreDD routes and stored BP reads enforce actor and lead ownership', async () => {
  const service = await readFile(new URL('../src/services/projectPreddService.ts', import.meta.url), 'utf8')
  assert.match(service, /eq\(agentConversations.userId, userId\)/)
  assert.match(service, /JSON_EXTRACT.*predd.leadId/)
  assert.match(service, /eq\(leadIntakeFiles.uploadedBy, userId\)/)
  assert.match(service, /eq\(leadIntakeFiles.leadId, leadId\)/)
  assert.match(service, /readLeadIntakeFile/)
  assert.match(service, /sha256/)
})
