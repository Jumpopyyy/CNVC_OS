import assert from 'node:assert/strict'
import test from 'node:test'
import { twinFocusOptions, twinFocusRules } from '../src/contracts/digitalTwinTemplates.js'
import { expertFocusQuestions, matchExpertFocus, validateExpertQuestionReferences, expertQuestionAttention, curateTwinChecklist } from '../src/services/digitalTwinChecklistService.js'
import { combineGeneratedQuestions, type GeneratedQuestionDraft } from '../src/services/dueDiligenceQuestionMergeService.js'

const expert = { id:'expert-a', ownerName:'合成文化专家', version:3, rules:twinFocusRules(['culture','incentives']) }
test('exact templates do not acquire incidental themes from words inside their instructions', () => {
  assert.deepEqual(matchExpertFocus({ ...expert, rules:twinFocusRules(['product']) }).options.map(item=>item.id), ['product'])
  assert.deepEqual(matchExpertFocus(expert).options.map(item=>item.id), ['culture','incentives'])
  assert.deepEqual(matchExpertFocus({ ...expert, rules:'关注产品、技术及研发、业务、财务、法务' }).options.map(item=>item.id), ['product','technology','business','finance','legal'])
})
test('negations, conditional preferences and cross-line exceptions are not silently treated as positive focus', () => {
  for (const rules of ['财务不关注，只关注文化', '不关注财务，只关注文化', '仅在制造业项目关注渠道', '不要采用以下规则：\n'+twinFocusRules(['finance']), twinFocusRules(['culture'])+'\n以上规则仅适用于制造业']) {
    const value=matchExpertFocus({...expert,rules})
    assert.equal(value.options.length,0)
    assert.match(value.warning,/需智能分析/)
  }
})
test('custom applicability boundaries are never omitted in baseline mode', () => {
  const constrained={...expert,boundaries:'仅适用于制造业项目'}
  assert.equal(expertFocusQuestions([constrained]).length,0)
  assert.match(matchExpertFocus(constrained).warning,/适用边界/)
  assert.equal(expertFocusQuestions([{...expert,boundaries:'仅提供辅助建议，结论须依据项目证据核验。'}]).length,2)
})
test('AI attribution needs a whole published rule, not an ID, private case or partial negation', () => {
  const question={publicationIds:[expert.id],expertReferences:[{publicationId:expert.id,ruleExcerpt:twinFocusOptions[0].rule}]}
  assert.deepEqual(validateExpertQuestionReferences(question,[expert]),[{publicationId:expert.id,publishedVersion:3,ruleExcerpt:twinFocusOptions[0].rule}])
  assert.equal(validateExpertQuestionReferences({publicationIds:[expert.id],expertReferences:[{publicationId:expert.id,ruleExcerpt:'文化'}]},[{...expert,rules:'文化'}])[0].ruleExcerpt,'文化')
  for(const value of [{publicationIds:[expert.id]}, {...question,expertReferences:[{publicationId:expert.id,ruleExcerpt:'PRIVATE_CASE_SENTINEL'}]}, {...question,expertReferences:[{publicationId:'other-expert',ruleExcerpt:twinFocusOptions[0].rule}]}, {...question,expertReferences:[...question.expertReferences,...question.expertReferences]}]) assert.throws(()=>validateExpertQuestionReferences(value,[expert]),/完整公开规则依据/)
  assert.throws(()=>validateExpertQuestionReferences({publicationIds:[expert.id],expertReferences:[{publicationId:expert.id,ruleExcerpt:'关注财务与估值'}]},[{...expert,rules:'不关注财务与估值，仅关注文化。'}]),/完整公开规则依据/)
})
test('similar questions are not relabelled with an expert unless the actual question is retained', () => {
  const required=expertFocusQuestions([expert])[0]
  const generic:GeneratedQuestionDraft={...required,title:required.title.replace('交叉核验','交流'),publicationIds:[],attentionSource:'通用核查',templateItemId:undefined}
  const result=curateTwinChecklist([], [generic], [expert])
  assert.deepEqual(result.find(item=>item.title===generic.title)?.publicationIds,[])
  assert.ok(result.some(item=>item.title===required.title && item.publicationIds.includes(expert.id)))
  assert.deepEqual(curateTwinChecklist([], [generic], [{...expert,rules:'只对已进入清算程序的企业核查债权顺位。'}])[0].publicationIds,[])
})
test('long display labels are bounded while complete versioned references survive merging', () => {
  const experts=Array.from({length:5},(_,index)=>({...expert,id:`expert-${index}`,ownerName:'合成专家长姓名'.repeat(30)}))
  const references=experts.map(item=>({publicationId:item.id,publishedVersion:item.version,ruleExcerpt:twinFocusOptions[0].rule}))
  assert.ok(expertQuestionAttention(references,experts).length<=512)
  const base=expertFocusQuestions([expert])[0]
  const result=combineGeneratedQuestions([{...base,attentionSource:'长摘要'.repeat(300),expertReferences:references.slice(0,2)}, {...base,attentionSource:'另一摘要'.repeat(300),expertReferences:references.slice(2)}])
  assert.ok(result[0].attentionSource!.length<=512)
  assert.deepEqual(result[0].expertReferences,references)
})
