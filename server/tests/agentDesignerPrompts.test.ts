import assert from 'node:assert/strict'
import test from 'node:test'
import { agentGenerationInstructions, getAgentDesignerInterviewInstructions } from '../src/services/agentDesignerPrompts.js'
test('designer embeds intent discovery and conditionally applies pinned grill-me instructions', async () => {
 const prompt=await getAgentDesignerInterviewInstructions()
 for(const word of ['grill-me','grilling','目的','受众','输入','输出','验收','一个','推荐','不执行','clarify','ready'])assert.ok(prompt.includes(word),word)
 assert.ok(prompt.includes('design tree'))
 assert.ok(prompt.includes('49dd158d1076134a641b33efb035946536778336'))
})
test('generation chooses supported deterministic nodes and binds authorized model/skills',()=>{
 const prompt=agentGenerationInstructions('model-allowed',[{id:'skill-allowed',name:'核查方法',description:'核查'}])
 for(const kind of ['llm','template','json-extract','aggregate','text-process','condition','output'])assert.ok(prompt.includes(kind),kind)
 for(const word of ['model-allowed','skill-allowed','核查方法','schemaVersion','inputFields','graph','{{previous}}','不得','祖先'])assert.ok(prompt.includes(word),word)
 assert.ok(!prompt.includes('apiKey'))
})
