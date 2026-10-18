import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { tsImport } from 'tsx/esm/api'
register('data:text/javascript,' + encodeURIComponent(`export async function load(url, context, nextLoad) { return url.includes('.css') ? { format:'module',source:'',shortCircuit:true } : nextLoad(url,context) }`), import.meta.url)
const options = { parentURL: import.meta.url, tsconfig: new URL('../../tsconfig.app.json', import.meta.url).pathname }
const { AgentInputEditor, validateManualInputFields } = await tsImport('../../src/components/AgentInputEditor.tsx', options)
const { AgentNodeEditor } = await tsImport('../../src/components/AgentNodeEditor.tsx', options)
const { parseNodeDebugOutputs, AgentNodeDebug } = await tsImport('../../src/components/AgentNodeDebug.tsx', options)
const base = { id:'n1',name:'节点',modelId:'m1',prompt:'处理',inputTemplate:'{{input}}',skillIds:[],outputFormat:'text',outputInstructions:'' }
const catalog = {models:[{id:'m1',name:'模型',modelKey:'model'}],skills:[]}
test('start editor exposes typed input declarations and rejects ambiguous names/defaults',()=>{
  const html=renderToStaticMarkup(<AgentInputEditor fields={[{name:'topic',label:'研究主题',type:'text',required:true,defaultValue:''}]} onChange={()=>{}} />)
  for(const label of ['开始节点','字段名称','显示名称','字段类型','默认值','必填','添加输入字段']) assert.ok(html.includes(label),label)
  assert.equal(validateManualInputFields([{name:'topic',label:'主题',type:'text',required:true,defaultValue:''}]),'')
  assert.match(validateManualInputFields([{name:'same',label:'一',type:'text',required:false,defaultValue:''},{name:'same',label:'二',type:'text',required:false,defaultValue:''}]),/重复/)
  assert.match(validateManualInputFields([{name:'n',label:'数字',type:'number',required:false,defaultValue:'abc'}]),/数字/)
  assert.match(validateManualInputFields([{name:'s',label:'选择',type:'select',required:false,defaultValue:'absent',options:['a']}]),/选项/)
  assert.match(validateManualInputFields([{name:'constructor',label:'保留名',type:'text',required:false}]),/保留/)
  assert.match(validateManualInputFields([{name:'s',label:'选择',type:'select',required:false,options:['a','a']}]),/重复/)
})
test('node editor renders independent configuration for each executable kind',()=>{
  for(const [kind,label] of [['llm','模型参数'],['condition','全部满足'],['template','模板内容'],['json-extract','JSON 字段路径'],['aggregate','聚合来源'],['text-process','文本操作'],['output','输出内容']] as const){
    const html=renderToStaticMarkup(<AgentNodeEditor module={{...base,kind}} catalog={catalog} sources={[]} inputFields={[]} onChange={()=>{}} />)
    assert.ok(html.includes(label),`${kind}: ${label}`)
    if(kind==='json-extract') assert.ok(html.includes('返回空值（JSON 为 null）'))
    if(kind!=='llm') assert.ok(!html.includes('目标与提示词') && !html.includes('使用模型'),`${kind} must not expose LLM configuration`)
  }
})
test('node debugging accepts only string-valued ancestor output objects',()=>{
  assert.deepEqual(parseNodeDebugOutputs('{"first":"实际上游内容"}',new Set(['first'])),{first:'实际上游内容'})
  assert.throws(()=>parseNodeDebugOutputs('{"foreign":"secret"}',new Set(['first'])),/祖先/)
  assert.throws(()=>parseNodeDebugOutputs('{"first":123}',new Set(['first'])),/字符串/)
  assert.throws(()=>parseNodeDebugOutputs('[]',new Set()),/对象/)
  assert.throws(()=>parseNodeDebugOutputs('{',new Set()),/有效 JSON/)
  assert.throws(()=>parseNodeDebugOutputs(JSON.stringify({first:'x'.repeat(30001)}),new Set(['first'])),/30000/)
})
test('node debug reports actual condition outcome, retry attempts and fallback instead of implying ordinary success',()=>{
  const run={id:'run',status:'succeeded',durationMs:42,output:'fallback',steps:[{moduleId:'n1',name:'节点',modelId:'',status:'succeeded',input:'sample',output:'fallback',durationMs:42,attempts:3,fallback:true,conditionMatched:false}]}
  const html=renderToStaticMarkup(<AgentNodeDebug module={{...base,kind:'condition'}} sources={[]} input="测试" onInputChange={()=>{}} variables={{}} onVariablesChange={()=>{}} run={run} disabled={false} onRun={()=>{}} />)
  for(const label of ['使用默认输出','尝试 3 次','条件不满足（假）','0.04 秒']) assert.ok(html.includes(label),label)
})
