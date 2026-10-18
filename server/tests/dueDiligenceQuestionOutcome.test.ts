import test from 'node:test'
import assert from 'node:assert/strict'
import { questionOutcome, questionOutcomePatch, questionOutcomeStillCurrent } from '../src/contracts/dueDiligenceQuestionOutcome.js'
import { twinKnowledgeTimeContext, validateTwinKnowledgeQuotes } from '../src/services/digitalTwinKnowledgeService.js'
import { shouldLearnExperienceEvent } from '../src/services/dueDiligenceTwinLearningService.js'
import { z } from 'zod'
import { suppliedPatchFields } from '../src/contracts/dueDiligencePatch.js'

test('patch validation never fills absent status, notes or material IDs with creation defaults', () => {
  const create=z.object({title:z.string().trim().min(1),status:z.enum(['待核查','已完成']).default('待核查'),note:z.string().default(''),fileIds:z.array(z.string()).default([])})
  const patch=suppliedPatchFields(create.partial().extend({expectedVersion:z.number().int().positive()}).strict())
  assert.deepEqual(patch.parse({title:' 新标题 ',expectedVersion:3}),{title:'新标题',expectedVersion:3})
  assert.deepEqual(patch.parse({note:'',fileIds:[],expectedVersion:3}),{note:'',fileIds:[],expectedVersion:3})
  assert.equal(patch.safeParse({title:'',expectedVersion:3}).success,false)
  assert.equal(patch.safeParse({title:'新标题'}).success,false)
  assert.equal(patch.safeParse({expectedVersion:3,unrecognized:true}).success,false)
})

const generated = { source:'标准模板', generationKey:'template:finance-01', evidenceRequirement:'请提供支持估值7亿元的融资条款', conclusion:'', followUpNote:'' }
test('generated evidence requirements never become findings from an empty completion', () => {
  const outcome=questionOutcome(generated)
  assert.equal(outcome.text,'')
  assert.equal(shouldLearnExperienceEvent('question.completed',outcome),false)
  assert.deepEqual(questionOutcomePatch(generated,{}),{})
  assert.deepEqual(questionOutcomePatch(generated,{evidenceRequirement:generated.evidenceRequirement}),{})
})
test('only an actual note edit is captured; editing title or resubmitting generated instructions is insufficient', () => {
  const note='双方仅讨论投前3亿元，尚未签署协议。'
  const patch=questionOutcomePatch(generated,{evidenceRequirement:note})
  assert.deepEqual(patch,{followUpNote:note})
  const outcome=questionOutcome({...generated,evidenceRequirement:note,...patch})
  assert.equal(outcome.text,`员工备注：${note}`)
  assert.equal(shouldLearnExperienceEvent('question.completed',outcome),true)
  assert.deepEqual(questionOutcomePatch({...generated,...patch},{evidenceRequirement:''}),{followUpNote:''})
})
test('manual legacy notes remain available, but generated keys prevent a misleading manual label', () => {
  assert.equal(questionOutcome({source:'人工创建',evidenceRequirement:'已核对合同原件'}).note,'已核对合同原件')
  assert.equal(questionOutcome({...generated,source:'人工创建'}).text,'')
  assert.equal(questionOutcome({source:'人工创建',templateItemId:'finance-01',evidenceRequirement:'模板材料要求'}).text,'')
  assert.deepEqual(questionOutcomePatch({source:'人工创建',evidenceRequirement:'旧备注'},{followUpNote:''}),{evidenceRequirement:''})
})
test('question titles and evidence requests cannot be cited as employee outcome facts', () => {
  const source={id:'question:1',kind:'员工结论',title:'是否已经确定估值7亿元？',date:'2026-10-01T00:00:00.000Z',version:2,text:questionOutcome({...generated,followUpNote:'仅讨论投前3亿元，尚未签署协议。'}).text}
  assert.doesNotMatch(source.text,/7亿元|请提供/)
  assert.throws(()=>validateTwinKnowledgeQuotes([source],{matches:[{sourceId:source.id,quote:'估值7亿元'}],missing:false}),{code:'TWIN_KNOWLEDGE_EVIDENCE_INVALID'})
  assert.match(validateTwinKnowledgeQuotes([source],{matches:[{sourceId:source.id,quote:'投前3亿元'}],missing:false}).matches[0].quote,/尚未签署/)
})
test('relative dates use the Shanghai calendar without treating upload dates as business dates', () => {
  const context=twinKnowledgeTimeContext(new Date('2026-09-30T16:05:00.000Z'))
  assert.equal(context.calendarDate,'2026-10-01')
  assert.equal(context.timeZone,'Asia/Shanghai')
  assert.equal(context.date,'2026-09-30T16:05:00.000Z')
  assert.match(context.recordDateMeaning,/未注明时不得推断/)
})
test('cleared, amended, reopened or deleted findings cannot remain current learning evidence', () => {
  const question={...generated,status:'已完成',followUpNote:'原始合同尚未签署。'}
  const payload={conclusion:'',note:question.followUpNote}
  assert.equal(questionOutcomeStillCurrent(payload,question),true)
  for (const changed of [{...question,followUpNote:''},{...question,followUpNote:'已签署原始合同。'},{...question,status:'待核查'},{...question,deletedAt:new Date()},undefined]) assert.equal(questionOutcomeStillCurrent(payload,changed),false)
  assert.equal(questionOutcomeStillCurrent({note:generated.evidenceRequirement},{...generated,status:'已完成'}),false,'旧的错误材料要求事件不能重新成为有效来源')
})
