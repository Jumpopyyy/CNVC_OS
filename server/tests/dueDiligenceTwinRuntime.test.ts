import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveDueDiligenceTwinContext, safePublicTwinContext } from '../src/services/dueDiligenceTwinRuntimeService.js'
import { shouldLearnExperienceEvent, experienceRulesConflict, isReviewedExperienceEvent } from '../src/services/dueDiligenceTwinLearningService.js'
const twin={id:'twin',name:'合成测试分身',ownerUserId:'owner',activeVersion:3,rules:'现金流核验',cases:'私有案例不可公开'}
const skill={id:'skill',name:'合成现金流核查',status:'已生效',activeVersion:2,version:2,trigger:'尽调',instructions:'核对流水',checklist:['原件'],outputFormat:'证据与缺口',boundaries:'不替代判断',sourceRefs:[{fileId:'source'}]}
const dependencies={twin:async()=>twin,skills:async()=>[skill],sourceAccessible:async()=>true,projectAccessible:async()=>true}
test('reviewed evidence cannot be proposed again by the model engine', () => {
  const event = {id:'event-1',eventType:'conversation.feedback'}
  assert.equal(isReviewedExperienceEvent(event,[{status:'已拒绝',sourceKey:'rules',sourceRefs:[{eventId:'event-1'}]}]),true)
  assert.equal(isReviewedExperienceEvent(event,[{status:'已采纳',sourceKey:'feedback:event-1'}]),true)
  assert.equal(isReviewedExperienceEvent(event,[{status:'待确认',sourceKey:'feedback:event-1'}]),false)
  assert.equal(isReviewedExperienceEvent({...event,id:'other'},[{status:'已拒绝',sourceKey:'feedback:event-1'}]),false)
})
test('active private Skills are used with their exact versions',async()=>{
  const result=await resolveDueDiligenceTwinContext({userId:'owner',twinId:'twin',task:'checklist'},dependencies)
  assert.match(result.prompt,/核对流水/); assert.deepEqual(result.snapshot.skills,[{id:'skill',name:'合成现金流核查',version:2}])
})
test('disabled, revoked, wrong-task and temporary exclusions stop use',async()=>{
  const input={userId:'owner',twinId:'twin',task:'checklist' as const}
  for (const deps of [{...dependencies,skills:async()=>[{...skill,status:'已停用'}]}, {...dependencies,sourceAccessible:async()=>false}, {...dependencies,skills:async()=>[{...skill,taskScopes:['conversation' as const]}]}]) assert.equal((await resolveDueDiligenceTwinContext(input,deps)).snapshot.skills.length,0)
  assert.equal((await resolveDueDiligenceTwinContext({...input,useSkills:false},dependencies)).snapshot.skills.length,0)
  assert.equal((await resolveDueDiligenceTwinContext({...input,excludedSkillIds:['skill']},dependencies)).snapshot.skills.length,0)
})
test('cross-owner, deleted twin and inaccessible project are rejected',async()=>{
  const input={userId:'owner',twinId:'twin',task:'conversation' as const,projectId:'project'}
  await assert.rejects(()=>resolveDueDiligenceTwinContext({...input,userId:'other'},dependencies),/无权/)
  await assert.rejects(()=>resolveDueDiligenceTwinContext(input,{...dependencies,twin:async()=>({...twin,deletedAt:new Date()})}),/无权/)
  await assert.rejects(()=>resolveDueDiligenceTwinContext(input,{...dependencies,projectAccessible:async()=>false}),/无权/)
})
test('public context never reads legacy private cases',()=>{
  const prompt=safePublicTwinContext({introduction:'简介',publicRules:'公开规则',publicBoundaries:'公开边界',publicCases:'PRIVATE_CASE_SECRET'})
  assert.match(prompt,/公开边界/);assert.doesNotMatch(prompt,/PRIVATE_CASE_SECRET/)
})
test('empty completion and unaccepted chat do not become experience',()=>{
  assert.equal(shouldLearnExperienceEvent('question.completed',{conclusion:'',note:'  '}),false)
  assert.equal(shouldLearnExperienceEvent('question.completed',{conclusion:'已比对三期合同并发现账期差异'}),true)
  assert.equal(shouldLearnExperienceEvent('conversation.feedback',{question:'这是什么',feedback:'拒绝',answer:'示例回答'}),false)
  assert.equal(shouldLearnExperienceEvent('conversation.feedback',{feedback:'采纳',answer:'示例回答'}),true)
  assert.equal(experienceRulesConflict('核实原件','不应核实原件'),true)
})
