import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bot, ClipboardList, UsersRound } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { useSaiPageContext } from '../store/useSaiPageContext'
import { buildSaiDueDiligenceSnapshot } from '../lib/saiAgent'
import { useAuthStore } from '../store/useAuthStore'
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '../lib/api'
import { useToast } from '../components/Toast'
import { Badge, Button, Card, Modal, PageHeader } from '../components/ui'
import { QuestionsWorkspace } from '../components/dueDiligence/QuestionsWorkspace'
import { InterviewsWorkspace } from '../components/dueDiligence/InterviewsWorkspace'
import { ExperienceAssetsWorkspace } from '../components/dueDiligence/ExperienceAssetsWorkspace'
import type { Project, ProjectFile } from '../types'
import type { CapabilityStatus, Interview, InterviewArtifact, InterviewPrompt, InterviewTranscript, LearningCandidate, Member, PublicTwin, Question, QuestionEdit, QuestionApplyDecision, QuestionPack, TranscriptionJob, Twin, TwinAsset, TwinSkill, TwinSkillImport, TwinDraft } from '../components/dueDiligence/types'
import { summarizeTwinFocus } from '../components/dueDiligence/twinTemplates'
import type { TwinBuildUpload } from '../components/dueDiligence/types'
import { stageTwinAsset } from '../components/dueDiligence/twinDraftState'
import { useTwinLeaveGuard } from '../components/dueDiligence/useTwinLeaveGuard'
import { emptyTwinBuilderDraft, type TwinBuilderDraft } from '../components/dueDiligence/twinDraftRecovery'
import { useTwinDraftRecovery } from '../components/dueDiligence/useTwinDraftRecovery'

type InterviewForm = { title: string; mode: '现场' | '远程'; scheduledAt: string; agenda: string; counterparty: string; location: string; participantNames: string[] }
type ImportableSource = { id: string; name: string; text: string; sourceType: string }
type PlatformSkill = { id: string; name: string; description?: string; markdown?: string }
const emptyInterview: InterviewForm = { title: '', mode: '现场', scheduledAt: '', agenda: '', counterparty: '', location: '', participantNames: [] }
const demoProject: Project = { id: 'd0d00000-0000-4000-8000-000000000001', name: '星河智能制造', companyName: '星河智能制造（杭州）有限公司', industry: '智能制造', round: 'B轮', stage: '尽调', owner: '姜波', collaborators: ['陈晨'], source: '演示数据', financing: 'B轮融资', valuation: '8亿元', riskLevel: '中', summary: '用于尽调工作台前端预览的虚拟项目。', score: 78, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), tags: ['智能制造'], businessModel: '', market: '', team: '', progress: 55, version: 1 }
const demoFile: ProjectFile = { id: 'd0d00000-0000-4000-8000-000000000201', projectId: demoProject.id, name: '2026年上半年财务报表.pdf', type: 'PDF', category: '财务材料', size: '2.4 MB', uploader: '陈晨', uploadedAt: new Date().toISOString(), parseStatus: '成功', version: 1, visibility: '项目成员' }

function Tab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return <button onClick={onClick} className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium ${active ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{icon}{children}</button>
}
const fileToDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(new Error('文件读取失败')); reader.readAsDataURL(file) })

export function DueDiligencePage({ preview = false }: { preview?: boolean }) {
  const setDueDiligenceContext = useSaiPageContext(state => state.setDueDiligenceContext)
  const [searchParams, setSearchParams] = useSearchParams()
  const storeProjects = useAppStore(state => state.projects)
  const storeFiles = useAppStore(state => state.files)
  const user = useAuthStore(state => state.user)
  const { showToast } = useToast()
  const projects = preview ? [demoProject] : storeProjects
  const files = preview ? [demoFile] : storeFiles
  const [active, setActive] = useState<'questions' | 'interviews' | 'assets'>('questions')
  const projectId = searchParams.get('project') || projects[0]?.id || ''
  const projectFiles = useMemo(() => files.filter(item => item.projectId === projectId), [files, projectId])
  const [questions, setQuestions] = useState<Question[]>([])
  const [interviews, setInterviews] = useState<Interview[]>([])
  const [prompts, setPrompts] = useState<Record<string, InterviewPrompt[]>>({})
  const [artifacts, setArtifacts] = useState<Record<string, InterviewArtifact[]>>({})
  const [transcripts, setTranscripts] = useState<Record<string, InterviewTranscript>>({})
  const [jobs, setJobs] = useState<Record<string, TranscriptionJob[]>>({})
  const [members, setMembers] = useState<Member[]>([])
  const [selectedInterviewId, setSelectedInterviewId] = useState('')
  const [loadingProject, setLoadingProject] = useState(false)
  const [recordingActive, setRecordingActive] = useState(false)
  const [showInterview, setShowInterview] = useState(false)
  const [interviewForm, setInterviewForm] = useState(emptyInterview)
  const [twins, setTwins] = useState<Twin[]>([])
  const [publicTwins, setPublicTwins] = useState<PublicTwin[]>([])
  const [selectedTwinId, setSelectedTwinId] = useState('')
  const [twinDraft, setTwinDraft] = useState<TwinDraft>({ id: '', name: user?.name ? `${user.name}的尽调分身` : '', role: user?.role || '投资经理', rules: '', cases: '' })
  const [savedTwinDraft, setSavedTwinDraft] = useState<TwinDraft | null>(() => twinDraft)
  const [newTwinRequestId, setNewTwinRequestId] = useState('')
  const [savingTwin, setSavingTwin] = useState(false)
  const [buildUploads, setBuildUploads] = useState<Record<string, TwinBuildUpload>>({})
  const [builderDraft, setBuilderDraft] = useState<TwinBuilderDraft>(emptyTwinBuilderDraft)
  const [builderEpoch, setBuilderEpoch] = useState(0)
  const [restoringDraft, setRestoringDraft] = useState(false)
  const [pendingTwinEditors, setPendingTwinEditors] = useState<Record<string, boolean>>({})
  const [pendingTwinNavigation, setPendingTwinNavigation] = useState<(() => void) | null>(null)
  const [twinAssets, setTwinAssets] = useState<TwinAsset[]>([])
  const [learningCandidates, setLearningCandidates] = useState<LearningCandidate[]>([])
  const [twinSkills, setTwinSkills] = useState<TwinSkill[]>([])
  const [skillImports, setSkillImports] = useState<TwinSkillImport[]>([])
  const [sources, setSources] = useState<ImportableSource[]>([])
  const [platformSkills, setPlatformSkills] = useState<PlatformSkill[]>([])
  const [capabilities, setCapabilities] = useState<CapabilityStatus | null>(null)
  const [capabilityError, setCapabilityError] = useState('')
  const [writeProbeReady, setWriteProbeReady] = useState(false)
  const [writeProbeError, setWriteProbeError] = useState('')
  const [projectError, setProjectError] = useState('')
  const [assetError, setAssetError] = useState('')
  const [recordingOwnerId, setRecordingOwnerId] = useState('')
  const projectInterviews = interviews.filter(item => item.projectId === projectId)
  const selectedInterview = projectInterviews.find(item => item.id === selectedInterviewId) ?? projectInterviews[0]
  const selectedTwin = twins.find(item => item.id === selectedTwinId)
  const twinDirty = savedTwinDraft ? JSON.stringify(twinDraft) !== JSON.stringify(savedTwinDraft) : Boolean(twinDraft.name || twinDraft.rules || twinDraft.cases)
  const isNewTwin = Boolean(newTwinRequestId) && !selectedTwin
  const project = projects.find(item => item.id === projectId)
  const administrator = ['系统管理员', 'AI平台管理员', 'AI 平台管理员'].includes(user?.role || '')
  const context = useRef({ projectId, selectedTwinId, newTwinRequestId, interviewId: selectedInterview?.id })
  context.current = { projectId, selectedTwinId, newTwinRequestId, interviewId: selectedInterview?.id }
  const requestVersions = useRef({ project: 0, assets: 0, twins: 0 })
  const twinSaveLock = useRef(false)
  const liveLock = useRef(false)
  const transcriptVersions = useRef<Record<string, number>>({})
  const twinDirtyRef = useRef(twinDirty); twinDirtyRef.current = twinDirty
  const twinHasUnsaved = twinDirty || Object.values(pendingTwinEditors).some(Boolean)
  const onPendingTwinChange = useCallback((editor: string, pending: boolean) => setPendingTwinEditors(value => value[editor] === pending ? value : { ...value, [editor]: pending }), [])
  const draftOwner = useRef(user?.id)
  useEffect(() => {
    if (draftOwner.current === user?.id) return
    draftOwner.current = user?.id
    const draft: TwinDraft = { id: '', name: '', role: user?.role || '投资经理', rules: '', cases: '' }
    setTwinDraft(draft); setSavedTwinDraft(draft); setBuilderDraft(emptyTwinBuilderDraft())
    setSelectedTwinId(''); setNewTwinRequestId(''); setBuildUploads({}); setPendingTwinEditors({}); setPendingTwinNavigation(null)
    setTwins([]); setPublicTwins([]); setTwinAssets([]); setLearningCandidates([]); setTwinSkills([]); setSkillImports([])
    context.current.selectedTwinId = ''; context.current.newTwinRequestId = ''; requestVersions.current.twins++; requestVersions.current.assets++
  }, [user?.id])
  const recoverableEdits = twinDirty || Boolean(builderDraft.message.trim() || builderDraft.proposal)
  const recovery = useTwinDraftRecovery(preview ? '' : user?.id || '', recoverableEdits && (selectedTwinId || newTwinRequestId) ? { draft: twinDraft, draftId: selectedTwinId || newTwinRequestId, builder: builderDraft } : null)
  useTwinLeaveGuard(savingTwin || Boolean(pendingTwinEditors.library || pendingTwinEditors.builderTask || pendingTwinEditors.inquiry) || (twinHasUnsaved && !recovery.currentStored), pendingTwinEditors.inquiry ? '询问补充尚未保存，离开会丢失这些文字。请先保存或复制留存。确定离开吗？' : undefined)
  const changeWorkspace = (next: typeof active) => {
    if (next === active) return
    if (active === 'assets' && (savingTwin || Object.values(pendingTwinEditors).some(Boolean))) { showToast('请先采纳或放弃当前建议，并处理未发送内容，再切换工作区', 'error'); return }
    setActive(next)
  }

  useEffect(() => {
    if (preview) return
    setDueDiligenceContext(project
      ? buildSaiDueDiligenceSnapshot({
        projectName: project.name,
        activeTab: active,
        questions: questions.filter(item => item.projectId === project.id),
        interviews: interviews.filter(item => item.projectId === project.id),
        files: files.filter(item => item.projectId === project.id),
        loading: loadingProject,
      })
      : '\n【当前尽调工作台没有已选中的可访问项目】',
    project ? { id: project.id, name: project.name } : null)
  }, [preview, project?.id, project?.name, active, questions, interviews, files, loadingProject, setDueDiligenceContext])
  useEffect(() => () => setDueDiligenceContext('', null), [setDueDiligenceContext])

  const loadWorkspace = useCallback(async (quiet = false) => {
    if (!projectId || preview) return
    if (context.current.projectId !== projectId) return
    const request = ++requestVersions.current.project
    if (!quiet) setLoadingProject(true)
    try {
      const [questionData, interviewData, memberData] = await Promise.all([
        apiGet<{ list: Question[] }>(`/due-diligence/projects/${projectId}/questions`),
        apiGet<{ list: Interview[]; prompts: Array<{ interviewId: string; list: InterviewPrompt[] }>; artifacts: Array<{ interviewId: string; list: InterviewArtifact[] }>; transcripts: InterviewTranscript[] }>(`/due-diligence/projects/${projectId}/interviews`),
        apiGet<{ list: Member[] }>(`/due-diligence/projects/${projectId}/members`),
      ])
      if (context.current.projectId !== projectId || request !== requestVersions.current.project) return
      setProjectError(''); setQuestions(questionData.list); setInterviews(interviewData.list); setMembers(memberData.list)
      setPrompts(Object.fromEntries(interviewData.prompts.map(item => [item.interviewId, item.list])))
      setArtifacts(Object.fromEntries(interviewData.artifacts.map(item => [item.interviewId, item.list])))
      setTranscripts(Object.fromEntries(interviewData.transcripts.map(item => [item.interviewId, item])))
      transcriptVersions.current = Object.fromEntries(interviewData.transcripts.map(item => [item.interviewId, item.version]))
      setSelectedInterviewId(current => interviewData.list.some(item => item.id === current) ? current : (interviewData.list[0]?.id || ''))
    } catch (error) { if (context.current.projectId === projectId && request === requestVersions.current.project) { setProjectError((error as Error).message); if (!quiet) showToast(`加载尽调项目失败：${(error as Error).message}`, 'error') } }
    finally { if (context.current.projectId === projectId && request === requestVersions.current.project) setLoadingProject(false) }
  }, [preview, projectId, showToast])

  const loadTwins = useCallback(async (preferredId?: string) => {
    if (preview) return
    const request = ++requestVersions.current.twins
    const selection = context.current.selectedTwinId
    try {
      const list = (await apiGet<{ list: Twin[] }>('/due-diligence/twins')).list
      if (request !== requestVersions.current.twins) return
      setTwins(list)
      if (selection !== context.current.selectedTwinId || context.current.newTwinRequestId || twinDirtyRef.current) return
      const id = preferredId || context.current.selectedTwinId || list[0]?.id || ''
      if (id) {
        const twin = list.find(item => item.id === id) || list[0]; if (twin) { const draft = { id: twin.id, expectedVersion: twin.activeVersion, name: twin.name, role: twin.role, rules: twin.rules, cases: twin.cases, description: twin.description, descriptionMode: twin.descriptionMode, avatarPreset: twin.avatarPreset, avatarDataUrl: null }; setSelectedTwinId(twin.id); setTwinDraft(draft); setSavedTwinDraft(draft) }
      }
    } catch (error) { showToast(`加载数字分身失败：${(error as Error).message}`, 'error') }
  }, [preview, selectedTwinId, newTwinRequestId, showToast])
  const loadPublicTwins = useCallback(async () => { if (preview) return; try { setPublicTwins((await apiGet<{ list: PublicTwin[] }>('/due-diligence/twin-directory')).list) } catch (error) { showToast(`加载公司分身失败：${(error as Error).message}`, 'error') } }, [preview, showToast])
  const loadTwinDetails = useCallback(async (twinId: string) => {
    if (!twinId || preview) { setTwinAssets([]); setLearningCandidates([]); setTwinSkills([]); setSkillImports([]); return }
    if (context.current.selectedTwinId !== twinId) return
    const request = ++requestVersions.current.assets
    try { const data = await apiGet<{ apiVersion: number; assets: TwinAsset[]; candidates: LearningCandidate[]; skills: TwinSkill[]; imports: TwinSkillImport[] }>(`/due-diligence/twins/${twinId}/skill-library`); if (context.current.selectedTwinId !== twinId || request !== requestVersions.current.assets) return; setAssetError(''); setTwinAssets(data.assets); setLearningCandidates(data.candidates); setTwinSkills(data.skills); setSkillImports(data.imports) } catch (error) { if (context.current.selectedTwinId === twinId && request === requestVersions.current.assets) setAssetError(`数字分身资料加载失败：${(error as Error).message}`) }
  }, [preview, showToast])

  useEffect(() => { if (preview) { setQuestions([{ id: crypto.randomUUID(), projectId, title: '核实前五大客户收入确认与回款依据', category: '财务', priority: '高', status: '待核查', evidenceRequirement: '核对合同、验收、发票和回款。', assigneeName: '陈晨', fileId: demoFile.id, fileIds: [demoFile.id], source: '标准模板', version: 1, createdAt: new Date().toISOString() }]); return } void loadWorkspace() }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (preview) return; void loadTwins(); void loadPublicTwins(); void apiGet<{ list: ImportableSource[] }>('/due-diligence/twins/importable-sources').then(data => setSources(data.list)).catch(error => showToast(`读取知识库来源失败：${(error as Error).message}`, 'error')); void apiGet<{ list: PlatformSkill[] }>('/ai/prompt-library?kind=skill').then(data => setPlatformSkills(data.list)).catch(() => setPlatformSkills([])); void apiGet<CapabilityStatus>('/due-diligence/capabilities').then(result => { setCapabilities(result); if (result.apiVersion < 2 || !result.database.ready) setCapabilityError('平台服务正在升级，请等待后端与数据库更新完成') }).catch(error => setCapabilityError((error as Error).message)); void apiPost('/due-diligence/capabilities/write-probe', {}).then(() => { setWriteProbeReady(true); setWriteProbeError('') }).catch(error => { setWriteProbeReady(false); setWriteProbeError((error as Error).message) }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setTwinAssets([]); setLearningCandidates([]); setTwinSkills([]); setSkillImports([]); setAssetError(''); if (selectedTwinId) void loadTwinDetails(selectedTwinId) }, [selectedTwinId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (preview || active !== 'assets' || !selectedTwinId) return; const timer = window.setInterval(() => void loadTwinDetails(selectedTwinId), 5000); return () => clearInterval(timer) }, [active,selectedTwinId,preview,loadTwinDetails])
  useEffect(() => {
    if (preview || active !== 'questions' || !projectFiles.some(file => file.parseStatus === '解析中' || file.parseStatus === '待处理')) return
    let live = true; let pending = false
    const timer = window.setInterval(async () => {
      if (pending) return; pending = true
      try { const result = await apiGet<{list:ProjectFile[]}>(`/projects/${projectId}/files`); if (live && context.current.projectId === projectId) useAppStore.setState(state => ({files:[...state.files.filter(file => file.projectId !== projectId),...result.list]})) } catch (error) { if (live) setProjectError(`材料解析状态读取失败：${(error as Error).message}`) } finally { pending = false }
    }, 5000)
    return () => { live = false; clearInterval(timer) }
  }, [preview, active, projectId, projectFiles])

  const switchProject = (id: string) => {
    if (recordingActive) { showToast('访谈有进行中的操作或未保存文字，请先保存、结束或放弃再切换项目', 'error'); return }
    context.current.projectId = id; requestVersions.current.project++
    transcriptVersions.current = {}; setProjectError(''); setMembers([]); setRecordingOwnerId(''); setQuestions([]); setInterviews([]); setPrompts({}); setArtifacts({}); setTranscripts({}); setJobs({}); setSelectedInterviewId(''); setSearchParams(id ? { project: id } : {})
  }
  const uploadProjectFile = async (file: Blob, name: string, type: string, category: string) => {
    if (preview) return null
    const result = await apiPost<{ file: ProjectFile }>('/projects/files/upload', { projectId, name, type, category, uploader: user?.name || '尽调工作台', visibility: '项目成员', dataBase64: await fileToDataUrl(file) })
    useAppStore.setState(state => ({ files: [result.file, ...state.files.filter(item => item.id !== result.file.id)] })); return result.file
  }

  const createQuestion = async (value: { title: string; category: string; priority: '高' | '中' | '低'; evidenceRequirement: string; assigneeUserId: string; assigneeName: string; fileIds: string[] }) => {
    if (preview) { setQuestions(items => [{ id: crypto.randomUUID(), projectId, ...value, status: '待核查', fileId: value.fileIds[0] || null, source: '演示创建', version: 1, createdAt: new Date().toISOString() }, ...items]); return }
    await apiPost(`/due-diligence/projects/${projectId}/questions`, value); await loadWorkspace(true); showToast('核查问题已创建')
  }
  const updateQuestionStatus = async (question: Question, status: Question['status']) => { if (preview) { setQuestions(items => items.map(item => item.id === question.id ? { ...item, status } : item)); return } await apiPatch(`/due-diligence/projects/${question.projectId}/questions/${question.id}`, { status, expectedVersion: question.version }); await loadWorkspace(true) }
  const deleteQuestion = async (question: Question) => { if (preview) { setQuestions(items => items.filter(item => item.id !== question.id)); return } await apiDelete(`/due-diligence/projects/${question.projectId}/questions/${question.id}`); await loadWorkspace(true); showToast('核查问题已删除') }
  const updateQuestion = async (question: Question, patch: QuestionEdit) => {
    if (preview) { setQuestions(items => items.map(item => item.id === question.id ? {...item,...patch,version:item.version + 1} : item)); return }
    await apiPatch(`/due-diligence/projects/${question.projectId}/questions/${question.id}`, {...patch,expectedVersion:question.version,twinId:selectedTwinId || undefined}); await loadWorkspace(true)
  }
  const batchAssign = async (items: Question[], assigneeUserId: string | null) => {
    const assigneeName = members.find(item => item.id === assigneeUserId)?.name || ''
    try { for (const question of items) {
      if (preview) setQuestions(values => values.map(item => item.id === question.id ? {...item,assigneeUserId,assigneeName,version:item.version + 1} : item))
      else await apiPatch(`/due-diligence/projects/${question.projectId}/questions/${question.id}`, {assigneeUserId,assigneeName,expectedVersion:question.version,twinId:selectedTwinId || undefined})
    } } finally { await loadWorkspace(true) }
  }
  const applyQuestions = async (packId: string, decisions: QuestionApplyDecision[]) => {
    const result = await apiPost<{created:number;merged:number;skipped:number}>(`/due-diligence/projects/${projectId}/question-packs/${packId}/apply`, {decisions}); await loadWorkspace(true); return result
  }
  const retryParse = async (file: ProjectFile) => {
    await apiPost(`/due-diligence/projects/${file.projectId}/materials/${file.id}/retry-parse`, {})
    useAppStore.setState(state => ({files:state.files.map(item => item.id === file.id ? {...item,parseStatus:'解析中' as const} : item)}))
    showToast('已提交解析重试')
  }
  const reorderQuestions = async (ids: string[]) => { if (preview) { setQuestions(ids.map(id => questions.find(item => item.id === id)!).filter(Boolean)); return } await apiPost(`/due-diligence/projects/${projectId}/questions/reorder`, { ids }); await loadWorkspace(true) }
  const generateQuestions = async (value: { fileIds: string[]; publicationIds: string[]; mode: 'auto' | 'baseline' | 'ai'; twinId?:string;useSkills?:boolean }) => { const result = await apiPost<QuestionPack & { created: number }>(`/due-diligence/projects/${projectId}/question-packs/generate`, value); await loadWorkspace(true); showToast(result.warning || `已加入 ${result.created} 条待核查问题`); return result }
  const uploadQuestionMaterial = async (file: File) => { try { const uploaded = await uploadProjectFile(file, file.name, file.name.split('.').pop()?.toUpperCase() || 'FILE', '尽调补充材料'); if (uploaded) showToast(`“${file.name}”已上传`); return uploaded } catch (error) { showToast(`上传失败：${(error as Error).message}`, 'error'); return null } }

  const createInterview = async () => {
    if (!projectId || !interviewForm.title.trim()) return showToast('请填写访谈名称', 'error')
    if (preview) { const row: Interview = { id: crypto.randomUUID(), projectId, ...interviewForm, scheduledAt: interviewForm.scheduledAt || null, status: '筹备中', notes: '', summary: '', version: 1 }; setInterviews(items => [row, ...items]); setSelectedInterviewId(row.id); setShowInterview(false); return }
    const row = await apiPost<Interview>(`/due-diligence/projects/${projectId}/interviews`, { ...interviewForm, scheduledAt: interviewForm.scheduledAt || null }); setInterviewForm(emptyInterview); setShowInterview(false); await loadWorkspace(true); if (context.current.projectId === row.projectId) setSelectedInterviewId(row.id); showToast('访谈已创建')
  }
  const saveInterview = async (interview: Interview, patch: Partial<Interview>) => {
    const allowed = { title: patch.title, mode: patch.mode, status: patch.status, scheduledAt: patch.scheduledAt, agenda: patch.agenda, notes: patch.notes, summary: patch.summary, summaryTranscriptVersion: patch.summaryTranscriptVersion, counterparty: patch.counterparty, location: patch.location, participantNames: patch.participantNames }
    const body = Object.fromEntries(Object.entries(allowed).filter(([, value]) => value !== undefined))
    if (preview) { const next = { ...interview, ...body, version: interview.version + 1 } as Interview; setInterviews(items => items.map(item => item.id === interview.id ? next : item)); return next }
    try { const row = await apiPatch<Interview>(`/due-diligence/projects/${interview.projectId}/interviews/${interview.id}`, { ...body, expectedVersion: interview.version }); await loadWorkspace(true); showToast('访谈安排已保存'); return row } catch (error) { showToast(`保存访谈失败：${(error as Error).message}`, 'error'); return null }
  }
  const deleteInterview = async (interview: Interview) => { if (!window.confirm(`确认删除访谈“${interview.title}”？`)) return; if (!preview) await apiDelete(`/due-diligence/projects/${interview.projectId}/interviews/${interview.id}`); setSelectedInterviewId(''); await loadWorkspace(true) }
  const reorderInterviews = async (ids: string[]) => { if (preview) { setInterviews(ids.map(id => interviews.find(item => item.id === id)!).filter(Boolean)); return } await apiPost(`/due-diligence/projects/${projectId}/interviews/reorder`, { ids }); await loadWorkspace(true) }
  const saveTranscript = async (interview: Interview, content: string, status: '草稿' | '已确认', expectedVersion?: number | null) => {
    if (preview) { const row: InterviewTranscript = { id: crypto.randomUUID(), interviewId: interview.id, content, source: 'manual', status, version: (transcripts[interview.id]?.version || 0) + 1, updatedAt: new Date().toISOString() }; setTranscripts(value => ({ ...value, [interview.id]: row })); return row }
    const row = await apiPut<InterviewTranscript>(`/due-diligence/projects/${interview.projectId}/interviews/${interview.id}/transcript`, { content, source: 'manual', status, expectedVersion: expectedVersion ?? null })
    if (context.current.projectId === interview.projectId) { transcriptVersions.current[interview.id] = row.version; setTranscripts(value => ({ ...value, [interview.id]: row })) }; return row
  }
  const loadLive = useCallback(async (interviewId = selectedInterview?.id) => {
    if (!projectId || !interviewId || preview || liveLock.current) return
    liveLock.current = true
    try {
      const [promptData, jobData, transcriptData] = await Promise.all([
        apiGet<{ list: InterviewPrompt[] }>('/due-diligence/projects/' + projectId + '/interviews/' + interviewId + '/prompts'),
        apiGet<{ list: TranscriptionJob[] }>('/due-diligence/projects/' + projectId + '/interviews/' + interviewId + '/transcriptions'),
        apiGet<{ changed: boolean; transcript: InterviewTranscript | null; recordingSession: {ownerUserId:string;status:string} | null; interviewVersion:number;artifacts:InterviewArtifact[] }>('/due-diligence/projects/' + projectId + '/interviews/' + interviewId + '/transcript?afterVersion=' + (transcriptVersions.current[interviewId] || 0)),
      ])
      if (context.current.projectId !== projectId || context.current.interviewId !== interviewId) return
      setPrompts(value => ({ ...value, [interviewId]: promptData.list })); setJobs(value => ({ ...value, [interviewId]: jobData.list }))
      setArtifacts(value => ({...value,[interviewId]:transcriptData.artifacts}))
      setInterviews(value => value.map(item => item.id === interviewId ? {...item,version:transcriptData.interviewVersion} : item))
      setRecordingOwnerId(transcriptData.recordingSession && ['recording','paused','finalizing'].includes(transcriptData.recordingSession.status) ? transcriptData.recordingSession.ownerUserId : '')
      const row = transcriptData.transcript
      if (transcriptData.changed && row && row.version > (transcriptVersions.current[interviewId] || 0)) {
        transcriptVersions.current[interviewId] = row.version; setTranscripts(value => ({...value,[interviewId]:row}))
      }
    } finally { liveLock.current = false }
  }, [projectId, selectedInterview?.id, preview])
  const startAsr = async (interview: Interview, recordingFileId: string, browserText: string, transcriptVersion?: number | null) => {
    const row = await apiPost<TranscriptionJob>(`/due-diligence/projects/${interview.projectId}/interviews/${interview.id}/transcriptions`, { recordingFileId, browserText, sourceTranscriptVersion: transcriptVersion ?? null })
    setJobs(value => ({ ...value, [interview.id]: [row, ...(value[interview.id] || []).filter(item => item.id !== row.id)] })); return row
  }
  const retryAsr = async (interview: Interview, job: TranscriptionJob) => {
    const row = await apiPost<TranscriptionJob>(`/due-diligence/projects/${interview.projectId}/interviews/${interview.id}/transcriptions/${job.id}/retry`)
    setJobs(value => ({ ...value, [interview.id]: [row, ...(value[interview.id] || []).filter(item => item.id !== row.id)] }))
  }
  const generateSummary = async (interview: Interview, transcriptVersion: number) => {
    if (preview) throw new Error('前端演示模式不调用模型。请登录正式平台，使用已保存的转写生成纪要。')
    return apiPost<{ summary: string; transcriptVersion: number }>(`/due-diligence/projects/${interview.projectId}/interviews/${interview.id}/summary/generate`, { transcriptVersion })
  }
  const archiveText = async (interview: Interview, kind: '转写稿' | '访谈纪要', content: string) => {
    try {
      await apiPost('/due-diligence/projects/' + interview.projectId + '/interviews/' + interview.id + '/archive', {kind: kind === '转写稿' ? 'transcript' : 'summary', content, sourceVersion: transcriptVersions.current[interview.id]})
      await loadWorkspace(true); showToast(kind + '已保存到项目材料')
    } catch (error) { showToast('归档失败：' + (error as Error).message, 'error') }
  }
  const uploadSummary = async (interview: Interview, source: File) => { try { const file = await uploadProjectFile(source, source.name, source.name.split('.').pop()?.toUpperCase() || 'FILE', '访谈纪要'); if (!file) return; await apiPost(`/due-diligence/projects/${interview.projectId}/interviews/${interview.id}/artifacts`, { fileId: file.id, kind: '纪要', source: 'manual' }); await loadWorkspace(true) } catch (error) { showToast(`上传纪要失败：${(error as Error).message}`, 'error') } }
  const removeMaterial = async (artifact: InterviewArtifact) => { if (!selectedInterview || !window.confirm(`仅从当前访谈移除“${artifact.name}”？`)) return; await apiDelete(`/due-diligence/projects/${projectId}/interviews/${selectedInterview.id}/artifacts/${artifact.id}`); await loadWorkspace(true) }
  const sendPrompt = async (interview: Interview, content: string, questionId?: string) => { await apiPost('/due-diligence/projects/' + interview.projectId + '/interviews/' + interview.id + '/prompts', { content, questionId }); await loadLive(interview.id) }
  const confirmPrompt = async (interview: Interview, prompt: InterviewPrompt, status: InterviewPrompt['status'], response = '') => { await apiPatch('/due-diligence/projects/' + interview.projectId + '/interviews/' + interview.id + '/prompts/' + prompt.id, { status, response }); await loadLive(interview.id) }
  const deletePrompt = async (interview: Interview, prompt: InterviewPrompt) => {
    if (!window.confirm(`确认删除已忽略的插问“${prompt.content}”？`)) return
    if (preview) { setPrompts(value => ({ ...value, [interview.id]: (value[interview.id] || []).filter(item => item.id !== prompt.id) })); return }
    try { await apiDelete(`/due-diligence/projects/${interview.projectId}/interviews/${interview.id}/prompts/${prompt.id}`); await loadLive(interview.id); showToast('已删除忽略的远程插问') } catch (error) { showToast(`删除远程插问失败：${(error as Error).message}`, 'error') }
  }

  const navigateTwin = (action: () => void) => {
    if (savingTwin) return
    if (twinHasUnsaved) { setPendingTwinNavigation(() => action); return }
    action()
  }
  const restoreTwinDraft = async (asCopy = false) => {
    const content = recovery.pending?.content
    if (!content || restoringDraft) return
    if (recordingActive) { showToast('请先保存转写或结束当前录音，再恢复分身草稿', 'error'); return }
    setRestoringDraft(true)
    try {
      // Recheck current access/version; a browser backup is not an authority.
      const list = (await apiGet<{ list: Twin[] }>('/due-diligence/twins')).list
      const original = list.find(item => item.id === content.draft.id)
      if (!asCopy && content.draft.id && (!original || original.activeVersion !== content.draft.expectedVersion)) throw new Error('原分身已变更或删除。请恢复为新分身，现有版本不会被覆盖。')
      const draft = asCopy ? { ...content.draft, id: '', expectedVersion: undefined, name: `${content.draft.name}（恢复草稿）`.slice(0, 64), assetAdoptions: [] } : content.draft
      const requestId = draft.id ? '' : asCopy ? crypto.randomUUID() : content.draftId
      context.current.selectedTwinId = draft.id; context.current.newTwinRequestId = requestId
      twinDirtyRef.current = true; requestVersions.current.twins++
      setTwins(list); setSelectedTwinId(draft.id); setNewTwinRequestId(requestId)
      setTwinDraft(draft)
      setSavedTwinDraft(original && !asCopy ? { id: original.id, expectedVersion: original.activeVersion, name: original.name, role: original.role, rules: original.rules, cases: original.cases, description: original.description, descriptionMode: original.descriptionMode, avatarPreset: original.avatarPreset, avatarDataUrl: null } : null)
      setBuilderDraft(asCopy ? { ...content.builder, proposalAsset: null } : content.builder)
      setBuilderEpoch(value => value + 1); setPendingTwinEditors({}); setBuildUploads({})
      setActive('assets'); recovery.dismiss()
      showToast('已恢复到编辑区；核对并保存后才会成为正式分身')
    } catch (error) { showToast(`草稿未恢复：${(error as Error).message}`, 'error') }
    finally { setRestoringDraft(false) }
  }
  const startNewTwin = () => navigateTwin(() => {
    setBuilderDraft(emptyTwinBuilderDraft()); setPendingTwinEditors({}); setBuildUploads(items => { const next = { ...items }; delete next[selectedTwinId]; return next })
    context.current.selectedTwinId = ''; setSelectedTwinId(''); setNewTwinRequestId(crypto.randomUUID()); const draft: TwinDraft = { id: '', name: user?.name ? `${user.name}的尽调分身` : '', role: user?.role || '投资经理', rules: '', cases: '', description: '', descriptionMode: 'auto', avatarPreset: 'robot-blue' }; setTwinDraft(draft); setSavedTwinDraft({ ...draft }); setTwinAssets([]); setLearningCandidates([]); setTwinSkills([]); setSkillImports([])
  })
  const selectTwin = (twin: Twin) => { if (twin.id === selectedTwinId) return; navigateTwin(() => { setBuilderDraft(emptyTwinBuilderDraft()); setPendingTwinEditors({}); setBuildUploads(items => { const next = { ...items }; delete next[selectedTwinId]; return next }); const draft = { id: twin.id, expectedVersion: twin.activeVersion, name: twin.name, role: twin.role, rules: twin.rules, cases: twin.cases, description: twin.description, descriptionMode: twin.descriptionMode, avatarPreset: twin.avatarPreset, avatarDataUrl: null }; setNewTwinRequestId(''); setSelectedTwinId(twin.id); setTwinDraft(draft); setSavedTwinDraft(draft); setTwinAssets([]); setLearningCandidates([]); setTwinSkills([]); setSkillImports([]); context.current.selectedTwinId = twin.id; if (!preview) void apiPost(`/due-diligence/twins/${twin.id}/select-learning-target`).then(() => loadTwins(twin.id)).catch(error => showToast(`设置学习分身失败：${(error as Error).message}`, 'error')) }) }
  const saveTwin = async () => {
    if (!twinDraft.name.trim() || twinSaveLock.current) return
    if (preview) {
      const existing = twins.find(item => item.id === twinDraft.id)
      const row: Twin = { ...twinDraft, id: existing?.id || crypto.randomUUID(), activeVersion: (existing?.activeVersion || 0) + 1, updatedAt: new Date().toISOString() }
      setTwins(items => [row, ...items.filter(item => item.id !== row.id)]); setSelectedTwinId(row.id); setNewTwinRequestId('')
      const draft = { ...twinDraft, id: row.id }; setTwinDraft(draft); setSavedTwinDraft(draft); showToast('演示数字分身已创建，刷新后还原'); return row
    }
    twinSaveLock.current = true; setSavingTwin(true)
    try { const creating = isNewTwin || !twinDraft.id; const row = creating ? await apiPost<Twin>('/due-diligence/twins', { ...twinDraft, clientRequestId: newTwinRequestId || crypto.randomUUID(), source: 'manual' }) : await apiPatch<Twin>(`/due-diligence/twins/${twinDraft.id}`, { ...twinDraft, expectedVersion: twinDraft.expectedVersion ?? selectedTwin?.activeVersion, source: 'manual' }); context.current.selectedTwinId = row.id; context.current.newTwinRequestId = ''; setNewTwinRequestId(''); setSelectedTwinId(row.id); const draft = { id: row.id, expectedVersion: row.activeVersion, name: row.name, role: row.role, rules: row.rules, cases: row.cases, description: row.description, descriptionMode: row.descriptionMode, avatarPreset: row.avatarPreset, avatarDataUrl: null }; setTwinDraft(draft); setSavedTwinDraft(draft); await loadTwins(row.id); await loadTwinDetails(row.id); showToast(creating ? '数字分身已创建' : '数字分身新版本已保存'); return row } catch (error) { showToast(`保存数字分身失败：${(error as Error).message}`, 'error') } finally { twinSaveLock.current = false; setSavingTwin(false) }
  }
  const deleteTwin = async (twin: Twin) => { if (!window.confirm(`确认删除“${twin.name}”？`)) return; await apiDelete(`/due-diligence/twins/${twin.id}`); setBuilderDraft(emptyTwinBuilderDraft()); setPendingTwinEditors({}); setSelectedTwinId(''); setSavedTwinDraft(null); setTwinDraft({ id: '', name: '', role: user?.role || '投资经理', rules: '', cases: '' }); await loadTwins(); await loadPublicTwins() }
  const publishTwin = async (twin: Twin, publication: {publicRules:string;publicBoundaries:string}) => { try { if (!capabilities?.database.ready || !writeProbeReady) throw new Error(writeProbeError || '平台写入能力尚未就绪'); await apiPost(`/due-diligence/twins/${twin.id}/publish`, { introduction: summarizeTwinFocus(publication.publicRules) || twin.name, confirmed: true, publicRules: publication.publicRules, publicBoundaries: publication.publicBoundaries, industryTags: [], capabilityTags: [] }); await Promise.all([loadTwins(twin.id), loadPublicTwins()]); showToast('已公开到公司分身库') } catch (error) { showToast(`公开分身失败：${(error as Error).message}`, 'error'); throw error } }
  const buildUpload = async (file: File) => {
    if (preview) throw new Error('请在完整本地平台中登录后使用材料解析')
    const twin = selectedTwin || await saveTwin()
    if (!twin) throw new Error('请先填写分身名称并创建分身')
    setBuildUploads(items => ({ ...items, [twin.id]: { name: file.name, status: 'parsing' } }))
    try {
      const text = /\.(txt|md)$/i.test(file.name) ? await file.text() : undefined
      const asset = await apiPost<TwinAsset>(`/due-diligence/twins/${twin.id}/assets`, { sourceType: '本地素材', sourceName: file.name, mimeType: file.type || 'application/octet-stream', contentText: text, dataBase64: text === undefined ? await fileToDataUrl(file) : undefined })
      await loadTwinDetails(twin.id)
      const result = await apiPost<{traits:string}>(`/due-diligence/twins/${twin.id}/assets/${asset.id}/parse`)
      setBuildUploads(items => ({ ...items, [twin.id]: { name: file.name, assetId: asset.id, status: 'ready', traits: result.traits } }))
      return result.traits
    } catch (error) {
      setBuildUploads(items => ({ ...items, [twin.id]: { name: file.name, status: 'error', error: (error as Error).message } }))
      throw error
    } finally { await loadTwinDetails(twin.id) }
  }
  const withdrawTwin = async (twin: Twin) => { try { await apiPost(`/due-diligence/twins/${twin.id}/withdraw-publication`); await Promise.all([loadTwins(twin.id), loadPublicTwins()]); showToast('已取消公开') } catch (error) { showToast(`取消公开失败：${(error as Error).message}`, 'error') } }
  const importLocalAsset = async (file: File) => { if (!selectedTwin) return; const text = /\.(txt|md)$/i.test(file.name) ? await file.text() : undefined; await apiPost(`/due-diligence/twins/${selectedTwin.id}/assets`, { sourceType: '本地素材', sourceName: file.name, mimeType: file.type || 'application/octet-stream', contentText: text, dataBase64: text === undefined ? await fileToDataUrl(file) : undefined }); await loadTwinDetails(selectedTwin.id) }
  const importSource = async (source: ImportableSource) => { if (!selectedTwin) return; await apiPost(`/due-diligence/twins/${selectedTwin.id}/assets`, { sourceType: source.sourceType, sourceName: source.name, sourceId: source.id, mimeType: 'text/plain' }); await loadTwinDetails(selectedTwin.id) }
  const parseAsset = async (asset: TwinAsset) => { if (!selectedTwin) return null; try { const result = await apiPost<{ traits: string }>(`/due-diligence/twins/${selectedTwin.id}/assets/${asset.id}/parse`); await loadTwinDetails(selectedTwin.id); showToast('已生成可编辑的判断偏好建议'); return result.traits } catch (error) { showToast(`解析失败：${(error as Error).message}`, 'error'); await loadTwinDetails(selectedTwin.id); return null } }
  const decideCandidates = async (ids: string[], decision: '确认' | '拒绝') => { if (!selectedTwin) return; for (const id of ids) await apiPost(`/due-diligence/twins/${selectedTwin.id}/learning-candidates/${id}/decision`, { decision }); await loadTwins(selectedTwin.id); await loadTwinDetails(selectedTwin.id); showToast(`已${decision === '确认' ? '采纳' : '排除'} ${ids.length} 条经验`) }
  const updateCandidate = async (id: string, patch: {rules:string;boundaries:string;rationale:string;topic:string}) => { if (!selectedTwin) return; await apiPatch(`/due-diligence/twins/${selectedTwin.id}/learning-candidates/${id}`, patch); await loadTwinDetails(selectedTwin.id) }
  const excludeImport = async (id: string) => { if (!selectedTwin) return; await apiPatch(`/due-diligence/twins/${selectedTwin.id}/skill-imports/${id}`, {decision:'排除'}); await loadTwinDetails(selectedTwin.id) }
  const assetDecision = async (asset: TwinAsset, decision: '采纳'|'排除', traits?:string, target?:'preference'|'skill') => {
    if (!selectedTwin || asset.twinId !== selectedTwin.id) return
    if (decision === '采纳' && target === 'preference') {
      if (!traits?.trim() || !asset.traitSuggestion) throw new Error('请先解析并核对素材建议')
      setTwinDraft(draft => draft.id === asset.twinId ? stageTwinAsset(draft, { assetId: asset.id, traits, expectedSuggestion: asset.traitSuggestion! }) : draft)
      showToast('已加入偏好草稿，保存分身后生效'); return
    }
    await apiPost(`/due-diligence/twins/${selectedTwin.id}/assets/${asset.id}/decision`, {decision,traits,target}); await loadTwins(); await loadTwinDetails(selectedTwin.id)
  }
  const importSkillFiles = async (files: FileList | File[], sourceType: '本机文件夹' | '平台Skill库' = '本机文件夹') => { if (!selectedTwin) return; for (const file of Array.from(files)) { if (!/\.(md|txt|json|ya?ml)$/i.test(file.name)) { showToast(`已跳过不支持的文件：${file.name}`, 'error'); continue }; await apiPost(`/due-diligence/twins/${selectedTwin.id}/skill-imports`, { sourceType, sourceName: file.name, relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || undefined, content: await file.text() }) }; await loadTwinDetails(selectedTwin.id) }
  const importGithubSkill = async (url: string) => { if (!selectedTwin) return; await apiPost(`/due-diligence/twins/${selectedTwin.id}/skill-imports/github`, { url }); await loadTwinDetails(selectedTwin.id) }
  const learnSkill = async (id: string) => {
    if (!selectedTwin) return
    const result = await apiPost<{ generationMode: 'ai' | 'baseline'; warning: string | null }>(`/due-diligence/twins/${selectedTwin.id}/skill-imports/${id}/learn`)
    await loadTwins(); await loadTwinDetails(selectedTwin.id)
    showToast(result.warning || (result.generationMode === 'ai' ? '已由平台模型整理并加入当前分身的私有 Skill 库' : '该 Skill 已加入当前分身的私有能力'))
  }
  const importPlatformSkill = async (item: PlatformSkill) => { if (!selectedTwin) return; const detail = item.markdown ? item : await apiGet<PlatformSkill>(`/ai/prompt-library/${item.id}`); await apiPost(`/due-diligence/twins/${selectedTwin.id}/skill-imports`, { sourceType: '平台Skill库', sourceName: detail.name, sourceUrl: `platform:${item.id}`, content: detail.markdown || '' }); await loadTwinDetails(selectedTwin.id) }
  const toggleSkill = async (skill: TwinSkill) => { if (!selectedTwin) return; await apiPatch(`/due-diligence/twins/${selectedTwin.id}/skills/${skill.id}`, { enabled: skill.status !== '已生效' }); await loadTwins(); await loadTwinDetails(selectedTwin.id) }

  return <div className="space-y-5">
    {recovery.pending?.content && <Card className="space-y-3 border-amber-200 p-4"><h2 className="font-semibold">找到未保存的分身草稿</h2><p className="text-sm text-slate-600">{recovery.pending.content.draft.name || '未命名分身'} · {new Date(recovery.pending.updatedAt).toLocaleString('zh-CN')}。包含未发送文字及尚未采纳的建议，仅在此浏览器暂存，7 天内可恢复。</p><div className="flex flex-wrap gap-2"><Button disabled={restoringDraft || recordingActive} onClick={() => void restoreTwinDraft()}>{restoringDraft ? '核对中…' : '恢复草稿'}</Button><Button variant="secondary" disabled={restoringDraft || recordingActive} onClick={() => void restoreTwinDraft(true)}>恢复为新分身</Button><Button variant="secondary" disabled={restoringDraft} onClick={() => { if (window.confirm('删除此浏览器的恢复草稿？已保存的分身、对话和材料不受影响。')) recovery.dismiss() }}>丢弃恢复草稿</Button></div></Card>}
    {active === 'assets' && !recovery.ready && <p role="status" className="text-sm text-slate-600">正在检查未保存草稿…</p>}
    {active === 'assets' && recovery.error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{recovery.error}。当前编辑仍可继续，但请先保存或复制文字后再离开。</p>}
    {active === 'assets' && !recovery.pending && !recovery.error && recovery.savedAt > 0 && <p role="status" className="text-xs text-slate-600">{recovery.writing ? '正在暂存恢复草稿…' : `恢复草稿已暂存于此浏览器 · ${new Date(recovery.savedAt).toLocaleTimeString('zh-CN')}，尚未保存为正式分身。`}</p>}
    <Modal open={Boolean(pendingTwinNavigation)} title="分身有未保存内容" onClose={() => setPendingTwinNavigation(null)} footer={<><Button variant="secondary" onClick={() => setPendingTwinNavigation(null)}>继续编辑</Button><Button onClick={() => { const action = pendingTwinNavigation; setPendingTwinNavigation(null); action?.() }}>放弃并切换</Button></>}><p className="text-sm text-slate-600">当前草稿、尚未采纳的建议或未发送内容还没有保存。切换会放弃这些修改，原始材料和已保存版本不受影响。</p></Modal>
    {preview && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">当前为前端演示模式，操作不会写入数据库。</div>}
    <PageHeader title="尽调工作台" description="生成专业清单、协同现场核验，让数字分身沉淀并应用判断经验。" actions={active === 'assets' || !projects.length ? undefined : <select className="input w-64" value={projectId} onChange={event => switchProject(event.target.value)}>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>} />
    {!preview && administrator && <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm text-slate-500">管理员诊断</summary><div className="mt-3 flex flex-wrap gap-2 text-xs">{capabilities && <><Badge tone={capabilities.database.ready ? 'green' : 'red'}>数据库{capabilities.database.ready ? '就绪' : '待迁移'}</Badge><Badge tone={capabilities.models.document.ready ? 'green' : 'amber'}>文档模型{capabilities.models.document.ready ? '就绪' : '未配置'}</Badge><Badge tone={capabilities.models.interactive.ready ? 'green' : 'amber'}>分身模型{capabilities.models.interactive.ready ? '就绪' : '未配置'}</Badge><Badge tone={capabilities.asr.configured ? 'green' : 'amber'}>后台转写{capabilities.asr.configured ? '就绪' : '未配置'}</Badge><Badge tone={writeProbeError ? 'red' : writeProbeReady ? 'green' : 'amber'}>写入来源{writeProbeError ? '异常' : writeProbeReady ? '正常' : '检查中'}</Badge></>}{capabilityError && <span className="text-rose-600">{capabilityError}</span>}{writeProbeError && <span className="text-rose-600">当前地址无法保存：{writeProbeError}</span>}</div></details>}
    {!preview && !administrator && (capabilityError || writeProbeError) && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{writeProbeError ? '当前地址暂时无法保存，请使用正式平台地址或联系管理员。' : capabilityError}</p>}
    <div className="flex flex-wrap gap-2 border-b border-slate-200"><Tab active={active === 'questions'} onClick={() => { if (recordingActive) return showToast('请先保存转写或结束当前操作，再切换工作区', 'error'); changeWorkspace('questions') }} icon={<ClipboardList className="h-4 w-4" />}>尽调清单</Tab><Tab active={active === 'interviews'} onClick={() => changeWorkspace('interviews')} icon={<UsersRound className="h-4 w-4" />}>现场协同</Tab><Tab active={active === 'assets'} onClick={() => { if (recordingActive) return showToast('请先保存转写或结束当前操作，再切换工作区', 'error'); changeWorkspace('assets') }} icon={<Bot className="h-4 w-4" />}>数字分身</Tab></div>
    {active !== 'assets' && !projects.length && <Card className="p-8 text-sm text-slate-500">当前没有可访问项目；数字分身仍可正常使用。</Card>}
    {active !== 'assets' && projectError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">项目数据加载失败：{projectError}<Button size="sm" variant="secondary" onClick={() => void loadWorkspace()}>重试</Button></p>}
    {active === 'assets' && assetError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{assetError}<Button size="sm" variant="secondary" onClick={() => void loadTwinDetails(selectedTwinId)}>重试</Button></p>}
    {active === 'questions' && projectId && <QuestionsWorkspace key={projectId} projectId={projectId} files={projectFiles} members={members} publicTwins={publicTwins} questions={questions.filter(item => item.projectId === projectId)} loading={loadingProject} defaultAssigneeId={user?.id || ''} defaultAssigneeName={user?.name || ''} twins={twins} selectedTwinId={selectedTwinId} onUpdate={updateQuestion} onBatchAssign={batchAssign} onApply={applyQuestions} onRetryParse={retryParse} onCreate={createQuestion} onStatus={updateQuestionStatus} onDelete={deleteQuestion} onReorder={reorderQuestions} onGenerate={generateQuestions} onUpload={uploadQuestionMaterial} />}
    {active === 'interviews' && projectId && <InterviewsWorkspace key={`${user?.id}/${projectId}/${selectedInterview?.id || ''}`} userId={user?.id} recordingOwnerId={recordingOwnerId} preview={preview} questions={questions.filter(item => item.projectId === projectId)} projectId={projectId} interviews={projectInterviews} selected={selectedInterview} prompts={selectedInterview ? prompts[selectedInterview.id] || [] : []} artifacts={selectedInterview ? artifacts[selectedInterview.id] || [] : []} transcript={selectedInterview ? transcripts[selectedInterview.id] : undefined} transcriptionJobs={selectedInterview ? jobs[selectedInterview.id] || [] : []} writeReady={preview || writeProbeReady} writeError={writeProbeError} asrConfigured={Boolean(capabilities?.asr.configured)} onSelect={setSelectedInterviewId} onCreate={() => { setInterviewForm(emptyInterview); setShowInterview(true) }} onSave={saveInterview} onDelete={deleteInterview} onReorder={reorderInterviews} onRemoveMaterial={removeMaterial} onUploadSummary={uploadSummary} onSaveTranscript={saveTranscript} onStartAsr={startAsr} onRetryAsr={retryAsr} onGenerateSummary={generateSummary} onArchiveText={archiveText} onSendPrompt={sendPrompt} onConfirmPrompt={confirmPrompt} onDeletePrompt={deletePrompt} onRefreshLive={loadLive} onRecordingState={setRecordingActive} />}
    {active === 'assets' && recovery.ready && !recovery.pending && <ExperienceAssetsWorkspace builderDraft={builderDraft} builderEpoch={builderEpoch} onBuilderDraft={setBuilderDraft} onPendingChange={onPendingTwinChange} preview={preview} currentUserId={user?.id || ''} twins={twins} publicTwins={publicTwins} selectedTwin={selectedTwin} draft={twinDraft} draftId={selectedTwinId || newTwinRequestId || '00000000-0000-4000-8000-000000000000'} projects={projects} onBuildUpload={buildUpload} buildUpload={buildUploads[selectedTwinId]} onBuildUploadAdopted={() => setBuildUploads(items => items[selectedTwinId]?.status === 'ready' ? { ...items, [selectedTwinId]: { ...items[selectedTwinId], status: 'adopted' } } : items)} isNew={isNewTwin} dirty={twinDirty} saving={savingTwin} assets={twinAssets} candidates={learningCandidates} skills={twinSkills} skillImports={skillImports} sources={sources} platformSkills={platformSkills} onNew={startNewTwin} onSelect={selectTwin} onDraft={setTwinDraft} onSave={saveTwin} onDelete={deleteTwin} onPublish={publishTwin} onWithdraw={withdrawTwin} onImportLocal={importLocalAsset} onImportSource={importSource} onParseAsset={parseAsset} onRefreshLearning={() => selectedTwin ? loadTwinDetails(selectedTwin.id) : Promise.resolve()} onDecideCandidates={decideCandidates} onUpdateCandidate={updateCandidate} onExcludeImport={excludeImport} onAssetDecision={assetDecision} onImportSkillFiles={importSkillFiles} onImportGithubSkill={importGithubSkill} onImportPlatformSkill={importPlatformSkill} onLearnSkill={learnSkill} onToggleSkill={toggleSkill} />}
    <Modal open={showInterview} title="新建现场访谈" onClose={() => setShowInterview(false)} footer={<><Button variant="secondary" onClick={() => setShowInterview(false)}>取消</Button><Button disabled={!interviewForm.title.trim()} onClick={() => void createInterview()}>创建访谈</Button></>}><div className="grid grid-cols-2 gap-4"><label className="col-span-2"><span className="label">访谈名称 *</span><input className="input" value={interviewForm.title} onChange={event => setInterviewForm({ ...interviewForm, title: event.target.value })} /></label><label><span className="label">形式</span><select className="input" value={interviewForm.mode} onChange={event => setInterviewForm({ ...interviewForm, mode: event.target.value as InterviewForm['mode'] })}><option>现场</option><option>远程</option></select></label><label><span className="label">计划时间</span><input className="input" type="datetime-local" value={interviewForm.scheduledAt} onChange={event => setInterviewForm({ ...interviewForm, scheduledAt: event.target.value })} /></label><label><span className="label">访谈对象/单位</span><input className="input" value={interviewForm.counterparty} onChange={event => setInterviewForm({ ...interviewForm, counterparty: event.target.value })} /></label><label><span className="label">地点</span><input className="input" value={interviewForm.location} onChange={event => setInterviewForm({ ...interviewForm, location: event.target.value })} /></label><label className="col-span-2"><span className="label">参与人（逗号分隔）</span><input className="input" value={interviewForm.participantNames.join('，')} onChange={event => setInterviewForm({ ...interviewForm, participantNames: event.target.value.split(/[，,]/).map(item => item.trim()).filter(Boolean) })} /></label><label className="col-span-2"><span className="label">访谈议程</span><textarea className="textarea min-h-28" value={interviewForm.agenda} onChange={event => setInterviewForm({ ...interviewForm, agenda: event.target.value })} /></label></div></Modal>
  </div>
}
