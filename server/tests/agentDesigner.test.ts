import assert from 'node:assert/strict'
import test from 'node:test'
import { designAgentChat, parseAgentDesignerRequest } from '../src/services/agentDesignerService.js'
import { validateAgentBlueprint, type AgentBlueprintRuntimeDependencies } from '../src/services/agentBlueprintService.js'
const modelId='11111111-1111-4111-8111-111111111111'
const otherId='22222222-2222-4222-8222-222222222222'
const brief={goal:'整理笔记',audience:'内部团队',input:'会议笔记',output:'Markdown',constraints:[],successCriteria:['保留事实']}
const module={id:'summarize',name:'整理',kind:'llm',modelId,prompt:'总结已提供的笔记',inputTemplate:'{{input}}',skillIds:[],outputFormat:'markdown',outputInstructions:''}
const blueprint={schemaVersion:1,name:'笔记整理',description:'',modules:[module]}
const ready={phase:'ready',message:'已按需求生成可编辑方案',brief,nodePlan:[{name:'整理',kind:'llm',reason:'需要理解语义',input:'笔记',output:'Markdown'}],blueprint,skillUsed:null}
const clarify={phase:'clarify',message:'先确认输出用途',question:{question:'主要给谁看？',recommendedAnswer:'内部团队',options:['内部团队','外部客户']},brief:{...brief,goal:'',input:'',output:''},nodePlan:[],skillUsed:'grill-me'}
const request={modelId,messages:[{role:'user' as const,content:'帮我整理笔记'}]}
let actorCounter=0
const actor=()=>({userId:`designer-unit-${++actorCounter}`,userName:'Tester',role:'研究员',department:'研究'})
function runtime(reply:unknown,inspect?:(input:Record<string,unknown>)=>void){
 return {resources:async()=>({models:[{id:modelId}],skills:[],resolveAiModelById:async(id:string)=>id===modelId?{model:'test',timeoutMs:1000,apiKey:'private-provider-secret',baseUrl:'https://provider.invalid'}:null}),complete:async(input:Record<string,unknown>)=>{inspect?.(input);return{text:JSON.stringify(reply)}}} as unknown as AgentBlueprintRuntimeDependencies
}
test('designer validates bounded alternating conversation and allows incomplete draft without credentials',()=>{
 assert.deepEqual(parseAgentDesignerRequest({...request,currentBlueprint:{schemaVersion:1,modules:[{id:'unfinished',prompt:''}]}}).messages,request.messages)
 for(const invalid of [{...request,actor:'admin'},{...request,messages:[{role:'assistant',content:'x'}]},{...request,messages:[...request.messages,...request.messages]},{...request,messages:[{role:'user',content:'x'.repeat(12001)}]},{...request,messages:Array.from({length:7},(_,i)=>({role:i%2?'assistant':'user',content:'x'.repeat(10000)}))},{...request,currentBlueprint:{apiKey:'secret'}},{...request,currentBlueprint:JSON.parse('{"__proto__":{"x":1}}')}])assert.throws(()=>parseAgentDesignerRequest(invalid))
})
test('clarification loads fixed grill-me instructions, public resource catalog and asks one question without writes',async()=>{
 const output=await designAgentChat(actor(),request,undefined,runtime(clarify,input=>{
  const text=JSON.stringify(input.messages);assert.match(text,/grill-me/);assert.match(text,/每轮只问一个/);assert.ok(!text.includes('private-provider-secret'));assert.ok(!text.includes('provider.invalid'));assert.ok(input.signal instanceof AbortSignal)
 }))
 assert.deepEqual(output,clarify)
})
test('clear intent returns validated preview with selected model and no execution',async()=>{
 assert.deepEqual(await designAgentChat(actor(),request,undefined,runtime(ready)),ready)
 for(const invalid of [{...ready,blueprint:{...blueprint,modules:[{...module,modelId:otherId}]}},{...ready,blueprint:{...blueprint,modules:[{...module,skillIds:[otherId]}]}},{...ready,brief:{...brief,input:''}},{...ready,unexpected:'field'}])await assert.rejects(designAgentChat(actor(),request,undefined,runtime(invalid)),{code:'AGENT_DESIGNER_INVALID'})
})
test('model access, provider failure, cancellation and malformed JSON do not leak secrets',async()=>{
 await assert.rejects(designAgentChat(actor(),{...request,modelId:otherId},undefined,runtime(ready)),{status:403})
 const broken=runtime(ready);broken.complete=async()=>{throw Error('private-provider-secret')}
 await assert.rejects(designAgentChat(actor(),request,undefined,broken),error=>String(error).includes('private-provider-secret')===false)
 const ctl=new AbortController();ctl.abort();let called=false
 await assert.rejects(designAgentChat(actor(),request,ctl.signal,runtime(ready,()=>{called=true})),{code:'AGENT_DESIGNER_CANCELLED'});assert.equal(called,false)
 const malformed=runtime(ready);malformed.complete=async()=>({text:'not json'})
 await assert.rejects(designAgentChat(actor(),request,undefined,malformed),{code:'AGENT_DESIGNER_INVALID'})
})
test('force generation requires assumptions and prevents another clarification loop',async()=>{
 await assert.rejects(designAgentChat(actor(),{...request,forceGenerate:true},undefined,runtime(clarify)),{code:'AGENT_DESIGNER_INVALID'})
 const output=await designAgentChat(actor(),{...request,forceGenerate:true},undefined,runtime(ready))
 assert.ok(output.brief.constraints.some(item=>item.includes('假设')))
})
test('caller cancellation during completion remains cancellation instead of leaking provider details',async()=>{
 const ctl=new AbortController();const deps=runtime(ready)
 deps.complete=async()=>{ctl.abort();throw Error('provider-secret')}
 await assert.rejects(designAgentChat(actor(),request,ctl.signal,deps),{status:499,code:'AGENT_DESIGNER_CANCELLED'})
})
test('multi-turn confirmed intent passes all history and current draft as user data only',async()=>{
 const a=actor();const deps=runtime(ready,input=>{
  const messages=input.messages as {role:string;content:string}[]
  assert.deepEqual(messages.slice(1).map(message=>message.role),['user','assistant','user'])
  assert.match(messages.at(-1)!.content,/当前用户画布/)
  assert.match(messages.at(-1)!.content,/unfinished/)
 })
 const resources=deps.resources
 deps.resources=async actual=>{assert.equal(actual.userId,a.userId);return resources(actual)}
 const output=await designAgentChat(a,{...request,messages:[request.messages[0],{role:'assistant',content:'主要给谁看？'},{role:'user',content:'内部团队，笔记输入，输出 Markdown'}],currentBlueprint:{modules:[{id:'unfinished',prompt:''}]}},undefined,deps)
 assert.equal(output.phase,'ready')
})

test('ready requires an explicit audience and at least one meaningful success criterion, including forced generation',async()=>{
 for(const invalidBrief of [{...brief,audience:''},{...brief,audience:'   '},{...brief,successCriteria:[]},{...brief,successCriteria:['   ']}]){
  for(const forceGenerate of [false,true])await assert.rejects(designAgentChat(actor(),{...request,forceGenerate},undefined,runtime({...ready,brief:invalidBrief})),{code:'AGENT_DESIGNER_INVALID'})
 }
 const output=await designAgentChat(actor(),{...request,forceGenerate:true},undefined,runtime(ready,input=>{
  const system=(input.messages as {role:string;content:string}[])[0].content
  assert.match(system,/audience/);assert.match(system,/successCriteria 至少一条/);assert.match(system,/受众、输入、输出或验收标准/)
 }))
 assert.equal(output.phase,'ready');assert.equal(output.brief.audience,'内部团队');assert.ok(output.brief.successCriteria.length>0)
})
test('repairs shape-only array errors once using the same authorized model, signal and bounded JSON example',async()=>{
 const malformed={...clarify,brief:{...clarify.brief,constraints:'不得编造',successCriteria:'输出清晰'}}
 const deps=runtime(clarify);const calls:Parameters<AgentBlueprintRuntimeDependencies['complete']>[0][]=[]
 deps.complete=async input=>{calls.push(input);return{text:JSON.stringify(calls.length===1?malformed:clarify)}}
 const output=await designAgentChat(actor(),{...request,currentBlueprint:{modules:[]}},undefined,deps)
 assert.deepEqual(output,clarify);assert.equal(calls.length,2);assert.equal(calls[0].model,calls[1].model);assert.equal(calls[0].signal,calls[1].signal)
 const repair=JSON.stringify(calls[1].messages);assert.match(repair,/invalid_type/);assert.match(repair,/successCriteria/);assert.match(repair,/constraints/);assert.match(repair,/options/);assert.match(repair,/nodePlan/);assert.ok(repair.length<120000)
 assert.match(calls[0].messages[0].content as string,/"constraints":\[\]/)
})
test('JSON syntax may be repaired, but a second bad shape or oversized repair input fails without a third call',async()=>{
 for(const responses of [['not json',JSON.stringify(clarify)],[JSON.stringify({...clarify,nodePlan:'not array'}),JSON.stringify({...clarify,nodePlan:'still not array'})],['x'.repeat(180001)],['x'.repeat(80001)]]){
  let calls=0;const deps=runtime(clarify);deps.complete=async()=>({text:responses[Math.min(calls++,responses.length-1)]})
  if(responses.length===2&&responses[0]==='not json')assert.equal((await designAgentChat(actor(),request,undefined,deps)).phase,'clarify')
  else await assert.rejects(designAgentChat(actor(),request,undefined,deps),{code:'AGENT_DESIGNER_INVALID'})
  assert.equal(calls,responses.length)
 }
})
test('provider failure, cancellation and semantic or authorization errors are never repaired',async()=>{
 for(const response of [{...ready,brief:{...brief,audience:''}},{...ready,blueprint:{...blueprint,modules:[{...module,modelId:otherId}]}},{...ready,blueprint:{...blueprint,modules:[{...module,skillIds:[otherId]}]}}]){
  let calls=0;await assert.rejects(designAgentChat(actor(),request,undefined,runtime(response,()=>{calls++})),{code:'AGENT_DESIGNER_INVALID'});assert.equal(calls,1)
 }
 for(const cancel of [false,true]){
  let calls=0;const ctl=new AbortController();const deps=runtime(clarify)
  deps.complete=async()=>{calls++;if(cancel)ctl.abort();throw Error('provider secret')}
  await assert.rejects(designAgentChat(actor(),request,ctl.signal,deps),{code:cancel?'AGENT_DESIGNER_CANCELLED':'AGENT_DESIGNER_FAILED'});assert.equal(calls,1)
 }
})
test('ready nested blueprint shape errors are repaired once with prefixed issue paths and a valid deterministic example',async()=>{
 const malformed={...ready,blueprint:{...blueprint,modules:[{...module,skillIds:'not-an-array'}]}}
 let calls=0;const deps=runtime(ready)
 deps.complete=async input=>{
  calls++
  const messages=input.messages as {role:string;content:string}[]
  if(calls===1){
   const exampleText=messages[0].content.split('有效 ready JSON 示例：')[1]?.split('\n')[0]
   assert.ok(exampleText,'ready JSON example must be included')
   const example=JSON.parse(exampleText)
   assert.doesNotThrow(()=>validateAgentBlueprint(example.blueprint))
   assert.deepEqual(example.blueprint.modules.map((item:{kind:string})=>item.kind),['json-extract','template'])
   assert.ok(!('graph' in example.blueprint));assert.ok(example.blueprint.modules.every((item:object)=>!('condition' in item)))
  }else{
   assert.match(messages[1].content,/"path":\["blueprint","modules",0,"skillIds"\]/)
   assert.match(messages[1].content,/invalid_type/)
  }
  return{text:JSON.stringify(calls===1?malformed:ready)}
 }
 assert.equal((await designAgentChat(actor(),request,undefined,deps)).phase,'ready');assert.equal(calls,2)
})
test('semantic graph errors and unauthorized resources never trigger shape repair; clarify cannot include a blueprint',async()=>{
 const graph={positions:{},edges:[{id:'bad',source:'summarize',target:'summarize'}]}
 for(const response of [{...ready,blueprint:{...blueprint,graph}},{...ready,blueprint:{...blueprint,modules:[{...module,modelId:otherId}]}},{...clarify,blueprint:{modules:[{skillIds:'bad'}]}}]){
  let calls=0;await assert.rejects(designAgentChat(actor(),request,undefined,runtime(response,()=>{calls++})),{code:'AGENT_DESIGNER_INVALID'});assert.equal(calls,1)
 }
})

test('validation warnings contain only bounded code/path or fixed reason and never raw conversation or response',async()=>{
 const warnings:unknown[][]=[];const previous=console.warn;console.warn=(...args:unknown[])=>{warnings.push(args)}
 try{
  const output={...clarify,message:'private-response-marker',brief:{...clarify.brief,constraints:'private-array-marker'}}
  let calls=0;const deps=runtime(clarify);deps.complete=async()=>({text:JSON.stringify(++calls===1?output:clarify)})
  await designAgentChat(actor(),{...request,messages:[{role:'user',content:'private-user-marker'}]},undefined,deps)
  const logged=JSON.stringify(warnings);assert.match(logged,/shape_repair/);assert.match(logged,/invalid_type/);assert.match(logged,/constraints/)
  assert.ok(!logged.includes('private-response-marker'));assert.ok(!logged.includes('private-array-marker'));assert.ok(!logged.includes('private-user-marker'));assert.ok(!logged.includes('private-provider-secret'))
 }finally{console.warn=previous}
})
