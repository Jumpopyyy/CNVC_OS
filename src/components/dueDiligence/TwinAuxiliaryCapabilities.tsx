import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Check, SlidersHorizontal, Wrench } from 'lucide-react'
import { api, apiPost, apiPut } from '../../lib/api'
import { Button, Modal } from '../ui'
import { LibraryPicker } from './LibraryPicker'
import { LibrarySelectionSchema, libraryKey, librarySelectionForTask, updateLibraryBindingsForTasks, type LibraryBinding, type LibrarySelection, type LibraryItem, type LibraryTask } from '../../../server/src/contracts/dueDiligenceLibrary'
import { mayApplyTwinRecommendation, recommendTwinCapabilities, twinLibrarySelectionIdentity, type TwinCapabilityRecommendation, type TwinCapabilityRequest } from '../../../server/src/contracts/digitalTwinCapabilityRecommendations'

type Props = {
  twinId?: string; expectedVersion?: number; value?: LibrarySelection; disabled?: boolean; preview?: boolean
  recommendationRequest?: TwinCapabilityRequest
  onChange: (selection: LibrarySelection | undefined) => void
  onSaved?: (twinId: string, version: number) => void
  onLearned?: () => Promise<void>
  onReadyChange?: (ready: boolean) => void
  onBusyChange?: (busy: boolean) => void
  onPendingChange?: (editor: string, pending: boolean) => void
}
const selectionIdentity = twinLibrarySelectionIdentity

export function TwinAuxiliaryCapabilities(props: Props) {
  const [open, setOpen] = useState(false), [bindings, setBindings] = useState<LibraryBinding[]>([]), [version, setVersion] = useState(0)
  const [catalog, setCatalog] = useState<LibraryItem[]>([]), [loading, setLoading] = useState(!props.preview), [loadError, setLoadError] = useState(''), [reload, setReload] = useState(0)
  const [editing, setEditing] = useState<LibrarySelection>({ skills: [], agent: null, replaceBindings: true })
  const [initialSelection, setInitialSelection] = useState(''), [saveCommon, setSaveCommon] = useState(false), [tasks, setTasks] = useState<LibraryTask[]>(['builder'])
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [discarding, setDiscarding] = useState(false)
  const [handledRecommendation, setHandledRecommendation] = useState(''), [recommendation, setRecommendation] = useState<TwinCapabilityRecommendation | null>(null)
  const lastAutomatic = useRef<string | undefined>(undefined)
  const suggested = useMemo(() => recommendTwinCapabilities(props.recommendationRequest?.focusIds || [], catalog), [props.recommendationRequest, catalog])
  const alive = useRef(true), lock = useRef(false), section = useRef<HTMLElement>(null), wasOpen = useRef(false)
  const scope = useRef(props.twinId); scope.current = props.twinId
  const effective = librarySelectionForTask(bindings, 'builder', props.value)
  const selected = [...effective.skills, ...(effective.agent ? [effective.agent] : [])]
  const valid = (ref: LibrarySelection['skills'][number]) => catalog.some(item => libraryKey(item) === libraryKey(ref) && item.hash === ref.hash && item.version === ref.version)
  const invalid = !loading && selected.some(ref => !valid(ref))
  const explicitEmpty = Boolean(props.value?.replaceBindings && !selected.length)
  const recommending = Boolean(props.recommendationRequest && props.recommendationRequest.id !== handledRecommendation)
  const ready = !busy && !recommending && !recommendation && (explicitEmpty || !loading && !loadError && !(props.value?.replaceBindings && invalid))
  const dirty = open && (selectionIdentity(editing) !== initialSelection || saveCommon)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (props.preview) return
    const controller = new AbortController(); let active = true
    setLoading(true); setLoadError('')
    void Promise.all([
      api<{ list: LibraryItem[] }>('/due-diligence/library', { signal: controller.signal }),
      props.twinId ? api<{ version: number; bindings: LibraryBinding[] }>(`/due-diligence/twins/${props.twinId}/library-bindings`, { signal: controller.signal }) : Promise.resolve({ version: 0, bindings: [] }),
    ]).then(([items, saved]) => { if (active) { setCatalog(items.list); setBindings(saved.bindings || []); setVersion(saved.version) } })
      .catch(cause => { if (active && !controller.signal.aborted) setLoadError(`辅助能力加载失败：${(cause as Error).message}`) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [props.twinId, props.expectedVersion, props.preview, reload])
  useEffect(() => {
    const request = props.recommendationRequest
    if (!request || request.id === handledRecommendation || loading) return
    setHandledRecommendation(request.id); setRecommendation(null)
    if (loadError || props.preview) return
    if (!request.focusIds.length) {
      if (lastAutomatic.current === selectionIdentity(effective)) props.onChange(undefined)
      lastAutomatic.current = undefined; setNotice('已取消起点推荐，手工选择与常用配置保持不变。'); return
    }
    const next = suggested
    if (!next.selection.skills.length && !next.selection.agent) {
      if (lastAutomatic.current === selectionIdentity(effective)) { props.onChange(undefined); lastAutomatic.current = undefined }
      setNotice('当前可用目录中没有匹配的辅助能力，可调整选择或直接生成初稿。'); return
    }
    if (selectionIdentity(effective) === selectionIdentity(next.selection)) {
      setNotice('当前辅助能力已符合所选起点。'); return
    }
    if (mayApplyTwinRecommendation(effective, props.value !== undefined, lastAutomatic.current)) {
      lastAutomatic.current = selectionIdentity(next.selection); props.onChange(next.selection)
      setNotice('已按起点推荐辅助能力，可调整或取消；生成初稿时才会调用。')
    } else setRecommendation(next)
  }, [props.recommendationRequest, handledRecommendation, loading, loadError, props.preview, suggested, props.value, bindings])
  useEffect(() => { props.onReadyChange?.(ready) }, [ready, props.onReadyChange])
  useEffect(() => { props.onBusyChange?.(Boolean(busy)); return () => props.onBusyChange?.(false) }, [busy, props.onBusyChange])
  useEffect(() => { props.onPendingChange?.('auxiliary', dirty || Boolean(busy)); return () => props.onPendingChange?.('auxiliary', false) }, [dirty, busy, props.onPendingChange])
  useEffect(() => {
    if (open) section.current?.querySelector<HTMLSelectElement>('[role="dialog"] select')?.focus()
    else if (wasOpen.current) section.current?.querySelector<HTMLButtonElement>('.twin-auxiliary-heading button')?.focus()
    wasOpen.current = open
  }, [open, catalog])
  const close = () => { if (lock.current) return; if (dirty) { setDiscarding(value => !value); return }; setOpen(false); setDiscarding(false); setError('') }
  const begin = () => { setEditing(effective); setInitialSelection(selectionIdentity(effective)); setSaveCommon(false); setTasks(['builder']); setError(''); setNotice(''); setDiscarding(false); setOpen(true) }
  const apply = async () => {
    if (lock.current) return
    const parsed = LibrarySelectionSchema.safeParse({ ...editing, replaceBindings: true })
    if (!parsed.success) { setError('本次最多选择 4 项 Skill 和 1 个智能体，请减少选择。'); return }
    const refs = [...parsed.data.skills, ...(parsed.data.agent ? [parsed.data.agent] : [])]
    if (refs.some(ref => !valid(ref))) { setError('部分能力已更新或不可访问，请先确认新版本或移除。'); return }
    const target = props.twinId
    lock.current = true; setBusy('save'); setError('')
    try {
      if (saveCommon) {
        if (!target || !version) throw new Error('请先创建分身，再保存常用能力。')
        const next = updateLibraryBindingsForTasks(bindings, parsed.data, tasks)
        if (next.length > 9) throw new Error('跨场景常用能力超过上限，请减少选择后重试。')
        const result = await apiPut<{ version: number; bindings: LibraryBinding[] }>(`/due-diligence/twins/${target}/library-bindings`, { expectedVersion: props.expectedVersion ?? version, bindings: next })
        if (!alive.current || scope.current !== target) return
        setBindings(result.bindings); setVersion(result.version); props.onSaved?.(target, result.version)
      }
      if (!alive.current || scope.current !== target) return
      lastAutomatic.current = undefined; setRecommendation(null)
      props.onChange(saveCommon ? undefined : parsed.data); setOpen(false); setSaveCommon(false)
      setNotice(saveCommon ? '常用能力已保存，本次对话也将使用。' : '已调整本次辅助能力。')
    } catch (cause) { if (alive.current) { setError((cause as Error).message); if ((cause as { status?: number }).status === 409) setReload(value => value + 1) } }
    finally { lock.current = false; if (alive.current) setBusy('') }
  }
  const learn = async (ref: LibrarySelection['skills'][number]) => {
    if (lock.current || !props.twinId) return
    lock.current = true; setBusy(libraryKey(ref)); setError('')
    try {
      await apiPost(`/due-diligence/twins/${props.twinId}/library-learn`, ref)
      if (!alive.current) return
      await props.onLearned?.(); setNotice('已加入下方 Skill 库的待学习区域，请核对后采纳。')
    } catch (cause) { if (alive.current) setError((cause as Error).message) }
    finally { lock.current = false; if (alive.current) setBusy('') }
  }
  return <section ref={section} className="twin-auxiliary" aria-label="辅助能力" aria-busy={loading || Boolean(busy)} onKeyDown={event => {
    if (!open) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    if (event.key === 'Tab') {
      const buttons = [...(section.current?.querySelectorAll<HTMLElement>('[role="dialog"] :is(button, input, select, summary, [tabindex="0"])') || [])].filter(item => item.getClientRects().length && !item.matches(':disabled'))
      const first = buttons[0], last = buttons.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }}>
    <div className="twin-auxiliary-heading"><div className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" aria-hidden="true" /><h3>辅助能力</h3><span className="twin-auxiliary-scope">{props.value?.replaceBindings ? '仅本次配置' : '使用分身常用'}</span></div>
      <Button size="sm" variant="secondary" className="twin-inline-action" disabled={props.disabled || props.preview || loading || Boolean(loadError)} onClick={begin}>调整</Button></div>
    {loading ? <p role="status" className="text-sm text-slate-500">正在读取常用能力…</p> : <div className="twin-auxiliary-tags">{selected.map(ref => {
      const item = catalog.find(item => libraryKey(item) === libraryKey(ref)), available = valid(ref)
      const focusLabels = suggested.reasons.find(reason => reason.key === libraryKey(ref))?.focuses
      return <span key={libraryKey(ref)} className={`twin-auxiliary-tag${available ? '' : ' is-unavailable'}`} title={`${item?.description || ''}${available ? ` · v${ref.version}` : ' · 已更新或不可用'}${focusLabels?.length ? ` · 匹配：${focusLabels.join('、')}` : ''}`}>
        {ref.source === 'workflow' || ref.source === 'prompt-agent' ? <Bot className="h-3.5 w-3.5" aria-hidden="true" /> : <Wrench className="h-3.5 w-3.5" aria-hidden="true" />}<span>{item?.name || '不可用能力'}{!available && '（待调整）'}</span></span>
    })}{!selected.length && <span className="text-sm text-slate-500">使用平台默认流程</span>}</div>}
    {recommendation && <div className="twin-recommendation-review" role="group" aria-label="起点推荐待确认"><p>你已有辅助能力配置，是否换用起点推荐？</p><p className="mt-1 text-xs text-slate-600">{[...recommendation.selection.skills, ...(recommendation.selection.agent ? [recommendation.selection.agent] : [])].map(ref => catalog.find(item => libraryKey(item) === libraryKey(ref))?.name).filter(Boolean).join('、')}</p><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" disabled={props.disabled} onClick={() => { lastAutomatic.current = selectionIdentity(recommendation.selection); props.onChange(recommendation.selection); setRecommendation(null); setNotice('已使用起点推荐；未修改已保存的常用配置。') }}>使用起点推荐</Button><Button size="sm" variant="secondary" disabled={props.disabled} onClick={() => { setRecommendation(null); setNotice('已保留原有辅助能力配置。') }}>保留本次选择</Button></div></div>}
    {loadError && <p role="alert" className="mt-2 text-sm text-amber-800">{loadError}<button type="button" className="ml-2 underline" disabled={props.disabled} onClick={() => setReload(value => value + 1)}>重试</button><button type="button" className="ml-2 underline" disabled={props.disabled} onClick={() => props.onChange({ skills: [], agent: null, replaceBindings: true })}>本次不使用辅助能力</button></p>}
    {!loading && !loadError && invalid && <p role="status" className="mt-2 text-xs text-amber-800">部分能力已更新或不可用，请调整；未确认的新版本不会自动使用。</p>}
    {props.value?.replaceBindings && !loading && !loadError && <button type="button" className="twin-text-action mt-1" disabled={props.disabled || Boolean(busy)} onClick={() => { lastAutomatic.current = undefined; setRecommendation(null); props.onChange(undefined); setNotice('已恢复使用分身常用能力。') }}>恢复常用配置</button>}
    {notice && !open && <p role="status" className="mt-2 text-xs text-slate-600">{notice}</p>}
    <Modal open={open} title="调整辅助能力" width="max-w-2xl" onClose={close} footer={<><Button variant="secondary" disabled={Boolean(busy)} onClick={close}>取消</Button><Button disabled={Boolean(busy) || loading || Boolean(loadError) || discarding} onClick={() => void apply()}><Check className="h-4 w-4" aria-hidden="true" />{busy === 'save' ? '保存中…' : saveCommon ? '保存常用并使用' : '应用到本次对话'}</Button></>}>
      {discarding && <div role="alertdialog" aria-label="放弃辅助能力调整" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm"><p>本次调整尚未应用，是否放弃？</p><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" onClick={() => setDiscarding(false)}>继续调整</Button><Button size="sm" variant="secondary" onClick={() => { setSaveCommon(false); setOpen(false); setDiscarding(false); setError('') }}>放弃调整</Button></div></div>}
      <fieldset disabled={Boolean(busy) || discarding} className="min-w-0 space-y-4">
        <LibraryPicker remember={false} task="builder" value={editing} onChange={value => setEditing({ ...value, replaceBindings: true })} onCatalog={setCatalog} />
        <div className="border-t border-slate-200 pt-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={saveCommon} disabled={!props.twinId || !version} onChange={event => setSaveCommon(event.target.checked)} />保存为该分身常用</label>
          {!props.twinId && <p className="mt-1 text-xs text-slate-500">创建分身后可保存常用配置；当前可先用于本次对话。</p>}
          {saveCommon && <div className="mt-3 flex flex-wrap gap-3 text-sm"><span className="text-slate-600">适用场景：</span><span>对话完善分身</span>{(['conversation', 'checklist'] as const).map((task, index) => <label key={task} className="flex items-center gap-1"><input type="checkbox" checked={tasks.includes(task)} onChange={event => setTasks(value => event.target.checked ? [...value, task] : value.filter(item => item !== task))} />{['调用分身对话', '生成尽调清单'][index]}</label>)}</div>}
        </div>
        {props.twinId && [...editing.skills, ...(editing.agent ? [editing.agent] : [])].length > 0 && <details className="border-t border-slate-200 pt-3"><summary className="cursor-pointer text-sm text-slate-600">提炼为个人 Skill 建议</summary><div className="mt-2 space-y-2">{[...editing.skills, ...(editing.agent ? [editing.agent] : [])].map(ref => <div key={libraryKey(ref)} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{catalog.find(item => libraryKey(item) === libraryKey(ref))?.name || '已选能力'}</span><Button size="sm" variant="secondary" disabled={!valid(ref)} onClick={() => void learn(ref)}>{busy === libraryKey(ref) ? '提炼中…' : '加入待学习'}</Button></div>)}</div></details>}
      </fieldset>
      {notice && <p role="status" className="mt-3 text-sm text-slate-600">{notice}</p>}{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </Modal>
  </section>
}
