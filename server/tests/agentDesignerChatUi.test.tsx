import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { tsImport } from 'tsx/esm/api'
register('data:text/javascript,' + encodeURIComponent(`export async function load(url, context, nextLoad) { return url.includes('.css') ? { format:'module',source:'',shortCircuit:true } : nextLoad(url,context) }`), import.meta.url)
const options = { parentURL: import.meta.url, tsconfig: new URL('../../tsconfig.app.json', import.meta.url).pathname }
const { AgentDesignerChat, AgentDesignerReplyCard, AgentDesignerSubmitAction, appendAgentDesignerMessage, agentDesignerHistoryMessage } = await tsImport('../../src/components/AgentDesignerChat.tsx', options)
const blueprint={schemaVersion:1,name:'草稿',description:'',modules:[]}
const reply={phase:'clarify',message:'先明确交付形式',question:{question:'面向谁使用？',recommendedAnswer:'投资团队',options:['投资团队','创业者']},brief:{goal:'分析项目',audience:'待确认',input:'BP',output:'待确认',constraints:['保留来源'],successCriteria:['可核验']},nodePlan:[{name:'材料分析',kind:'llm',reason:'识别事实和缺失',input:'BP',output:'项目摘要'}],skillUsed:'grill-me'}
test('manual designer chat is a persistent labelled sidebar with model, composer and explicit assumptions action',()=>{
 const html=renderToStaticMarkup(<AgentDesignerChat models={[{id:'m1',name:'测试模型',modelKey:'test'}]} currentBlueprint={blueprint} onProposal={()=>{}} />)
 for(const label of ['AI 搭建对话','对话模型','描述任务或回答问题','发送','按当前理解生成','清空对话','grill-me','目标','输入','输出']) assert.ok(html.includes(label),label)
 assert.ok(!html.includes('localStorage'))
})
test('clarification renders one focused question, recommendation, summary and node reasons with escaped text',()=>{
 const html=renderToStaticMarkup(<AgentDesignerReplyCard reply={{...reply,message:'<script>bad()</script>'}} onAnswer={()=>{}} onProposal={()=>{}} />)
 for(const label of ['面向谁使用','投资团队','推荐答案','需求理解','适配节点','识别事实和缺失','grill-me']) assert.ok(html.includes(label),label)
 assert.ok(html.includes('&lt;script&gt;'))
 assert.ok(!html.includes('<script>'))
 assert.ok(!html.includes('预览模块方案'))
})
test('ready reply only offers explicit preview and does not imply automatic replacement',()=>{
 const html=renderToStaticMarkup(<AgentDesignerReplyCard reply={{...reply,phase:'ready',question:undefined,blueprint,skillUsed:null}} onAnswer={()=>{}} onProposal={()=>{}} />)
 assert.ok(html.includes('预览模块方案'))
 assert.ok(html.includes('采用前不会修改画布'))
})
test('chat history validates text, does not mutate existing messages and caps at 24 without silent truncation',()=>{
 const messages=[{role:'user',content:'原始需求'}]
 assert.deepEqual(appendAgentDesignerMessage(messages,'assistant','澄清问题'),[...messages,{role:'assistant',content:'澄清问题'}])
 assert.equal(messages.length,1)
 assert.throws(()=>appendAgentDesignerMessage(messages,'user','  '),/输入/)
 assert.throws(()=>appendAgentDesignerMessage(messages,'user','a'.repeat(8001)),/8000/)
 assert.throws(()=>appendAgentDesignerMessage(Array.from({length:24},()=>({role:'user',content:'需求'})),'user','下一条'),/24/)
})
test('next-turn assistant history retains question, recommended answer and confirmed understanding',()=>{
 const history=JSON.parse(agentDesignerHistoryMessage({...reply,blueprint:{...blueprint,description:'x'.repeat(20000)}}))
 assert.deepEqual(history.question,reply.question)
 assert.deepEqual(history.brief,reply.brief)
 assert.deepEqual(history.nodePlan,reply.nodePlan)
 assert.equal(history.blueprint,undefined)
 assert.equal(history.question.recommendedAnswer,'投资团队')
})
test('message limit blocks further quick answers but retains an explicit ready-plan preview',()=>{
 const html=renderToStaticMarkup(<AgentDesignerReplyCard reply={{...reply,phase:'ready',blueprint,skillUsed:null}} answersDisabled onAnswer={()=>{}} onProposal={()=>{}} />)
 assert.match(html,/<button type="button"[^>]*disabled[^>]*>推荐答案/)
 assert.match(html,/<button type="button"><svg[^]*?预览模块方案<\/button>/)
})
test('oversized structured history stays valid JSON and preserves the active question and brief core',()=>{
 const giant='资料约束'.repeat(1000)
 const huge={...reply,message:giant,brief:{goal:'确定项目分析目标',audience:'投资团队',input:'BP 和会议纪要',output:'Markdown 分析',constraints:Array(16).fill(giant),successCriteria:Array(16).fill(giant)},nodePlan:Array(12).fill({name:giant,kind:'llm',reason:giant,input:giant,output:giant})}
 const text=agentDesignerHistoryMessage(huge)
 const history=JSON.parse(text)
 assert.ok(text.length<=12000)
 assert.equal(history.truncated,true)
 assert.deepEqual(history.question,reply.question)
 for(const key of ['goal','audience','input','output']) assert.equal(history.brief[key],huge.brief[key])
 assert.equal(history.nodePlan.length,12)
 const escaped=JSON.parse(agentDesignerHistoryMessage({...huge,message:'\u0000"\\'.repeat(4000),question:{question:'\u0000"\\'.repeat(4000),recommendedAnswer:'\u0000"\\'.repeat(4000),options:Array(5).fill('\u0000"\\'.repeat(4000))}}))
 assert.ok(JSON.stringify(escaped).length<=12000)
 assert.ok(escaped.question.question.endsWith('…'))
})
test('history enforces the 60000 character boundary before a request without truncating old decisions',()=>{
 const messages=Array.from({length:5},()=>({role:'assistant',content:'a'.repeat(12000)}))
 assert.throws(()=>appendAgentDesignerMessage(messages,'user','新需求'),/60000.*预览.*清空/)
 const almost=messages.map((message,index)=>index===0?{...message,content:message.content.slice(1)}:message)
 assert.equal(appendAgentDesignerMessage(almost,'user','好').reduce((total,message)=>total+message.content.length,0),60000)
 assert.equal(messages[0].content.length,12000)
})
test('cancel prevents form default before resetting state and uses a different button identity from submit',()=>{
 const order:string[]=[]
 const cancel=AgentDesignerSubmitAction({busy:true,disabled:true,onCancel:()=>order.push('cancel')})
 const submit=AgentDesignerSubmitAction({busy:false,disabled:false,onCancel:()=>{}})
 assert.equal(cancel.props.type,'button')
 assert.equal(submit.props.type,'submit')
 assert.notEqual(cancel.key,submit.key)
 cancel.props.onClick({preventDefault:()=>order.push('preventDefault')})
 assert.deepEqual(order,['preventDefault','cancel'])
 assert.match(renderToStaticMarkup(cancel),/type="button"/)
 assert.match(renderToStaticMarkup(submit),/type="submit"/)
})
