import React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from './ui'
import { safeAgentInputName } from '../../server/src/contracts/agentBlueprintManual'
import type { AgentBlueprint } from '../../server/src/contracts/agentBlueprintContract'

type InputField = NonNullable<AgentBlueprint['inputFields']>[number]
export function validateManualInputFields(fields: InputField[] = []) {
  const names = new Set<string>()
  for (const field of fields) {
    if (!safeAgentInputName(field.name)) return '输入字段名称须以英文字母开头，只包含字母、数字和下划线，最多 48 字符；不能使用 input、previous 等保留名称'
    if (names.has(field.name)) return `输入字段名称重复：${field.name}`
    names.add(field.name)
    if (!field.label.trim()) return `请填写字段 ${field.name} 的显示名称`
    const value = field.defaultValue ?? ''
    if (field.type === 'number' && value && !Number.isFinite(Number(value))) return `字段 ${field.name} 的默认值必须是数字`
    if (field.type === 'boolean' && value && !['true', 'false'].includes(value)) return `字段 ${field.name} 的默认值须为 true 或 false`
    if (field.type === 'select') {
      if (!field.options?.length || field.options.length > 30 || new Set(field.options).size !== field.options.length || field.options.some(option => !option.trim() || option.length > 1000)) return `字段 ${field.name} 需要不重复的非空选项（最多 30 项，每项最多 1000 字符）`
      if (value && !field.options.includes(value)) return `字段 ${field.name} 的默认值须属于选项`
    }
  }
  return ''
}

export function AgentInputEditor({ fields = [], onChange }: { fields?: InputField[]; onChange: (fields: InputField[]) => void }) {
  const patch = (index: number, changes: Partial<InputField>) => onChange(fields.map((field, position) => position === index ? { ...field, ...changes } : field))
  return <div className="ab-input-editor"><div className="ab-section-title"><h3>开始节点 · 输入字段</h3><span>{fields.length} / 8</span></div><p className="ab-help">定义运行 Agent 时由使用者填写的内容。后续节点可使用 {'{{inputs.字段名称}}'}；原始输入仍可通过 {'{{input}}'} 使用。</p>
    {fields.map((field, index) => <fieldset className="ab-input-card" key={index}><legend>输入字段 {index + 1}</legend><div className="ab-two-columns"><label className="ab-field"><span>字段名称</span><input value={field.name} maxLength={48} placeholder="topic" onChange={event => patch(index, { name: event.target.value })} /></label><label className="ab-field"><span>显示名称</span><input value={field.label} maxLength={100} placeholder="研究主题" onChange={event => patch(index, { label: event.target.value })} /></label></div>
      <div className="ab-two-columns"><label className="ab-field"><span>字段类型</span><select value={field.type} onChange={event => patch(index, { type: event.target.value as InputField['type'], defaultValue: '', ...(event.target.value === 'select' ? { options: ['选项一', '选项二'] } : { options: undefined }) })}><option value="text">文本</option><option value="number">数字</option><option value="boolean">是 / 否</option><option value="select">下拉选项</option></select></label><label className="ab-field"><span>默认值</span>{field.type === 'boolean' ? <select value={field.defaultValue ?? ''} onChange={event => patch(index, { defaultValue: event.target.value })}><option value="">无默认值</option><option value="true">是</option><option value="false">否</option></select> : <input value={field.defaultValue ?? ''} type={field.type === 'number' ? 'number' : 'text'} maxLength={4000} onChange={event => patch(index, { defaultValue: event.target.value })} />}</label></div>
      {field.type === 'select' && <label className="ab-field"><span>可选值（每行一个）</span><textarea rows={3} value={(field.options ?? []).join('\n')} maxLength={4000} onChange={event => patch(index, { options: event.target.value.split('\n') })} /></label>}<div className="ab-section-title"><label className="ab-checkbox"><input type="checkbox" checked={field.required} onChange={event => patch(index, { required: event.target.checked })} />必填</label><Button variant="ghost" aria-label={`删除输入字段 ${index + 1}`} onClick={() => onChange(fields.filter((_, position) => position !== index))}><Trash2 size={16} /></Button></div>
    </fieldset>)}
    <Button variant="secondary" disabled={fields.length >= 8} onClick={() => { let suffix = fields.length + 1; while (fields.some(field => field.name === `field_${suffix}`)) suffix += 1; onChange([...fields, { name: `field_${suffix}`, label: '新输入', type: 'text', required: false, defaultValue: '' }]) }}><Plus size={16} />添加输入字段</Button>
  </div>
}

export function AgentRunInputs({ fields = [], values, onChange }: { fields?: InputField[]; values: Record<string, string>; onChange: (values: Record<string, string>) => void }) {
  return <div className="ab-run-inputs">{fields.map(field => { const value = values[field.name] ?? field.defaultValue ?? ''; return <label className="ab-field" key={field.name}><span>{field.label || field.name}{field.required ? ' *' : ''}</span>{field.type === 'select' || field.type === 'boolean' ? <select value={value} required={field.required} onChange={event => onChange({ ...values, [field.name]: event.target.value })}><option value="">请选择</option>{field.type === 'boolean' ? <><option value="true">是</option><option value="false">否</option></> : field.options?.map(option => <option key={option} value={option}>{option}</option>)}</select> : <input type={field.type === 'number' ? 'number' : 'text'} value={value} required={field.required} maxLength={30000} onChange={event => onChange({ ...values, [field.name]: event.target.value })} />}<small className="ab-help">{`{{inputs.${field.name}}}`}</small></label> })}</div>
}
