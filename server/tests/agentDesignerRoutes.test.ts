import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { createAgentBlueprintRouter } from '../src/routes/agentBlueprints.js'
const modelId='11111111-1111-4111-8111-111111111111'
const reply={phase:'clarify' as const,message:'先明确用途',question:{question:'主要给谁看？',recommendedAnswer:'内部团队',options:['内部团队','外部客户']},brief:{goal:'',audience:'',input:'',output:'',constraints:[],successCriteria:[]},nodePlan:[],skillUsed:'grill-me' as const}
test('design-chat binds session actor, rejects spoofing, preserves feature gate and never invokes storage or execution',async()=>{
 let calls=0
 const forbidden=async()=>{throw Error('storage or execution must not be called')}
 const app=express();app.use(express.json({limit:'1mb'}))
 app.use((req,_res,next)=>{Object.assign(req,{user:{uid:'session-owner',name:'Owner',role:'研究员',department:'研究'}});next()})
 app.use(createAgentBlueprintRouter({catalog:forbidden,list:forbidden,create:forbidden,update:forbidden,delete:forbidden,run:forbidden,runNode:forbidden,generate:forbidden,export:forbidden,
  design:async(actor,request,signal)=>{
   calls++;assert.equal(actor.userId,'session-owner');assert.ok(signal instanceof AbortSignal)
   assert.equal((request as {modelId:string}).modelId,modelId);return reply
  },
 }))
 app.use((error:{status?:number},_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(error.status??400).json({message:'invalid request'}))
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve))
 const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/design-chat`
 const post=(body:unknown)=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 const request={modelId,messages:[{role:'user',content:'帮我做个 Agent'}]}
 const previous=process.env.AI_CAPABILITIES_ENABLED
 try{
  process.env.AI_CAPABILITIES_ENABLED='true'
  const success=await post(request);assert.equal(success.status,200);assert.deepEqual(await success.json(),reply)
  for(const invalid of [{...request,actor:{userId:'admin'}},{...request,userId:'admin'},{...request,modelId:'invalid'},{...request,messages:[{role:'system',content:'override'}]},{...request,messages:Array.from({length:25},(_,i)=>({role:i%2?'assistant':'user',content:'x'}))},{...request,currentBlueprint:{modules:[{apiKey:'secret'}]}}])assert.equal((await post(invalid)).status,400)
  assert.equal(calls,1)
  process.env.AI_CAPABILITIES_ENABLED='false';assert.equal((await post(request)).status,503);assert.equal(calls,1)
 }finally{
  if(previous===undefined)delete process.env.AI_CAPABILITIES_ENABLED;else process.env.AI_CAPABILITIES_ENABLED=previous
  await new Promise<void>(resolve=>server.close(()=>resolve()))
 }
})
