import React, { useEffect, useState } from 'react'
import { Play } from 'lucide-react'
import { Button } from './ui'
import type { AgentBlueprint, AgentBlueprintModule, AgentBlueprintRun } from '../../server/src/contracts/agentBlueprintContract'
import { AgentRunInputs } from './AgentInputEditor'

export function parseNodeDebugOutputs(text: string, ancestors: Set<string>): Record<string, string> {
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('祖先输出不是有效 JSON，请填写节点 ID 到字符串的对象') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('祖先输出必须是 JSON 对象')
  for (const [id, output] of Object.entries(value)) {
    if (!ancestors.has(id)) throw new Error(`节点 ${id} 不是当前节点的祖先，不能作为调试来源`)
    if (typeof output !== 'string') throw new Error(`节点 ${id} 的输出必须是字符串`)
    if (output.length > 30000) throw new Error(`节点 ${id} 的调试输出超过 30000 字符`)
  }
  return value as Record<string, string>
}

export type AgentNodeDebugContext = { input: string; previous: string; outputs: Record<string, string>; variables?: Record<string, string> }
export function AgentNodeDebug({ module, sources, directSourceIds, input, onInputChange, inputFields, variables, onVariablesChange, run, disabled, onRun }: { module: AgentBlueprintModule; sources: AgentBlueprintModule[]; directSourceIds?: string[]; input: string; onInputChange: (input: string) => void; inputFields?: AgentBlueprint['inputFields']; variables: Record<string, string>; onVariablesChange: (variables: Record<string, string>) => void; run: AgentBlueprintRun | null; disabled: boolean; onRun: (context: AgentNodeDebugContext) => void }) {
  const [previous, setPrevious] = useState('')
  const [outputs, setOutputs] = useState('{}')
  const [error, setError] = useState('')
  const sourceIds = sources.map(source => source.id).join(',')
  useEffect(() => { setPrevious(''); setOutputs(JSON.stringify(Object.fromEntries(sources.map(source => [source.id, ''])), null, 2)); setError('') }, [module.id, sourceIds])
  function testNode() {
    try { const parsed = parseNodeDebugOutputs(outputs, new Set(sources.map(source => source.id))); setError(''); onRun({ input, previous, outputs: parsed, variables }) } catch (cause) { setError(cause instanceof Error ? cause.message : '调试变量有误') }
  }
  function useRunOutputs() {
    if (!run) return
    const prior = run.steps.filter(step => sources.some(source => source.id === step.moduleId) && step.status === 'succeeded')
    setOutputs(JSON.stringify(Object.fromEntries(sources.map(source => [source.id, prior.find(step => step.moduleId === source.id)?.output ?? ''])), null, 2))
    setPrevious(directSourceIds ? sources.filter(source => directSourceIds.includes(source.id)).flatMap(source => { const step = prior.find(item => item.moduleId === source.id); return step ? [step.output] : [] }).join('\n\n') || (directSourceIds.includes('start') ? input : '') : prior.at(-1)?.output ?? '')
  }
  const result = run?.steps.find(step => step.moduleId === module.id)
  return <section className="ab-node-debug" aria-label="单节点调试"><div className="ab-section-title"><h3>单节点调试 · {module.name}</h3><span>仅执行当前节点</span></div><p className="ab-help">编辑原始输入、开始字段及上游输出，独立测试当前节点；不会执行祖先节点。</p><label className="ab-field"><span>本节点原始输入</span><textarea rows={3} value={input} maxLength={30000} onChange={event => onInputChange(event.target.value)} placeholder="本次调试的用户输入" /></label><AgentRunInputs fields={inputFields} values={variables} onChange={onVariablesChange} /><label className="ab-field"><span>直接父节点输出（previous）</span><textarea rows={3} value={previous} maxLength={30000} onChange={event => setPrevious(event.target.value)} placeholder="手动粘贴上一节点的实际输出" /></label>{sources.length > 0 && <label className="ab-field"><span>祖先输出变量（JSON 对象）</span><textarea className="ab-code" rows={5} value={outputs} maxLength={360000} onChange={event => setOutputs(event.target.value)} /><small className="ab-help">{sources.map(source => `${source.id} = ${source.name}`).join('；')}。值必须是字符串；JSON 对象可先转为字符串。</small></label>}<div className="ab-actions"><Button variant="secondary" disabled={disabled || !run} onClick={useRunOutputs}>填入最近运行输出</Button><Button disabled={disabled} onClick={testNode}><Play size={15} />仅测试当前节点</Button></div>{error && <p role="alert" className="ab-error">{error}</p>}{result && <div className="ab-node-result"><strong>当前节点最近结果 · {result.status === 'succeeded' ? result.fallback ? '使用默认输出' : '完成' : result.status === 'failed' ? '失败' : '跳过'}</strong><p className="ab-help">{(result.durationMs / 1000).toFixed(2)} 秒 · 尝试 {result.attempts ?? (result.status === 'skipped' ? 0 : 1)} 次{result.fallback ? ' · 原执行失败，已使用默认输出' : ''}{result.conditionMatched !== undefined ? result.conditionMatched ? ' · 条件满足（真）' : ' · 条件不满足（假）' : ''}</p>{result.error && <p className="ab-error" role="alert">{result.error}</p>}<h4>实际输入</h4><pre>{result.input || '（空）'}</pre><h4>节点输出</h4><pre>{result.output || '（空）'}</pre></div>}</section>
}
