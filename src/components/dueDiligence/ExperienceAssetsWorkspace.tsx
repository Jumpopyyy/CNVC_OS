import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Mic, Plus, Trash2 } from 'lucide-react'
import { Badge, Button, Card, Modal } from '../ui'
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition'
import type { LearningCandidate, PublicTwin, Twin, TwinAsset, TwinSkill, TwinSkillImport, TwinDraft, TwinBuildUpload } from './types'
import { TwinAvatar, twinAvatarPresets } from './TwinAvatar'
import { TwinSkillLibrary } from './TwinSkillLibrary'
import { TwinDialogue, type TwinDialogueTarget } from './TwinDialogue'
import { TwinBuilder } from './TwinBuilder'
import { TwinInquiryInbox } from './TwinInquiryInbox'
import { summarizeTwinFocus, resolveTwinDescription } from './twinTemplates'
import type { TwinBuilderDraft } from './twinDraftRecovery'

type ImportableSource = { id: string; name: string; text: string; sourceType: string }
type PlatformSkill = { id: string; name: string; description?: string; markdown?: string }
const Field = ({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) => <label className={className}><span className="label">{label}</span>{children}</label>

export function ExperienceAssetsWorkspace(props: {
  preview?: boolean
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
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [conversationTwin, setConversationTwin] = useState<TwinDialogueTarget | null>(null)
  const [publication, setPublication] = useState<{ twin: Twin; publicRules: string; publicBoundaries: string } | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [building, setBuilding] = useState(false)
  const [publishError, setPublishError] = useState('')
  const nameRef = useRef<HTMLInputElement | null>(null)
  const draftRef = useRef(props.draft); draftRef.current = props.draft
  const speech = useSpeechRecognition({ continuous: true, onFinal: text => props.onDraft({ ...draftRef.current, rules: `${draftRef.current.rules}${draftRef.current.rules ? '\n' : ''}${text}` }) })
  useEffect(() => { if (props.isNew) nameRef.current?.focus() }, [props.isNew])
  useEffect(() => { speech.reset() }, [props.selectedTwin?.id, props.isNew])

  const ownPublished = new Map(props.publicTwins.filter(item => item.ownerUserId === props.currentUserId).map(item => [item.twinId, item]))
  const otherPublished = props.publicTwins.filter(item => item.ownerUserId !== props.currentUserId)

  const readAvatar = (file: File) => {
    if (file.size > 2 * 1024 * 1024) { window.alert('头像不能超过 2MB'); return }
    const reader = new FileReader()
    reader.onload = () => { props.onDraft({ ...props.draft, avatarDataUrl: String(reader.result), avatarPreset: null }); setAvatarOpen(false) }
    reader.readAsDataURL(file)
  }

  return <fieldset disabled={props.saving} className="min-w-0 space-y-5">
    {!props.preview && <TwinInquiryInbox key={props.currentUserId} onPendingChange={props.onPendingChange} />}
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">我的数字分身</h2><Button onClick={props.onNew}><Plus className="h-4 w-4" />新增数字分身</Button></div>
      <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
        {props.twins.map(twin => <button key={twin.id} className={`min-w-64 max-w-80 rounded-xl border p-4 text-left ${props.selectedTwin?.id === twin.id ? 'border-brand-400 bg-brand-50' : 'border-slate-200'}`} onClick={() => props.onSelect(twin)}><div className="flex items-center gap-2"><TwinAvatar id={twin.id} name={twin.name} kind={twin.avatarKind} preset={twin.avatarPreset} /><div className="min-w-0 flex-1"><strong className="block truncate">{twin.name}</strong><p className="mt-1 text-xs text-slate-500">私有版本 v{twin.activeVersion}</p></div><Badge>{ownPublished.has(twin.id) ? '已公开' : '未公开'}</Badge></div><p className="mt-3 line-clamp-2 text-xs leading-relaxed text-slate-600">{resolveTwinDescription(twin) || '尚未填写说明'}</p></button>)}
        {!props.twins.length && !props.isNew && <p className="text-sm text-slate-400">尚未创建数字分身。</p>}
      </div>
      {(props.selectedTwin || props.isNew) && <div className="mt-5 rounded-xl border border-slate-200 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><strong>{props.isNew ? '未保存的新分身' : '编辑当前分身'}{props.dirty && <span className="ml-2 text-xs font-normal text-amber-700">有未保存修改</span>}</strong><div className="flex flex-wrap gap-2">{props.selectedTwin && <><Button size="sm" variant="secondary" onClick={() => setConversationTwin({ id: props.selectedTwin!.id, twinId: props.selectedTwin!.id, name: props.selectedTwin!.name, public: false, avatarKind: props.selectedTwin!.avatarKind, avatarPreset: props.selectedTwin!.avatarPreset, learningTwinId: props.selectedTwin!.id })}>调用对话</Button><Button size="sm" variant="secondary" onClick={() => { const twin = props.selectedTwin!; const existing = ownPublished.get(twin.id); setPublishError(''); setPublication({ twin, publicRules: existing?.publicRules || twin.rules, publicBoundaries: existing?.publicBoundaries || '仅提供辅助建议，结论须依据项目证据核验。' }) }}>{ownPublished.has(props.selectedTwin.id) ? '更新公开内容' : '公开到分身库'}</Button>{ownPublished.has(props.selectedTwin.id) && <Button size="sm" variant="secondary" onClick={() => void props.onWithdraw(props.selectedTwin!)}>取消公开</Button>}<Button size="sm" variant="secondary" onClick={() => void props.onDelete(props.selectedTwin!)}><Trash2 className="h-3.5 w-3.5" />删除</Button></>}</div></div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="分身名称"><input ref={nameRef} className="input" value={props.draft.name} onChange={event => props.onDraft({ ...props.draft, name: event.target.value })} /></Field>
          <button type="button" aria-label="更换数字分身头像" className="flex items-end gap-2 text-left" onClick={() => setAvatarOpen(true)}><TwinAvatar id={props.selectedTwin?.id || 'draft'} name={props.draft.name || '数字分身'} preset={props.draft.avatarPreset} kind={props.selectedTwin?.avatarKind} previewUrl={props.draft.avatarDataUrl} size="lg" /><span className="pb-1 text-sm text-slate-500">点击头像可更换</span></button>
          <Field label="分身备注说明" className="md:col-span-2"><input className="input" value={resolveTwinDescription(props.draft)} placeholder="该分身关注…" onChange={event => props.onDraft({ ...props.draft, description: event.target.value, descriptionMode: 'manual' })} /><button type="button" className="mt-1 text-xs text-brand-700" onClick={() => props.onDraft({ ...props.draft, description: summarizeTwinFocus(props.draft.rules), descriptionMode: 'auto' })}>根据关注点自动概括</button></Field>
          <div className="md:col-span-2"><TwinBuilder key={`${props.selectedTwin?.id || props.draftId}:${props.builderEpoch || 0}`} initialState={props.builderDraft} onDraftState={props.onBuilderDraft} draft={props.draft} draftId={props.draftId} onDraft={props.onDraft} onUpload={props.onBuildUpload} upload={props.buildUpload} preview={props.preview} onBusyChange={setBuilding} onUploadAdopted={props.onBuildUploadAdopted} onPendingChange={props.onPendingChange} /></div>
          <details className="md:col-span-2"><summary className="cursor-pointer text-sm text-slate-600">查看与调整完整偏好</summary><div className="mt-3 space-y-3"><Field label="判断偏好"><textarea className="textarea min-h-44" value={props.draft.rules} onChange={event => props.onDraft({ ...props.draft, rules: event.target.value, ...(props.draft.descriptionMode !== 'manual' ? { description: summarizeTwinFocus(event.target.value) } : {}) })} /></Field><Button variant="secondary" onClick={speech.state === 'listening' ? speech.pause : speech.start}><Mic className="h-4 w-4" />{speech.state === 'listening' ? '暂停语音' : '语音补充偏好'}</Button>{speech.error && <span className="text-xs text-amber-700">{speech.error}</span>}<Field label="私有案例与适用边界（可选）"><textarea className="textarea min-h-28" value={props.draft.cases} onChange={event => props.onDraft({ ...props.draft, cases: event.target.value })} /></Field><p className="text-xs leading-relaxed text-slate-500">案例保留你的判断经验；适用边界说明何时不能套用这些经验。均可留空，不随公开分身分享。</p></div></details>
        </div>
        <div className="mt-4 flex justify-end"><Button disabled={building || props.saving || !props.draft.name.trim()} onClick={() => void props.onSave()}>{building ? '请等待建议整理完成' : props.saving ? '保存中…' : props.isNew ? '创建分身' : '保存新版本'}</Button></div>
      </div>}
    </Card>

    <TwinSkillLibrary key={props.selectedTwin?.id || "new"} {...props} />

    <Card className="p-5"><h2 className="font-semibold">公司分身库</h2><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{otherPublished.map(twin => <div key={twin.id} className="rounded-xl border p-4"><div className="flex items-center gap-2"><TwinAvatar id={twin.twinId} name={twin.ownerName} kind={twin.avatarKind} preset={twin.avatarPreset} /><strong>{twin.ownerName} · {twin.twinName || '数字分身'}</strong><Badge>v{twin.publishedVersion}</Badge></div><p className="mt-2 text-sm text-slate-600">{twin.introduction}</p><Button className="mt-3" size="sm" onClick={() => { setConversationTwin({ id: twin.id, twinId: twin.twinId, name: `${twin.ownerName} · ${twin.twinName || '数字分身'}`, public: true, avatarKind: twin.avatarKind, avatarPreset: twin.avatarPreset, learningTwinId: props.selectedTwin?.id }) }}>调用对话</Button></div>)}{!otherPublished.length && <p className="text-sm text-slate-400">暂无其他员工公开分身。</p>}</div></Card>

    <Modal open={avatarOpen} title="更换分身头像" onClose={() => setAvatarOpen(false)} footer={<Button variant="secondary" onClick={() => setAvatarOpen(false)}>完成</Button>}><div className="flex flex-wrap gap-3">{twinAvatarPresets.map(preset => <button type="button" key={preset} onClick={() => props.onDraft({ ...props.draft, avatarPreset: preset, avatarDataUrl: null })} className={`rounded-lg p-2 ${props.draft.avatarPreset === preset && !props.draft.avatarDataUrl ? 'ring-2 ring-brand-500' : ''}`}><TwinAvatar id="draft" name="头像" preset={preset} size="lg" /></button>)}<label className="inline-flex cursor-pointer items-center rounded-lg border px-3 py-2 text-sm">上传图片<input className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) readAvatar(file); event.currentTarget.value = '' }} /></label></div></Modal>
    <Modal open={Boolean(publication)} title="确认公开内容" onClose={() => setPublication(null)} footer={<Button disabled={publishing || !publication?.publicRules.trim()} onClick={async () => { if (!publication) return; setPublishing(true); setPublishError(''); try { await props.onPublish(publication.twin, publication); setPublication(null) } catch (err) { setPublishError((err as Error).message) } finally { setPublishing(false) } }}>{publishing ? '发布中…' : '确认发布'}</Button>}>{publication && <div className="space-y-3"><p className="text-sm text-slate-600">同事将使用以下公开内容。私有案例、素材和 Skill 保留在本人分身中。</p><Field label="公开判断偏好"><textarea className="textarea min-h-40" value={publication.publicRules} onChange={event => setPublication({ ...publication, publicRules: event.target.value })} /></Field><Field label="公开适用边界"><textarea className="textarea" value={publication.publicBoundaries} onChange={event => setPublication({ ...publication, publicBoundaries: event.target.value })} /></Field>{publishError && <p role="alert" className="text-sm text-red-700">{publishError}</p>}</div>}</Modal>
    {conversationTwin && <TwinDialogue key={`${conversationTwin.public}:${conversationTwin.id}`} target={conversationTwin} projects={props.projects} onClose={() => setConversationTwin(null)} onLearned={props.onRefreshLearning} />}
  </fieldset>
}
