import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { useAuthStore } from '../../store/useAuthStore'
import { libraryKey, type LibraryItem, type LibrarySelection, type LibraryTask } from '../../../server/src/contracts/dueDiligenceLibrary'

export function LibraryPicker({ value, onChange, projectId, task, disabled = false, remember = true, onCatalog }: { value: LibrarySelection; onChange: (value: LibrarySelection) => void; projectId?: string; task: LibraryTask; disabled?: boolean; remember?: boolean; onCatalog?: (items: LibraryItem[]) => void }) {
  const userId = useAuthStore(state => state.user?.id)
  const [items, setItems] = useState<LibraryItem[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [warnings, setWarnings] = useState<string[]>([]), [retry, setRetry] = useState(0), [search, setSearch] = useState('')
  const initialized = useRef(''), current = useRef(value); current.current = value
  const changed = useRef(onChange); changed.current = onChange
  const preferenceKey = userId ? `cnvc:dd:library:${userId}:${task}` : ''
  useEffect(() => {
    let active = true; const controller = new AbortController(); setLoading(true); setError('')
    void api<{ list: LibraryItem[]; warnings: string[] }>(`/due-diligence/library${projectId ? `?projectId=${projectId}` : ''}`, { signal: controller.signal }).then(result => {
      if (!active) return
      setItems(result.list); setWarnings(result.warnings); onCatalog?.(result.list)
      if (remember && preferenceKey && initialized.current !== preferenceKey && !current.current.agent && !current.current.skills.length) {
        initialized.current = preferenceKey
        try {
          const keys = JSON.parse(localStorage.getItem(preferenceKey) || 'null') as { agent?: string; skills?: string[] } | null
          const skills = result.list.filter(item => item.kind === 'skill' && keys?.skills?.includes(libraryKey(item))).slice(0, 4)
          const agent = result.list.find(item => item.kind === 'agent' && libraryKey(item) === keys?.agent) || null
          // Only restore a preference at its exact prior version; never silently upgrade.
          const old = JSON.parse(localStorage.getItem(`${preferenceKey}:versions`) || '{}') as Record<string, string>
          const valid = (item: LibraryItem) => old[libraryKey(item)] === item.hash
          changed.current({ skills: skills.filter(valid), agent: agent && valid(agent) ? agent : null })
        } catch { /* Optional preferences must not block the form. */ }
      }
    }).catch(cause => { if (active && !controller.signal.aborted) setError(`公共能力读取失败：${(cause as Error).message}`) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [projectId, preferenceKey, retry, remember])
  function select(next: LibrarySelection) {
    onChange(next)
    if (remember && preferenceKey) try {
      localStorage.setItem(preferenceKey, JSON.stringify({ skills: next.skills.map(libraryKey), agent: next.agent ? libraryKey(next.agent) : null }))
      localStorage.setItem(`${preferenceKey}:versions`, JSON.stringify(Object.fromEntries([...next.skills, ...(next.agent ? [next.agent] : [])].map(item => [libraryKey(item), item.hash]))))
    } catch { /* Storage is optional. */ }
  }
  const selected = [...value.skills, ...(value.agent ? [value.agent] : [])]
  return <fieldset disabled={disabled || loading} className="min-w-0 space-y-3" aria-label="选择平台方法与智能体">
    {loading && <p role="status" className="text-sm text-slate-500">正在读取可用方法与智能体…</p>}
    {!loading && !error && <div className="flex justify-end"><button type="button" className="text-xs text-brand-700 underline" onClick={() => setRetry(n => n + 1)}>刷新能力</button></div>}
    {error && <p role="alert" className="text-sm text-amber-800">{error}<button type="button" className="ml-2 underline" onClick={() => setRetry(n => n + 1)}>重试</button></p>}
    {warnings.length > 0 && <p role="status" className="text-xs text-amber-800">{warnings.join('；')}</p>}
    <label className="block"><span className="label">执行智能体（可不选）</span><select className="input" value={value.agent ? libraryKey(value.agent) : ''} onChange={event => select({ ...value, agent: items.find(item => libraryKey(item) === event.target.value) || null })}><option value="">使用平台默认流程</option>{items.filter(item => item.kind === 'agent').map(item => <option key={libraryKey(item)} value={libraryKey(item)}>{item.name} · {item.execution === 'workflow' ? '工作流' : '提示词'} v{item.version}</option>)}</select></label>
    <label className="block"><span className="label">使用 Skill（最多 4 项，可不选）</span><input className="input" type="search" aria-label="搜索可用 Skill" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索方法名称…" /></label>
    <div className="flex max-h-36 flex-wrap gap-2 overflow-auto">{items.filter(item => item.kind === 'skill' && `${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase())).map(item => {
      const chosen = value.skills.some(ref => libraryKey(ref) === libraryKey(item))
      return <button type="button" aria-pressed={chosen} title={item.description} disabled={!chosen && value.skills.length >= 4} key={libraryKey(item)} className={`min-h-9 rounded-lg border px-3 py-1 text-left text-sm disabled:opacity-40 ${chosen ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200'}`} onClick={() => select({ ...value, skills: chosen ? value.skills.filter(ref => libraryKey(ref) !== libraryKey(item)) : [...value.skills, item] })}>{item.name} · v{item.version}{chosen ? ' ✓' : ''}</button>
    })}</div>
    {selected.map(ref => { const latest = items.find(item => libraryKey(item) === libraryKey(ref)); return !loading && (!latest || latest.hash !== ref.hash) ? <p key={libraryKey(ref)} className="text-xs text-amber-800">{latest?.name || '已选能力'}已更新或不可用。{latest ? <button className="ml-1 underline" type="button" onClick={() => select({ skills: value.skills.map(item => libraryKey(item) === libraryKey(ref) ? latest : item), agent: value.agent && libraryKey(value.agent) === libraryKey(ref) ? latest : value.agent })}>确认使用 v{latest.version}</button> : <button className="ml-1 underline" type="button" onClick={() => select({ skills: value.skills.filter(item => libraryKey(item) !== libraryKey(ref)), agent: value.agent && libraryKey(value.agent) === libraryKey(ref) ? null : value.agent })}>移除</button>}</p> : null })}
    {!loading && !error && !items.length && <p className="text-sm text-slate-500">暂无可用公共能力，仍可使用默认尽调流程。</p>}
  </fieldset>
}
