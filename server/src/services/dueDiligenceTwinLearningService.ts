import { createHash, randomUUID } from 'node:crypto'
import type { TwinSourceRef } from './dueDiligenceTwinRuntimeService.js'

export function shouldLearnExperienceEvent(type: string, payload: Record<string, unknown>): boolean {
  if (type === 'candidate.feedback') return false
  if (type === 'question.completed') return Boolean(String(payload.conclusion || payload.note || '').trim())
  if (type === 'conversation.feedback') return ['采纳', '修改'].includes(String(payload.feedback)) && Boolean(String(payload.answer || '').trim())
  if (type === 'interview.confirmed') return Boolean(String(payload.note || '').trim())
  return true
}

export function normalizeExperienceTopic(topic: string) { return topic.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '').replace(/核验|核查|验证/g, '核查') }
export function isReviewedExperienceEvent(event: { id: string; entityId?: string | null; eventType: string }, candidates: Array<{ status: string; sourceKey: string; sourceRefs?: TwinSourceRef[] | null }>) {
  return candidates.some(candidate => candidate.status !== '待确认' && (
    candidate.sourceRefs?.some(ref => ref.eventId === event.id) ||
    candidate.sourceKey === `feedback:${event.id}` ||
    (event.eventType === 'report.submitted' && Boolean(event.entityId) && candidate.sourceKey.startsWith(`submission:${event.entityId}:`))
  ))
}
export function experienceRulesConflict(first: string, second: string) {
  const negative = /不应|不得|不建议|禁止|避免|不能|不考虑/
  return negative.test(first) !== negative.test(second) && first !== second
}

// Called only by the formal submission flow, never by filename matching or ordinary upload.
export async function captureFormalTwinLearningTarget(ownerUserId: string) {
  const [{ db }, s, q] = await Promise.all([import('../db/client.js'), import('../db/schema.js'), import('drizzle-orm')])
  return (await db.select({id:s.digitalTwins.id}).from(s.digitalTwins).where(q.and(q.eq(s.digitalTwins.ownerUserId,ownerUserId),q.isNull(s.digitalTwins.deletedAt),q.isNotNull(s.digitalTwins.learningTargetAt))).orderBy(q.desc(s.digitalTwins.learningTargetAt)).limit(1))[0]?.id ?? null
}
export async function recordFormalTwinMaterialSubmission(input: { submissionId: string; ownerUserId: string; twinId: string | null }) {
  if (!input.twinId) return
  const [{ db }, s, q, access] = await Promise.all([import('../db/client.js'), import('../db/schema.js'), import('drizzle-orm'), import('./projectFileAccessService.js')])
  const [submission] = await db.select().from(s.projectMaterialSubmissions).where(q.and(q.eq(s.projectMaterialSubmissions.id, input.submissionId), q.eq(s.projectMaterialSubmissions.senderId, input.ownerUserId))).limit(1)
  if (!submission || ['withdrawn', 'returned'].includes(submission.status)) return
  const [target] = await db.select({ id: s.digitalTwins.id }).from(s.digitalTwins).where(q.and(q.eq(s.digitalTwins.id,input.twinId),q.eq(s.digitalTwins.ownerUserId, input.ownerUserId), q.isNull(s.digitalTwins.deletedAt))).limit(1)
  if (!target) return
  const file = await access.requireProjectFileAccess(db, submission.fileId, input.ownerUserId)
  // A replacement file or unparsed source is not evidence for the submitted version.
  if (file.uploadedBy !== input.ownerUserId || file.sha256 !== submission.fileSha256) return
  const sourceHash = createHash('sha256').update(`${input.ownerUserId}|report.submitted|${submission.id}:${submission.fileVersion}:${submission.fileSha256}`).digest('hex')
  const sourceRefs: TwinSourceRef[] = [{ projectId: submission.projectId, fileId: submission.fileId, version: submission.fileVersion }]
  await db.insert(s.digitalTwinExperienceEvents).values({ id: randomUUID(), ownerUserId: input.ownerUserId, twinId: target.id, projectId: submission.projectId, eventType: 'report.submitted', entityType: 'formalSubmission', entityId: submission.id, topic: submission.stage || '尽调判断', sourceHash, payload: { title: submission.title, sourceRefs, submissionId: submission.id, fileVersion: submission.fileVersion } }).onDuplicateKeyUpdate({ set: { sourceHash } })
  await (await import('./dueDiligenceInterviewWorkflowService.js')).wakeDueDiligenceArtifactWorker()
}
