import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Plus, Search, Trash2, UsersRound } from 'lucide-react'
import { Badge, Button, Card, Modal } from '../ui'
import type { LearningCandidate, PublicTwin, Twin, TwinAsset, TwinSkill, TwinSkillImport, TwinDraft, TwinBuildUpload } from './types'
import { TwinAvatar, twinAvatarPresets } from './TwinAvatar'
import { TwinSkillLibrary } from './TwinSkillLibrary'
import { TwinDialogue, type TwinDialogueTarget } from './TwinDialogue'
import { TwinBuilder } from './TwinBuilder'
import { TwinInquiryInbox } from './TwinInquiryInbox'
import { resolveTwinDescription } from './twinTemplates'
import type { TwinBuilderDraft } from './twinDraftRecovery'

type ImportableSource = { id: string; name: string; text: string; sourceType: string }
type PlatformSkill = { id: string; name: string; description?: string; markdown?: string }
const Field = ({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) => <label className={className}><span className="label">{label}</span>{children}</label>

export function ExperienceAssetsWorkspace(props: {
  preview?: boolean
  active?: boolean
  onLibrarySaved?: (twinId: string, version: number) => void
  currentUserId: string
  twins: Twin[]
  publicTwins: PublicTwin[]
  selectedTwin?: Twin
  draft: TwinDraft
  isNew: boolean
  dirty: boolean
  saving: boolean
  draftId: string
  builderDraft?: TwinBuilderDraft
  builderEpoch?: number
  onBuilderDraft?: (state: TwinBuilderDraft) => void
  buildUpload?: TwinBuildUpload
  onBuildUploadAdopted: () => void
  onPendingChange?: (editor: string, pending: boolean) => void
  projects: Array<{ id: string; name: string }>
  onBuildUpload: (file: File) => Promise<string | null>
  assets: TwinAsset[]
  candidates: LearningCandidate[]
  skills: TwinSkill[]
  skillImports: TwinSkillImport[]
  sources: ImportableSource[]
  platformSkills: PlatformSkill[]
  onNew: () => void
  onSelect: (twin: Twin) => void
  onDraft: (draft: TwinDraft) => void
  onSave: () => Promise<unknown>
  onDelete: (twin: Twin) => Promise<void>
  onPublish: (twin: Twin, content: { publicRules: string; publicBoundaries: string }) => Promise<void>
  onWithdraw: (twin: Twin) => Promise<void>
  onImportLocal: (file: File) => Promise<void>
  onImportSource: (source: ImportableSource) => Promise<void>
  onParseAsset: (asset: TwinAsset) => Promise<string | null>
  onAssetDecision: (asset: TwinAsset, decision: '采纳' | '排除', traits?: string, target?: 'preference' | 'skill') => Promise<void>
  onUpdateCandidate: (id: string, input: { topic: string; rules: string; boundaries: string; rationale: string }) => Promise<void>
  onExcludeImport: (id: string) => Promise<void>
  onRefreshLearning: () => Promise<void>
  onDecideCandidates: (ids: string[], decision: '确认' | '拒绝') => Promise<void>
  onImportSkillFiles: (files: FileList | File[]) => Promise<void>
  onImportGithubSkill: (url: string) => Promise<void>
  onImportPlatformSkill: (skill: PlatformSkill) => Promise<void>
  onLearnSkill: (id: string) => Promise<void>
  onToggleSkill: (skill: TwinSkill) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const workspaceRef = useRef<HTMLFieldSetElement>(null)
  const [wide, setWide] = useState(false)
  const [publicId, setPublicId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [acting, setActing] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [conversationTwin, setConversationTwin] = useState<TwinDialogueTarget | null>(null)
  const [publication, setPublication] = useState<{ twin: Twin; publicRules: string; publicBoundaries: string } | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [building, setBuilding] = useState(false)
  const [publishError, setPublishError] = useState('')
  const nameRef = useRef<HTMLInputElement | null>(null)
  const draftRef = useRef(props.draft); draftRef.current = props.draft
  const selectionRef = useRef(props.draftId); selectionRef.current = props.draftId
  useEffect(() => { if (props.isNew) nameRef.current?.focus() }, [props.isNew])
  useEffect(() => {
    const element = workspaceRef.current
    if (!element) return
    const measure = () => setWide(element.clientWidth >= 960)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const ownPublished = new Map(props.publicTwins.filter(item => item.ownerUserId === props.currentUserId).map(item => [item.twinId, item]))
  const otherPublished = props.publicTwins.filter(item => item.ownerUserId !== props.currentUserId)

  const publicTwin = otherPublished.find(twin => twin.id === publicId)
  const needle = query.trim().toLocaleLowerCase()
  const visibleOwn = props.twins.filter(twin => [twin.name, resolveTwinDescription(twin)].join(' ').toLocaleLowerCase().includes(needle))
  const visiblePublic = otherPublished.filter(twin => [twin.ownerName, twin.twinName, twin.introduction].join(' ').toLocaleLowerCase().includes(needle))
  useEffect(() => { setPublicId(null); setActionError(''); setAvatarOpen(false) }, [props.selectedTwin?.id, props.draftId])
  const runAction = async (action: () => Promise<unknown>) => { if (acting) return; setActing(true); setActionError(''); try { await action() } catch (cause) { setActionError((cause as Error).message) } finally { setActing(false) } }
  const openOwnDialogue = () => { const twin = props.selectedTwin; if (twin) setConversationTwin({ id: twin.id, twinId: twin.id, name: twin.name, public: false, avatarKind: twin.avatarKind, avatarPreset: twin.avatarPreset, learningTwinId: twin.id }) }
  const selectOwn = (twin: Twin) => { if (props.selectedTwin?.id === twin.id) setPublicId(null); else props.onSelect(twin) }
  const startNew = () => { if (props.isNew) setPublicId(null); else props.onNew() }

  const readAvatar = (file: File) => {
    if (file.size > 2 * 1024 * 1024) { setActionError('头像不能超过 2MB'); return }
    const selection = props.draftId
    const reader = new FileReader()
    reader.onload = () => { if (selectionRef.current !== selection) return; props.onDraft({ ...draftRef.current, avatarDataUrl: String(reader.result), avatarPreset: null }); setAvatarOpen(false) }
    reader.onerror = () => { if (selectionRef.current === selection) setActionError('图片读取失败，请重新选择。') }
    reader.readAsDataURL(file)
  }


  const saveControl = (blocked: boolean) => <Button disabled={blocked || building || props.saving || acting || !props.draft.name.trim() || (!props.isNew && !props.dirty)} onClick={() => void props.onSave()}>{props.saving ? '保存中…' : props.isNew ? '创建分身' : props.dirty ? '保存分身' : '当前偏好已保存'}</Button>
  const overview = (startingPoints: ReactNode) => <Card className="twin-panel">
    <header className="twin-profile-header">
      <button type="button" aria-label="更换数字分身头像" className="twin-edit-avatar" onClick={() => { setActionError(''); setAvatarOpen(true) }}><TwinAvatar id={props.selectedTwin?.id || 'draft'} name={props.draft.name || '数字分身'} preset={props.draft.avatarPreset} kind={props.selectedTwin?.avatarKind} previewUrl={props.draft.avatarDataUrl} size="md" /></button>
      <div className="min-w-0 flex-1"><h2 className="break-words">{props.isNew ? '未保存的新分身' : props.selectedTwin?.name}</h2><div className="mt-1 flex flex-wrap items-center gap-2"><Badge tone={props.selectedTwin && ownPublished.has(props.selectedTwin.id) ? 'green' : 'slate'}>{props.selectedTwin && ownPublished.has(props.selectedTwin.id) ? '已公开' : '未公开'}</Badge>{props.dirty && <span className="text-xs text-slate-600">有未保存修改</span>}</div></div>
      {props.selectedTwin && <Button variant="secondary" size="sm" className="twin-inline-action" onClick={openOwnDialogue}>调用对话</Button>}
    </header>
    <div className="twin-profile-fields">
      <Field label="分身名称"><input ref={nameRef} className="input" value={props.draft.name} onChange={event => props.onDraft({ ...props.draft, name: event.target.value })} /></Field>
      <Field label="分身备注说明"><input aria-label="分身备注说明" className="input" value={props.draft.description ?? ''} placeholder="未填写时，首次保存根据偏好生成" onChange={event => props.onDraft({ ...props.draft, description: event.target.value, descriptionMode: 'manual' })} /></Field>
    </div>
    {startingPoints}
    <footer className="twin-profile-actions">
      <div className="flex flex-wrap items-center gap-2">
        {props.selectedTwin && <><Button size="sm" variant="secondary" disabled={acting} onClick={() => { const twin = props.selectedTwin!; const existing = ownPublished.get(twin.id); setPublishError(''); setPublication({ twin, publicRules: existing?.publicRules || twin.rules, publicBoundaries: existing?.publicBoundaries || '仅提供辅助建议，结论须依据项目证据核验。' }) }}>{ownPublished.has(props.selectedTwin.id) ? '更新公开内容' : '公开到分身库'}</Button>{ownPublished.has(props.selectedTwin.id) && <Button size="sm" variant="secondary" disabled={acting} onClick={() => void runAction(() => props.onWithdraw(props.selectedTwin!))}>取消公开</Button>}
          <Button size="sm" variant="danger" disabled={acting} onClick={() => void runAction(() => props.onDelete(props.selectedTwin!))}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />删除分身</Button>
        </>}
      </div>
    </footer>
    {actionError && <p role="alert" className="mt-3 text-sm text-red-700">{actionError}</p>}
  </Card>

  return <fieldset ref={workspaceRef} disabled={props.saving} data-wide={wide} className="twin-workspace min-w-0">
    {!props.preview && <TwinInquiryInbox key={props.currentUserId} onPendingChange={props.onPendingChange} />}
    <div className="twin-workspace-grid">
      <aside className="twin-directory twin-panel" aria-label="分身列表">
        <div className="flex items-center justify-between gap-2"><h2>分身库</h2><Button size="sm" onClick={startNew}><Plus className="h-4 w-4" aria-hidden="true" />新增分身</Button></div>
        <label className="twin-directory-search"><span className="sr-only">搜索分身</span><Search className="h-4 w-4" aria-hidden="true" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索姓名或关注点" className="input" /></label>
        <div className="twin-directory-groups">
          <section aria-label="我的分身"><h3 className="twin-list-heading">我的分身<span>{props.twins.length}</span></h3>
            {props.isNew && !query && <button type="button" className="twin-list-item" aria-pressed={!publicId} onClick={() => setPublicId(null)}><Plus className="h-5 w-5 shrink-0" /><span className="min-w-0"><strong>未保存的新分身</strong><small>完善后点击创建分身</small></span></button>}
            {visibleOwn.map(twin => <button key={twin.id} type="button" className="twin-list-item" aria-pressed={!publicId && props.selectedTwin?.id === twin.id && !props.isNew} onClick={() => selectOwn(twin)}>
              <TwinAvatar id={twin.id} name={twin.name} kind={twin.avatarKind} preset={twin.avatarPreset} size="sm" />
              <span className="min-w-0 flex-1"><strong>{twin.name}</strong><small title={resolveTwinDescription(twin)}>{resolveTwinDescription(twin) || '尚未填写说明'}</small><span className="twin-list-state">{ownPublished.has(twin.id) ? '已公开' : '未公开'}</span></span>
              {!publicId && props.selectedTwin?.id === twin.id && <Check className="h-4 w-4 shrink-0 text-blue-600" aria-label="已选中" />}
            </button>)}
            {!visibleOwn.length && <p className="twin-empty">{query ? '没有匹配的个人分身' : '暂无分身，点击上方新增'}</p>}
          </section>
          <section aria-label="公司分身库"><h3 className="twin-list-heading"><UsersRound className="h-4 w-4" aria-hidden="true" />公司分身库<span>{otherPublished.length}</span></h3>
            {visiblePublic.map(twin => <button key={twin.id} type="button" className="twin-list-item" aria-pressed={publicId === twin.id} onClick={() => setPublicId(twin.id)}>
              <TwinAvatar id={twin.twinId} name={twin.ownerName} kind={twin.avatarKind} preset={twin.avatarPreset} size="sm" />
              <span className="min-w-0 flex-1"><strong>{twin.twinName || twin.ownerName}</strong><small title={twin.introduction}>{twin.ownerName} · {twin.introduction || '公开数字分身'}</small><span className="twin-list-state">已公开</span></span>
              {publicId === twin.id && <Check className="h-4 w-4 shrink-0 text-blue-600" aria-label="已选中" />}
            </button>)}
            {!visiblePublic.length && <p className="twin-empty">{query ? '没有匹配的公司分身' : '暂无其他员工公开分身'}</p>}
          </section>
        </div>
      </aside>
      <div className="twin-workspace-main">
        {/* Keep the private editor mounted while browsing public snapshots, so drafts and pending suggestions survive. */}
        <div hidden={Boolean(publicId)} className="twin-personal-workspace space-y-4">
          {(props.selectedTwin || props.isNew) ? <TwinBuilder key={`${props.selectedTwin?.id || props.draftId}:${props.builderEpoch || 0}`} active={props.active !== false && !publicId} onLibrarySaved={props.onLibrarySaved} onLibraryLearned={props.onRefreshLearning} renderOverview={overview} renderSave={saveControl} initialState={props.builderDraft} onDraftState={props.onBuilderDraft} draft={props.draft} draftId={props.draftId} onDraft={props.onDraft} onUpload={props.onBuildUpload} upload={props.buildUpload} preview={props.preview} onBusyChange={setBuilding} onUploadAdopted={props.onBuildUploadAdopted} onPendingChange={props.onPendingChange} /> : <Card className="twin-panel"><h2>选择一个数字分身</h2><p className="twin-empty">从左侧选择，或新增自己的分身。</p></Card>}
          <TwinSkillLibrary key={props.selectedTwin?.id || 'new'} {...props} />
        </div>
        {publicId && (publicTwin ? <Card className="twin-panel">
          <header className="twin-profile-header"><span className="twin-edit-avatar"><TwinAvatar id={publicTwin.twinId} name={publicTwin.ownerName} kind={publicTwin.avatarKind} preset={publicTwin.avatarPreset} /></span><div className="min-w-0 flex-1"><h2 className="break-words">{publicTwin.twinName || publicTwin.ownerName}</h2><p className="mt-1 text-sm text-slate-600">{publicTwin.ownerName}</p></div><Badge tone="green">已公开</Badge></header>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-6">{publicTwin.introduction}</p>
          <div className="mt-5 border-t border-slate-100 pt-4"><h3 className="text-sm font-semibold">公开判断偏好</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{publicTwin.publicRules || '暂无公开偏好'}</p></div>
          <div className="mt-5"><Button onClick={() => setConversationTwin({ id: publicTwin.id, twinId: publicTwin.twinId, name: `${publicTwin.ownerName} · ${publicTwin.twinName || '数字分身'}`, public: true, avatarKind: publicTwin.avatarKind, avatarPreset: publicTwin.avatarPreset, learningTwinId: props.selectedTwin?.id })}>调用对话</Button></div>
        </Card> : <Card className="twin-panel"><p role="status">该分身已撤回或暂不可用。</p><Button className="mt-3" variant="secondary" onClick={() => setPublicId(null)}>返回我的分身</Button></Card>)}
      </div>
    </div>

    <Modal open={avatarOpen} title="更换分身头像" onClose={() => setAvatarOpen(false)} footer={<Button variant="secondary" onClick={() => setAvatarOpen(false)}>完成</Button>}><div className="flex flex-wrap gap-3">{twinAvatarPresets.map(preset => <button type="button" key={preset} aria-label={`选择头像 ${preset}`} onClick={() => props.onDraft({ ...props.draft, avatarPreset: preset, avatarDataUrl: null })} className={`rounded-lg p-2 ${props.draft.avatarPreset === preset && !props.draft.avatarDataUrl ? 'ring-2 ring-brand-500' : ''}`}><TwinAvatar id="draft" name="头像" preset={preset} size="md" /></button>)}<label className="inline-flex cursor-pointer items-center rounded-lg border px-3 py-2 text-sm">上传图片<input className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) readAvatar(file); event.currentTarget.value = '' }} /></label></div>{actionError && <p role="alert" className="mt-3 text-sm text-red-700">{actionError}</p>}</Modal>
    <Modal open={Boolean(publication)} title="确认公开内容" onClose={() => setPublication(null)} footer={<Button disabled={publishing || !publication?.publicRules.trim()} onClick={async () => { if (!publication) return; setPublishing(true); setPublishError(''); try { await props.onPublish(publication.twin, publication); setPublication(null) } catch (err) { setPublishError((err as Error).message) } finally { setPublishing(false) } }}>{publishing ? '发布中…' : '确认发布'}</Button>}>{publication && <div className="space-y-3"><p className="text-sm text-slate-600">同事将使用以下公开内容。私有案例、素材和 Skill 保留在本人分身中。</p><Field label="公开判断偏好"><textarea className="textarea min-h-40" value={publication.publicRules} onChange={event => setPublication({ ...publication, publicRules: event.target.value })} /></Field><Field label="公开适用边界"><textarea className="textarea" value={publication.publicBoundaries} onChange={event => setPublication({ ...publication, publicBoundaries: event.target.value })} /></Field>{publishError && <p role="alert" className="text-sm text-red-700">{publishError}</p>}</div>}</Modal>
    {conversationTwin && <TwinDialogue key={`${conversationTwin.public}:${conversationTwin.id}`} target={conversationTwin} projects={props.projects} onClose={() => setConversationTwin(null)} onLearned={props.onRefreshLearning} />}
  </fieldset>
}
