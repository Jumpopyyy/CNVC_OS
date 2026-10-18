import { useEffect, useRef, useState } from 'react'
import { apiGet, apiPost, apiPut } from '../../lib/api'
import { Button, Modal } from '../ui'
import { LibraryPicker } from './LibraryPicker'
import { libraryKey, type LibraryBinding, type LibrarySelection, type LibraryItem } from '../../../server/src/contracts/dueDiligenceLibrary'

export function TwinLibraryBindings({ twinId, onSaved, onLearned }: { twinId: string; onSaved: (version: number) => void; onLearned: () => Promise<void> }) {
  const [open, setOpen] = useState(false), [bindings, setBindings] = useState<LibraryBinding[]>([]), [version, setVersion] = useState(0), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const alive = useRef(true)
  const [catalog, setCatalog] = useState<LibraryItem[]>([])
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (!open) return
    let active = true; setError(''); setVersion(0)
    void apiGet<{ version: number; bindings: LibraryBinding[] }>(`/due-diligence/twins/${twinId}/library-bindings`).then(result => { if (active) { setBindings(result.bindings); setVersion(result.version) } }).catch(cause => { if (active) setError((cause as Error).message) })
    return () => { active = false }
  }, [open, twinId])
  const selection: LibrarySelection = { skills: bindings.filter(item => ['prompt-skill', 'capability-skill'].includes(item.source)), agent: bindings.find(item => ['workflow', 'prompt-agent'].includes(item.source)) || null }
  const update = (next: LibrarySelection) => setBindings([...next.skills, ...(next.agent ? [next.agent] : [])].map(ref => ({ ...ref, enabled: bindings.find(item => libraryKey(item) === libraryKey(ref))?.enabled ?? true, tasks: bindings.find(item => libraryKey(item) === libraryKey(ref))?.tasks || ['checklist', 'conversation', 'builder'] })))
  async function run(key: string, action: () => Promise<void>) { if (busy) return; setBusy(key); setError(''); setNotice(''); try { await action() } catch (cause) { if (alive.current) setError((cause as Error).message) } finally { if (alive.current) setBusy('') } }
  return <div className="mt-3"><Button size="sm" variant="secondary" onClick={() => setOpen(true)}>管理辅助 Skill 与智能体</Button>
    <Modal open={open} title="当前分身的辅助能力" onClose={() => !busy && setOpen(false)} footer={<Button disabled={Boolean(busy) || !version} onClick={() => void run('save', async () => { const result = await apiPut<{ version: number }>(`/due-diligence/twins/${twinId}/library-bindings`, { expectedVersion: version, bindings }); if (!alive.current) return; setVersion(result.version); onSaved(result.version); setNotice('能力设置已保存；不会修改判断偏好或自动公开。') })}>{busy === 'save' ? '保存中…' : '保存能力设置'}</Button>}>
      <div className="space-y-4"><LibraryPicker remember={false} task="conversation" value={selection} onChange={update} disabled={Boolean(busy) || !version} onCatalog={setCatalog} />
        {bindings.map(binding => <div key={libraryKey(binding)} className="space-y-2 rounded-lg border p-3 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={binding.enabled} disabled={Boolean(busy)} onChange={event => setBindings(items => items.map(item => libraryKey(item) === libraryKey(binding) ? { ...item, enabled: event.target.checked } : item))} />{catalog.find(item => libraryKey(item) === libraryKey(binding))?.name || '不可用能力'} · v{binding.version}</label><div className="flex flex-wrap gap-3">{(['checklist', 'conversation', 'builder'] as const).map((task, index) => <label key={task} className="flex items-center gap-1"><input disabled={Boolean(busy)} type="checkbox" checked={binding.tasks.includes(task)} onChange={event => setBindings(items => items.map(item => libraryKey(item) === libraryKey(binding) ? { ...item, tasks: event.target.checked ? [...item.tasks, task] : item.tasks.length > 1 ? item.tasks.filter(value => value !== task) : item.tasks } : item))} />{['生成清单', '分身对话', '分身构建'][index]}</label>)}</div><Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void run(libraryKey(binding), async () => { await apiPost(`/due-diligence/twins/${twinId}/library-learn`, binding); await onLearned(); if (alive.current) setNotice('已加入待学习，请在 Skill 库核对并确认后生效。') })}>提炼为个人 Skill 建议</Button></div>)}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{notice && <p role="status" className="text-sm text-brand-700">{notice}</p>}
      </div>
    </Modal>
  </div>
}
