import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { BriefcaseBusiness, Check, ChevronDown, Compass, Search, SlidersHorizontal, Telescope, X } from 'lucide-react'
import { twinFocusOptions, twinTemplates, twinTemplateGroups, splitTwinFocusRules, type TwinTemplateGroupId } from './twinTemplates'
import { sameStartingFocuses, selectedFocuses, selectionFromFocuses, toggleStartingFocus, toggleStartingPoint, type StartingPointSelection } from './twinStartingPointSelection'

import { Button, Modal } from '../ui'

const groupStyle = {
  investment: { icon: BriefcaseBusiness, badge: 'bg-slate-100 text-slate-600', selected: 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' },
  research: { icon: Telescope, badge: 'bg-slate-100 text-slate-600', selected: 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' },
  office: { icon: Compass, badge: 'bg-slate-100 text-slate-600', selected: 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' },
}

export function TwinStartingPointPicker({ rules, disabled, onChange, selected, onSelectionChange }: { rules: string; disabled?: boolean; onChange: (ids: string[]) => void; selected?: StartingPointSelection; onSelectionChange?: (selection: StartingPointSelection) => void }) {
  const searchId = useId()
  const { focusIds } = splitTwinFocusRules(rules)
  const [localSelection, setLocalSelection] = useState(() => selectionFromFocuses(focusIds))
  const selection = selected || localSelection
  const active = twinTemplates.filter(item => selection.templateIds.includes(item.id))
  const [group, setGroup] = useState<TwinTemplateGroupId | 'all'>(active[0]?.group || 'investment')
  const [query, setQuery] = useState('')
  const needle = query.trim().toLocaleLowerCase()
  const visible = twinTemplates.filter(template => (group === 'all' || template.group === group) && (!needle || [template.name, template.description, ...twinFocusOptions.filter(option => (template.focusIds as readonly string[]).includes(option.id)).map(option => option.label)].join(' ').toLocaleLowerCase().includes(needle)))
  const selectedOptions = twinFocusOptions.filter(option => focusIds.includes(option.id))
  const categories = [...new Set(twinFocusOptions.map(option => option.category))]
  useEffect(() => { if (!selected && !sameStartingFocuses(focusIds, selectedFocuses(localSelection))) setLocalSelection(selectionFromFocuses(focusIds)) }, [rules, selected])
  const update = (next: StartingPointSelection) => { if (onSelectionChange) onSelectionChange(next); else setLocalSelection(next); onChange(selectedFocuses(next)) }
  const toggle = (id: string) => update(toggleStartingFocus(selection, id))

  return <section aria-label="选择专业起点" className="twin-starting-picker">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <p className="text-sm leading-relaxed text-slate-600">可选择多个场景，关注点会合并去重；再次点击可取消。保存的是关注点，完全重叠的其他起点会标为“已涵盖”。系统会推荐匹配的 Skill 与智能体，点击“生成分身初稿”才会调用。</p>
      <div className="w-full sm:w-60"><label className="sr-only" htmlFor={searchId}>搜索全部专业起点</label><div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" aria-hidden="true" /><input id={searchId} type="search" value={query} onChange={event => { setQuery(event.target.value); setGroup('all') }} placeholder="搜索场景或关注点" className="input !pl-9" /></div></div>
    </div>
    <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="起点场景分类">
      {[{ id: 'all' as const, name: '全部' }, ...twinTemplateGroups].map(item => <button type="button" key={item.id} aria-pressed={group === item.id} onClick={() => setGroup(item.id)} className={`min-h-10 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${group === item.id ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`}>{item.name}<span className="ml-2 text-xs">{item.id === 'all' ? twinTemplates.length : twinTemplates.filter(template => template.group === item.id).length}</span></button>)}
    </div>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {visible.map(template => {
        const tone = groupStyle[template.group], Icon = tone.icon, isActive = selection.templateIds.includes(template.id)
        const covered = !isActive && template.focusIds.every(id => focusIds.includes(id))
        return <button type="button" key={template.id} disabled={disabled} aria-pressed={isActive} onClick={() => update(toggleStartingPoint(selection, template.id))} className={`min-w-0 rounded-xl border p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50 ${isActive ? tone.selected : covered ? 'border-blue-200 bg-blue-50/40 hover:border-blue-400' : 'border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50'}`}>
          <span className="flex items-center justify-between gap-2"><span className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${tone.badge}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{twinTemplateGroups.find(item => item.id === template.group)?.name}</span>{(isActive || covered) && <span className="flex items-center gap-1 text-xs font-semibold text-slate-800"><Check className="h-4 w-4" aria-hidden="true" />{isActive ? '已应用' : '已涵盖'}</span>}</span>
          <strong className="mt-3 block text-sm text-slate-900">{template.name}</strong><span className="mt-1.5 block text-sm leading-relaxed text-slate-600">{template.description}</span>
        </button>
      })}
    </div>
    {!visible.length && <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">未找到匹配的起点。<button type="button" className="ml-2 min-h-10 rounded px-2 text-brand-700 underline focus-visible:outline" onClick={() => { setQuery(''); setGroup('all') }}>查看全部</button></div>}
    <div className="mt-4 rounded-xl border border-slate-200 bg-white/90 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-slate-800">{active.length ? `已应用：${active.map(item => item.name).join('、')}` : selectedOptions.length ? '自定义关注组合' : '尚未选择起点'}<span className="ml-2 text-xs font-normal text-slate-600">{selectedOptions.length} 项关注点</span></p><span className="text-xs text-slate-600">只调整模板关注点，保留手写内容</span></div>
      {selectedOptions.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{selectedOptions.map(option => <button type="button" key={option.id} disabled={disabled} aria-label={`移除关注点：${option.label}`} onClick={() => toggle(option.id)} className="flex min-h-9 items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-900 hover:border-blue-500 focus-visible:outline disabled:opacity-50">{option.label}<X className="h-3 w-3" aria-hidden="true" /></button>)}</div>}
      <details className="mt-3 border-t border-slate-100 pt-3"><summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded text-sm font-medium text-slate-700 focus-visible:outline"><SlidersHorizontal className="h-4 w-4" aria-hidden="true" />细化关注点<ChevronDown className="ml-auto h-4 w-4" aria-hidden="true" /></summary><div className="mt-3 space-y-3">{categories.map(category => <fieldset key={category} disabled={disabled}><legend className="mb-2 text-xs font-semibold text-slate-600">{category === '办公' ? '日常办公' : category}</legend><div className="flex flex-wrap gap-2">{twinFocusOptions.filter(option => option.category === category).map(option => <label key={option.id} title={option.rule} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${focusIds.includes(option.id) ? 'border-blue-300 bg-blue-50 text-blue-900' : 'border-slate-200 bg-white text-slate-700'}`}><input type="checkbox" className="accent-blue-600" checked={focusIds.includes(option.id)} onChange={() => toggle(option.id)} />{option.label}</label>)}</div></fieldset>)}</div></details>
    </div>
  </section>
}

export function TwinStartingPoints(props: { rules: string; disabled?: boolean; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDivElement>(null)
  const { focusIds } = splitTwinFocusRules(props.rules)
  const options = twinFocusOptions.filter(option => focusIds.includes(option.id))
  const [selection, setSelection] = useState(() => selectionFromFocuses(focusIds))
  const active = useMemo(() => twinTemplates.filter(item => selection.templateIds.includes(item.id)), [selection])
  useEffect(() => { if (!sameStartingFocuses(focusIds, selectedFocuses(selection))) setSelection(selectionFromFocuses(focusIds)) }, [props.rules])
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
    return () => { previous?.focus() }
  }, [open])
  return <div className="twin-starting-summary">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><span className="text-xs text-slate-600">专业起点</span><p className="mt-1 text-sm font-medium">{active.length ? active.map(item => item.name).join('、') : options.length ? '自定义关注组合' : '尚未选择，可直接对话完善'}</p></div>
      <button ref={trigger} type="button" disabled={props.disabled} onClick={() => setOpen(true)} className="twin-inline-action">{options.length ? '更换起点' : '选择起点'}</button>
    </div>
    {options.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{options.slice(0, 3).map(option => <span key={option.id} className="twin-focus-chip">{option.label}</span>)}{options.length > 3 && <button type="button" disabled={props.disabled} className="twin-text-action text-xs" onClick={() => setOpen(true)}>查看其余 {options.length - 3} 项</button>}</div>}
    {open && <div ref={dialog} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false) }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), summary, [tabindex="0"]') || []).filter(element => element.getClientRects().length)
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}><Modal open title="选择专业起点" width="max-w-3xl" onClose={() => setOpen(false)} footer={<Button onClick={() => setOpen(false)}>完成选择</Button>}>
      <TwinStartingPointPicker {...props} selected={selection} onSelectionChange={setSelection} />
    </Modal></div>}
  </div>
}
