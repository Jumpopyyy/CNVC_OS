import assert from 'node:assert/strict'
import test from 'node:test'
import { dueDiligenceCategories, summarizeTwinFocus, twinFocusRules } from '../src/contracts/digitalTwinTemplates.js'
import { curateTwinChecklist, expertFocusQuestions } from '../src/services/digitalTwinChecklistService.js'
import { buildTwinKnowledgeQuestion, rankTwinKnowledge, validateTwinKnowledgeQuotes, type TwinKnowledgeSource } from '../src/services/digitalTwinKnowledgeService.js'
import type { GeneratedQuestionDraft } from '../src/services/dueDiligenceQuestionMergeService.js'

test('culture, general investment, sales preferences yield distinct evidence-oriented expert questions', () => {
  const experts = [ {id:'a',ownerName:'组织顾问',version:3,rules:twinFocusRules(['culture','incentives'])}, {id:'b',ownerName:'投资顾问',version:2,rules:twinFocusRules(['product','technology','finance','legal'])}, {id:'c',ownerName:'增长顾问',version:1,rules:twinFocusRules(['sales','channel'])} ]
  const items = expertFocusQuestions(experts)
  assert.ok(items.some(item=>item.publicationIds.includes('a') && item.title.includes('价值观') || item.publicationIds.includes('a') && item.title.includes('管理层')))
  assert.ok(items.some(item=>item.publicationIds.includes('b') && item.title.includes('核心技术')))
  assert.ok(items.some(item=>item.publicationIds.includes('c') && item.title.includes('渠道')))
  assert.ok(items.every(item=>item.evidenceRequirement && item.evidence?.length===0))
  assert.match(summarizeTwinFocus(experts[0].rules),/文化/)
})
test('enhanced list avoids blindly appending all template questions, keeps five categories and every expert within 30', () => {
  const base = dueDiligenceCategories.flatMap(category=>Array.from({length:4},(_,i):GeneratedQuestionDraft=>({title:`${category}通用核查${i}`,category,priority:'中',evidenceRequirement:'合同、记录',rationale:'核验',sourceNames:[],publicationIds:[]})))
  const enhanced=Array.from({length:30},(_,i)=>({...base[0],title:`已基于材料核查${i}`,category:dueDiligenceCategories[i%5],publicationIds:i===0?['a']:[]}))
  const result=curateTwinChecklist(base,enhanced,[{id:'a',ownerName:'甲',version:1,rules:'文化'},{id:'b',ownerName:'乙',version:1,rules:'销售、渠道'}])
  assert.equal(result.length,30)
  assert.equal(new Set(result.map(item=>item.category)).size,5)
  assert.ok(result.some(item=>item.publicationIds.includes('a')))
  assert.ok(result.some(item=>item.publicationIds.includes('b')))
  assert.ok(result.every(item=>!item.title.includes('通用核查')))
})
const source: TwinKnowledgeSource={id:'record1',kind:'确认记录',title:'合成估值谈判',version:2,date:'2026-09-15T00:00:00Z',text:'2026年9月15日讨论的投前估值为3亿元，尚未签署协议。'}
test('project facts reject invented amounts and fabricated sources and preserve uncertainty',()=>{
  assert.throws(()=>validateTwinKnowledgeQuotes([source],{matches:[{sourceId:'record1',quote:source.text},{sourceId:'record1',quote:'最终估值5亿元'},{sourceId:'other-project',quote:'已经签署协议'}],missing:false}),{code:'TWIN_KNOWLEDGE_EVIDENCE_INVALID'})
  const result=validateTwinKnowledgeQuotes([source],{matches:[{sourceId:'record1',quote:source.text}],missing:true})
  assert.equal(result.matches.length,1);assert.equal(result.missing,true)
  assert.match(result.matches[0].quote,/尚未签署/)
  assert.deepEqual(validateTwinKnowledgeQuotes([],{matches:[],missing:true}),{matches:[],missing:true})
})
test('invalid or contradictory model evidence cannot be downgraded to a missing-information reminder',()=>{
  for(const value of [{matches:[],missing:false},{matches:[{sourceId:'record1',quote:source.text}]},{matches:'SECRET_PROVIDER_PAYLOAD',missing:true},null]) {
    assert.throws(()=>validateTwinKnowledgeQuotes([source],value),(error:unknown)=>{
      assert.equal((error as {code:string}).code,'TWIN_KNOWLEDGE_EVIDENCE_INVALID')
      assert.equal((error as {status:number}).status,409)
      assert.match((error as Error).message,/未生成补充提醒/)
      assert.doesNotMatch((error as Error).message,/SECRET_PROVIDER_PAYLOAD/)
      return true
    })
  }
})
test('retrieval finds valuation in the middle of a long document and does not invent unrelated content',()=>{
  const rows=rankTwinKnowledge('上个月估值谈了多少？',[{...source,text:'资料说明。'.repeat(1000)+source.text+'附件。'.repeat(1000)}])
  assert.ok(rows.some(item=>item.text.includes(source.text)))
  assert.equal(rankTwinKnowledge('渠道如何建设？',[source]).length,0)
})
test('partial quotation cannot erase negation, unit or valuation conditions', () => {
  const record = { ...source, text: '会议纪要。若融资顺利则估值可能为3亿元，尚未签署协议。仍需核实。' }
  const result = validateTwinKnowledgeQuotes([record], { matches: [{ sourceId: record.id, quote: '签署协议' }], missing: false })
  assert.equal(result.matches[0].quote, '若融资顺利则估值可能为3亿元，尚未签署协议。')
})
test('complete quotations do not accidentally append the next unrelated sentence', () => {
  const record = { ...source, text: source.text + '其他业务说明。' }
  const result = validateTwinKnowledgeQuotes([record], { matches: [{ sourceId: record.id, quote: source.text }], missing: false })
  assert.equal(result.matches[0].quote, source.text)
})
test('retrieval bounds giant paragraphs without duplicating or silently truncating conditions', () => {
  const record = { ...source, text: '估值为3亿元，前提是' + '满足交割条件'.repeat(1600) }
  assert.throws(() => rankTwinKnowledge('估值多少？', [record]), { code: 'TWIN_KNOWLEDGE_PASSAGE_TOO_LARGE' })
  const many = { ...source, text: source.text.repeat(3000) }
  const matches = rankTwinKnowledge('估值多少？', [many])
  assert.equal(matches.length, 24)
  assert.equal(new Set(matches.map(row => row.id)).size, matches.length)
  assert.ok(matches.every(row => row.text.length <= 2400 && row.text.endsWith('。')))
})

test('employee reminders retain follow-up context and repeated sends keep the same topic', () => {
  const anchor = '9月15日估值谈到多少？', followUp = '后来呢？'
  const first = buildTwinKnowledgeQuestion(followUp, [anchor])
  assert.match(first, /本轮问题：后来呢/)
  assert.match(first, /9月15日估值谈到多少/)
  assert.match(first, /不是已核实事实/)
  assert.equal(buildTwinKnowledgeQuestion(followUp, [anchor, followUp, followUp, followUp]), first)
  assert.equal(buildTwinKnowledgeQuestion(anchor, [anchor, anchor]), anchor)
  assert.notEqual(buildTwinKnowledgeQuestion(followUp, ['渠道建设方案落实了吗？']), first)
})

test('inquiry context is bounded for storage and never substitutes prior questions for evidence', () => {
  const query = '当前问题'.repeat(1600)
  const built = buildTwinKnowledgeQuestion(query, ['最早的旧主题', '甲'.repeat(8000), '乙'.repeat(8000)])
  assert.ok(built.includes(query))
  assert.doesNotMatch(built, /最早的旧主题/)
  assert.match(built, /此前提问较长，后续省略/)
  assert.ok(Buffer.byteLength(built, 'utf8') < 65535)
  assert.throws(()=>validateTwinKnowledgeQuotes([], { matches: [{ sourceId: 'question', quote: '甲甲甲甲' }], missing: false }), { code:'TWIN_KNOWLEDGE_EVIDENCE_INVALID' })
})
