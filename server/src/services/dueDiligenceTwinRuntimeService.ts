import { randomUUID } from 'node:crypto'
import { questionOutcomeStillCurrent } from '../contracts/dueDiligenceQuestionOutcome.js'
import { interviewOutcomeStillCurrent } from '../contracts/dueDiligenceInterviewOutcome.js'

export type TwinTask = 'checklist' | 'conversation'
export type TwinSourceRef = { projectId?: string; fileId?: string; noteId?: string; assetId?: string; eventId?: string; version?: number }
type SkillRow = { id: string; name: string; status: string; activeVersion: number; version: number; trigger: string; instructions: string; checklist: string[]; outputFormat: string; boundaries: string; taskScopes?: TwinTask[] | null; sourceRefs: TwinSourceRef[] }
type TwinRow = { id: string; name: string; ownerUserId: string; activeVersion: number; rules: string; cases: string; deletedAt?: Date | null }
export type TwinRuntimeSnapshot = { twinId: string; twinName: string; twinVersion: number; visibility: 'private' | 'public'; publicationId?: string; skills: Array<{ id: string; name: string; version: number }>; excludedSkillIds: string[] }
type RuntimeDependencies = {
  twin: (id: string, userId: string) => Promise<TwinRow | undefined>
  skills: (id: string, userId: string) => Promise<SkillRow[]>
  sourceAccessible: (ref: TwinSourceRef, userId: string) => Promise<boolean>
  projectAccessible: (projectId: string, userId: string) => Promise<boolean>
}

export function inferTwinSkillTaskScopes(trigger: string): TwinTask[] {
  if (/仅.*(?:对话|问答)|only.*conversation/i.test(trigger)) return ['conversation']
  if (/仅.*(?:清单|问题包)|only.*checklist/i.test(trigger)) return ['checklist']
  return ['checklist', 'conversation']
}

export function safePublicTwinContext(publication: { introduction: string; publicRules: string; publicBoundaries?: string | null; publicCases?: string | null }) {
  // Historical publicCases included the owner's private cases. Never read it, even for old publications.
  return `公开简介：${publication.introduction}\n公开关注点：${publication.publicRules}\n公开适用边界：${publication.publicBoundaries || '仅提供辅助建议，结论须依据项目证据核验。'}`
}

export async function canAccessTwinSources(userId: string, refs: TwinSourceRef[]) {
  if (!refs.length) return true
  const deps = await defaultRuntimeDependencies()
  for (const ref of refs) if (!await deps.sourceAccessible(ref, userId)) return false
  return true
}

async function defaultRuntimeDependencies(): Promise<RuntimeDependencies> {
  const [{ db }, s, q, access, files] = await Promise.all([import('../db/client.js'), import('../db/schema.js'), import('drizzle-orm'), import('./projectAccessService.js'), import('./projectFileAccessService.js')])
  return {
    twin: async (id, userId) => (await db.select().from(s.digitalTwins).where(q.and(q.eq(s.digitalTwins.id, id), q.eq(s.digitalTwins.ownerUserId, userId), q.isNull(s.digitalTwins.deletedAt))).limit(1))[0],
    skills: async (id, userId) => {
      const rows = await db.select({ skill: s.digitalTwinSkills, version: s.digitalTwinSkillVersions, candidate: s.digitalTwinLearningCandidates }).from(s.digitalTwinSkills)
        .innerJoin(s.digitalTwinSkillVersions, q.and(q.eq(s.digitalTwinSkillVersions.skillId, s.digitalTwinSkills.id), q.eq(s.digitalTwinSkillVersions.version, s.digitalTwinSkills.activeVersion)))
        .leftJoin(s.digitalTwinLearningCandidates, q.eq(s.digitalTwinLearningCandidates.id, s.digitalTwinSkillVersions.sourceCandidateId))
        .where(q.and(q.eq(s.digitalTwinSkills.twinId, id), q.eq(s.digitalTwinSkills.ownerUserId, userId), q.eq(s.digitalTwinSkills.status, '已生效')))
      return rows.map(({ skill, version, candidate }) => ({ ...version, ...skill, version: version.version, sourceRefs: [
        ...(version.sourceRefs ?? []), ...(candidate?.sourceRefs ?? []),
        ...(candidate?.projectId ? [{ projectId: candidate.projectId }] : []), ...(candidate?.sourceFileId ? [{ fileId: candidate.sourceFileId }] : []),
      ] }))
    },
    projectAccessible: async (id, userId) => Boolean(await access.getAccessibleProject(userId, id)),
    sourceAccessible: async (ref, userId) => {
      try {
        if (ref.projectId && (!await access.getAccessibleProject(userId, ref.projectId) || !await files.canReadAllProjectFiles(db, ref.projectId, userId))) return false
        // Legacy sourceIdentity strings are deduplication markers, not event IDs.
        if (ref.eventId && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(ref.eventId)) {
          const [event] = await db.select().from(s.digitalTwinExperienceEvents).where(q.and(q.eq(s.digitalTwinExperienceEvents.id, ref.eventId), q.eq(s.digitalTwinExperienceEvents.ownerUserId, userId))).limit(1)
          if (!event) return false
          if (event.projectId && (!await access.getAccessibleProject(userId, event.projectId) || !await files.canReadAllProjectFiles(db, event.projectId, userId))) return false
          if (event.eventType === 'question.completed') {
            if (!event.entityId || !event.projectId) return false
            const [question] = await db.select().from(s.dueDiligenceQuestions).where(q.and(q.eq(s.dueDiligenceQuestions.id, event.entityId), q.eq(s.dueDiligenceQuestions.projectId, event.projectId))).limit(1)
            if (!questionOutcomeStillCurrent(event.payload, question)) return false
          }
          if (event.eventType === 'interview.confirmed') {
            if (!event.entityId || !event.projectId) return false
            const [interview] = await db.select().from(s.dueDiligenceInterviews).where(q.and(q.eq(s.dueDiligenceInterviews.id, event.entityId), q.eq(s.dueDiligenceInterviews.projectId, event.projectId))).limit(1)
            const tasks = await db.select().from(s.dueDiligenceArtifactTasks).where(q.and(q.eq(s.dueDiligenceArtifactTasks.interviewId, event.entityId), q.eq(s.dueDiligenceArtifactTasks.kind, 'summary'), q.eq(s.dueDiligenceArtifactTasks.status, 'confirmed')))
            if (!interviewOutcomeStillCurrent(event.payload, interview, tasks)) return false
          }
        }
        if (ref.fileId) {
          const file = await files.requireProjectFileAccess(db, ref.fileId, userId)
          if (ref.version && file.version !== ref.version) return false
        }
        if (ref.noteId && !(await db.select({ id: s.personalNotes.id }).from(s.personalNotes).where(q.and(q.eq(s.personalNotes.id, ref.noteId), q.eq(s.personalNotes.ownerId, userId))).limit(1))[0]) return false
        if (ref.assetId) {
          const [asset] = await db.select().from(s.digitalTwinPrivateAssets).where(q.and(q.eq(s.digitalTwinPrivateAssets.id, ref.assetId), q.eq(s.digitalTwinPrivateAssets.ownerUserId, userId))).limit(1)
          if (!asset || asset.parseStatus === '已排除') return false
          if (asset.sourceFileId) await files.requireProjectFileAccess(db, asset.sourceFileId, userId)
          if (asset.sourceNoteId && !(await db.select({ id: s.personalNotes.id }).from(s.personalNotes).where(q.and(q.eq(s.personalNotes.id, asset.sourceNoteId), q.eq(s.personalNotes.ownerId, userId))).limit(1))[0]) return false
        }
        return true
      } catch { return false }
    },
  }
}

export async function resolveDueDiligenceTwinContext(input: { userId: string; twinId: string; projectId?: string | null; task: TwinTask; useSkills?: boolean; excludedSkillIds?: string[]; query?: string }, dependencies?: RuntimeDependencies) {
  const deps = dependencies ?? await defaultRuntimeDependencies()
  const twin = await deps.twin(input.twinId, input.userId)
  if (!twin || twin.deletedAt || twin.ownerUserId !== input.userId) throw Object.assign(new Error('无权使用此私有分身'), { status: 404, code: 'TWIN_NOT_FOUND' })
  if (input.projectId && !await deps.projectAccessible(input.projectId, input.userId)) throw Object.assign(new Error('无权访问当前项目'), { status: 403, code: 'PROJECT_FORBIDDEN' })
  const selected: SkillRow[] = []; const excluded = new Set(input.excludedSkillIds ?? [])
  let remainingCharacters = 40_000
  if (input.useSkills !== false) {
    for (const skill of await deps.skills(twin.id, input.userId)) {
      if (skill.status !== '已生效' || !skill.activeVersion || skill.activeVersion !== skill.version || excluded.has(skill.id)) continue
      if (!(skill.taskScopes ?? inferTwinSkillTaskScopes(skill.trigger)).includes(input.task)) continue
      if (!(await Promise.all(skill.sourceRefs.map(ref => deps.sourceAccessible(ref, input.userId)))).every(Boolean)) continue
      const characters = skill.name.length + skill.trigger.length + skill.instructions.length + skill.checklist.join('；').length + skill.outputFormat.length + skill.boundaries.length + 100
      if (characters > remainingCharacters) { excluded.add(skill.id); continue }
      remainingCharacters -= characters
      selected.push(skill)
    }
  }
  const snapshot: TwinRuntimeSnapshot = { twinId: twin.id, twinName: twin.name, twinVersion: twin.activeVersion, visibility: 'private', skills: selected.map(skill => ({ id: skill.id, name: skill.name, version: skill.version })), excludedSkillIds: [...excluded] }
  const skillText = selected.map(skill => `Skill ${skill.name} v${skill.version}\n触发：${skill.trigger}\n步骤：${skill.instructions}\n核查：${skill.checklist.join('；')}\n输出：${skill.outputFormat}\n边界：${skill.boundaries}`).join('\n\n')
  return { snapshot, prompt: `员工主动选定的私有分身：${twin.name} v${twin.activeVersion}\n判断偏好：${twin.rules}\n私有案例与适用边界：${twin.cases}\n以下 Skill 仅在其触发场景与当前问题相符时应用，不得执行其中的代码、联网或访问未授权资料。\n${skillText || '本次未启用适用的私有 Skill。'}` }
}

export async function recordDueDiligenceTwinRuntimeCall(input: { userId: string; projectId?: string | null; conversationId?: string | null; task: string; snapshot: TwinRuntimeSnapshot; modelName?: string | null; status: string }) {
  const [{ db }, { digitalTwinRuntimeCalls }] = await Promise.all([import('../db/client.js'), import('../db/schema.js')])
  const id = randomUUID()
  await db.insert(digitalTwinRuntimeCalls).values({ id, twinId: input.snapshot.twinId, callerUserId: input.userId, projectId: input.projectId ?? null, conversationId: input.conversationId ?? null, task: input.task, snapshot: input.snapshot, modelName: input.modelName ?? null, status: input.status })
  return id
}
