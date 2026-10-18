import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import {createAgentBlueprintRouter} from '../src/routes/agentBlueprints.js'
test('single-node HTTP test binds authenticated actor, editable context, signal and bounded variables',async()=>{
 const calls:string[]=[]
 const result={id:'test',status:'succeeded' as const,steps:[],output:'done',durationMs:0}
 const app=express();app.use(express.json({limit:'3mb'}));app.use((req,_res,next)=>{Object.assign(req,{user:{uid:'trusted',name:'Tester',role:'研究员',department:''}});next()})
 app.use(createAgentBlueprintRouter({
  catalog:async()=>({models:[],skills:[]}),list:async()=>({list:[]}),create:async()=>{throw Error('not used')},update:async()=>{throw Error('not used')},delete:async()=>({id:'unused',deleted:true}),generate:async()=>{throw Error('not used')},export:async()=>({filename:'a',content:'',mimeType:'text/plain'}),
  runNode:async(actor,_blueprint,id,context,signal)=>{calls.push('node');assert.equal(actor.userId,'trusted');assert.equal(id,'target');assert.equal(context.previous,'edited');assert.equal(context.outputs.upstream,'edited upstream');assert.equal(context.variables?.n,'2');assert.ok(signal instanceof AbortSignal);return result},
  run:async(actor,_blueprint,_input,_through,_signal,_deps,variables)=>{calls.push('full');assert.equal(actor.userId,'trusted');assert.equal(variables?.n,'2');return result},
 }))
 app.use((error:{status?:number},_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(error.status??400).json({message:'invalid'}))
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve))
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`
 const post=(path:string,body:unknown)=>fetch(`${base}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 const request={blueprint:{draft:true},moduleId:'target',context:{input:'raw',previous:'edited',outputs:{upstream:'edited upstream'},variables:{n:'2'}}}
 try{
  assert.equal((await post('/run-node',request)).status,200)
  assert.equal((await post('/run-node',{...request,userId:'forged'})).status,400)
  assert.equal((await post('/run-node',{...request,context:{...request.context,previous:'x'.repeat(120001)}})).status,400)
  assert.equal((await post('/run-node',{...request,context:{...request.context,outputs:Object.fromEntries(Array.from({length:13},(_,index)=>[`n${index}`,'']))}})).status,400)
  assert.equal((await post('/run-node',{...request,context:{...request.context,variables:{n:2}}})).status,400)
  assert.equal((await post('/run',{blueprint:{},input:'',variables:{n:'2'}})).status,200)
  assert.deepEqual(calls,['node','full'])
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
})
