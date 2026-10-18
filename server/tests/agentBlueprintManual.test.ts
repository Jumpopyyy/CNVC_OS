import assert from 'node:assert/strict'
import test from 'node:test'
import { executeAgentBlueprint, validateAgentBlueprint, executeAgentBlueprintNode } from '../src/services/agentBlueprintService.js'
const modelId = '11111111-1111-4111-8111-111111111111'
const node = (id:string, more={}) => ({ id,name:id,modelId,prompt:'process',inputTemplate:'{{previous}}',skillIds:[],outputFormat:'text',outputInstructions:'',...more })
const bp = (modules:unknown[],more={}) => ({schemaVersion:1,name:'manual',description:'',modules,...more})
test('manual template, JSON extraction, text operations and aggregate execute without a model',async()=>{
 const result=await executeAgentBlueprint(bp([node('a',{kind:'template',inputTemplate:'{"value":"  HELLO  "}'}),node('b',{kind:'json-extract',jsonExtract:{path:'value',missing:'error'}}),node('c',{kind:'text-process',textProcess:{operation:'trim'}}),node('d',{kind:'aggregate',aggregate:{sources:['c','input'],mode:'concat',separator:'|'}})]),'original',async()=>{throw Error('must not call')})
 assert.equal(result.output,'HELLO|original');assert.equal(result.status,'succeeded')
})
test('typed input defaults and conditions work and invalid variables fail',async()=>{
 const value=bp([node('a',{kind:'template',inputTemplate:'{{inputs.count}}/{{inputs.flag}}'})],{inputFields:[{name:'count',label:'数量',type:'number',required:true,defaultValue:'3'},{name:'flag',label:'开关',type:'boolean',required:true}]})
 assert.equal((await executeAgentBlueprint(value,'',async()=>'',undefined,undefined,{flag:'false'})).output,'3/false')
 await assert.rejects(executeAgentBlueprint(value,'',async()=>'',undefined,undefined,{flag:'maybe'}))
 assert.throws(()=>validateAgentBlueprint(bp([node('a')],{inputFields:[{name:'__proto__',label:'x',type:'text',required:false}]})))
})
test('retries preserve input, fallback is marked, cancellation never retries',async()=>{
 let calls=0
 const value=bp([node('a',{errorPolicy:{retryCount:2,onFailure:'fallback',fallbackOutput:'fallback {{input}}'}})])
 const result=await executeAgentBlueprint(value,'safe',async()=>{calls++;throw Error('provider secret')})
 assert.equal(calls,3);assert.equal(result.output,'fallback safe');assert.equal(result.steps[0].fallback,true);assert.equal(result.steps[0].attempts,3);assert.ok(!JSON.stringify(result).includes('provider secret'))
 const ctl=new AbortController();calls=0
 const cancelled=await executeAgentBlueprint(value,'safe',async()=>{calls++;ctl.abort();throw Error('abort')},undefined,ctl.signal)
 assert.equal(calls,1);assert.equal(cancelled.status,'failed');assert.equal(cancelled.steps[0].fallback,undefined)
})
test('single node test ignores unfinished unrelated nodes, does not run ancestors and rejects forged output refs',async()=>{
 const value=bp([node('a',{prompt:''}),node('b',{kind:'template',inputTemplate:'{{modules.a}}/{{previous}}'})])
 const result=await executeAgentBlueprintNode(value,'b',{input:'raw',previous:'edited previous',outputs:{a:'edited ancestor'}},async()=>{throw Error('upstream called')})
 assert.equal(result.output,'edited ancestor/edited previous');assert.equal(result.steps.length,1)
 await assert.rejects(executeAgentBlueprintNode(value,'b',{input:'',previous:'',outputs:{evil:'forged'}},async()=>''))
})
test('JSON paths prohibit prototype access and oversized aggregate remains bounded',async()=>{
 assert.throws(()=>validateAgentBlueprint(bp([node('a',{kind:'json-extract',jsonExtract:{path:'constructor.prototype',missing:'error'}})])))
 const value=bp([node('a',{kind:'aggregate',aggregate:{sources:['input','input','input'],mode:'concat',separator:''}})])
 assert.equal((await executeAgentBlueprint(value,'x'.repeat(60000),async()=>'' )).status,'failed')
})
test('conditions support AND/OR, numeric comparisons, empty values and expose chosen branch',async()=>{
 const value=bp([node('a',{kind:'template',inputTemplate:'{{input}}',conditionGroup:{mode:'and',rules:[{source:'input',operator:'gte',value:'2'},{source:'input',operator:'lt',value:'5'}]}})])
 assert.equal((await executeAgentBlueprint(value,'3',async()=>'' )).output,'3')
 assert.equal((await executeAgentBlueprint(value,'abc',async()=>'' )).steps[0].status,'skipped')
 const judge=bp([node('a',{kind:'condition',conditionGroup:{mode:'or',rules:[{source:'input',operator:'empty',value:''},{source:'input',operator:'not_equals',value:'deny'}]}})],{graph:{positions:{},edges:[]}})
 assert.equal((await executeAgentBlueprintNode(judge,'a',{input:'ok',previous:'prior',outputs:{}},async()=>'' )).steps[0].conditionMatched,true)
})
test('all bounded local processors and root JSON extraction have deterministic behavior',async()=>{
 const run=(more:object,input:string)=>executeAgentBlueprint(bp([node('a',{inputTemplate:'{{input}}',...more})]),input,async()=>{throw Error('model called')})
 assert.equal((await run({kind:'text-process',textProcess:{operation:'uppercase'}},'Abc')).output,'ABC')
 assert.equal((await run({kind:'text-process',textProcess:{operation:'lowercase'}},'AbC')).output,'abc')
 assert.equal((await run({kind:'text-process',textProcess:{operation:'slice',start:1,end:3}},'abcd')).output,'bc')
 assert.equal((await run({kind:'text-process',textProcess:{operation:'replace',search:'a',replacement:'xx'}},'aba')).output,'xxbxx')
 assert.equal((await run({kind:'json-extract',jsonExtract:{path:'[0].n',missing:'error'}},'[{"n":2}]')).output,'2')
 assert.equal((await run({kind:'json-extract',jsonExtract:{path:'',missing:'error'}},'{"n":2}')).output,'{"n":2}')
 assert.equal((await run({kind:'json-extract',jsonExtract:{path:'missing',missing:'empty'}},'{}')).output,'')
 assert.equal((await run({kind:'aggregate',aggregate:{sources:['previous','input'],mode:'first-non-empty',separator:''}},'kept')).output,'kept')
 const large=await run({kind:'text-process',textProcess:{operation:'replace',search:'a',replacement:'x'.repeat(16000)}},'a'.repeat(60000))
 assert.equal(large.status,'failed');assert.ok(JSON.stringify(large).length<65000)
})
test('invalid defaults, unknown fields, invalid JSON fallback, and missing node config fail safely',async()=>{
 for(const more of [{modelOptions:{temperature:3}},{modelOptions:{maxTokens:0}},{kind:'json-extract'},{kind:'aggregate'},{kind:'text-process'},{kind:'text-process',textProcess:{operation:'replace',search:''}},{errorPolicy:{retryCount:3,onFailure:'stop'}},{errorPolicy:{retryCount:0,onFailure:'fallback'}}])assert.throws(()=>validateAgentBlueprint(bp([node('a',more)])))
 assert.throws(()=>validateAgentBlueprint(bp([node('a')],{inputFields:[{name:'n',label:'n',required:false,type:'number',defaultValue:'oops'}]})))
 await assert.rejects(executeAgentBlueprint(bp([node('a')]),'',async()=>'',undefined,undefined,{unknown:'x'}),{status:400})
 const result=await executeAgentBlueprint(bp([node('a',{inputTemplate:'{{input}}',outputFormat:'json',errorPolicy:{retryCount:0,onFailure:'fallback',fallbackOutput:'not json'}})]),'kept',async()=>{throw Error('secret')})
 assert.equal(result.status,'failed');assert.equal(result.steps[0].input,'kept');assert.ok(!JSON.stringify(result).includes('secret'))
})
test('single-node authorization checks only the chosen model, propagates options and rejects forbidden skills before completion',async()=>{
 const {runAgentBlueprintNode,runAgentBlueprint}=await import('../src/services/agentBlueprintService.js')
 const resolved:string[]=[];let calls=0
 const deps={resources:async()=>({models:[],skills:[],resolveAiModelById:async(id:string)=>{resolved.push(id);return id===modelId?{model:'test',timeoutMs:1000}:null}}),complete:async(request:{maxTokens:number;temperature:number})=>{calls++;assert.equal(request.maxTokens,123);assert.equal(request.temperature,0);return{text:'ok'}}} as unknown as import('../src/services/agentBlueprintService.js').AgentBlueprintRuntimeDependencies
 const actor={userId:'manual-auth',userName:'Tester',role:'研究员',department:''}
 const value=bp([node('a',{prompt:'',modelId:'22222222-2222-4222-8222-222222222222'}),node('b',{modelOptions:{maxTokens:123,temperature:0}})])
 assert.equal((await runAgentBlueprintNode(actor,value,'b',{input:'',previous:'edited',outputs:{}},undefined,deps)).output,'ok')
 assert.deepEqual(resolved,[modelId]);assert.equal(calls,1)
 await assert.rejects(runAgentBlueprintNode({...actor,userId:'manual-forbidden'},bp([node('a',{skillIds:[modelId]})]),'a',{input:'',previous:'',outputs:{}},undefined,deps),{code:'AGENT_BLUEPRINT_SKILL_FORBIDDEN'})
 assert.equal(calls,1)
 const full=bp([node('a',{kind:'template',inputTemplate:'{{inputs.word}}'})],{inputFields:[{name:'word',label:'word',type:'text',required:true}]})
 assert.equal((await runAgentBlueprint({...actor,userId:'manual-full-variables'},full,'',undefined,undefined,deps,{word:'hello'})).output,'hello')
})
test('JSON extraction preserves valid JSON for strings, scalars, arrays, objects and absent optional paths',async()=>{
 for(const [json,path,expected] of [['{"name":"robot"}','name','"robot"'],['"root"','','"root"'],['[false]','[0]','false'],['{"n":null}','n','null'],['{"list":[1,2]}','list','[1,2]'],['{}','absent','null']]){
  const result=await executeAgentBlueprint(bp([node('a',{kind:'json-extract',inputTemplate:'{{input}}',outputFormat:'json',jsonExtract:{path,missing:'empty'}})]),json,async()=>{throw Error('model call')})
  assert.equal(result.status,'succeeded');assert.equal(result.output,expected);assert.doesNotThrow(()=>JSON.parse(result.output))
 }
})
