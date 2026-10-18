import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { createHash, randomUUID } from 'node:crypto'
import { AlignmentType, Document, Packer, Paragraph, TextRun } from 'docx'
import { db } from '../db/client.js'
import { dueDiligenceArtifactTasks, dueDiligenceInterviewArtifacts, dueDiligenceInterviews, dueDiligenceInterviewTranscripts, dueDiligenceQuestions, dueDiligenceRecordingChunks, dueDiligenceRecordingSessions, dueDiligenceTranscriptionJobs, projectFiles, users } from '../db/schema.js'
import { requireAccessibleProject } from './projectAccessService.js'
import { canReadAllProjectFiles, requireProjectFileAccess, requireProjectFileUpload } from './projectFileAccessService.js'
import { addFile, setFileStoragePath } from './projectService.js'
import { saveProjectFileRevision } from './projectFileStorageService.js'
import { resolveDueDiligenceModelRuntime } from './aiDueDiligenceSkillRuntimeService.js'
import { fetchAiGatewayChatCompatible } from './aiGatewayService.js'
import { getDueDiligenceAsrCapability } from './dueDiligenceAsrService.js'
import { createDueDiligenceRecordingStorage, RECORDING_LEASE_MS, recordingContainer, recordingError, splitTranscriptForSummary } from './dueDiligenceRecordingStorageService.js'
import { nextInterviewSummaryStep, parseInterviewSummaryModelResult } from './dueDiligenceSummaryService.js'

export const DUE_DILIGENCE_WORKER_ID = 'due-diligence-artifact-worker'
type Session = typeof dueDiligenceRecordingSessions.$inferSelect
type ArtifactTask = typeof dueDiligenceArtifactTasks.$inferSelect
export const leaseUntil = () => new Date(Date.now() + RECORDING_LEASE_MS)

export async function requireInterviewWorkspace(userId: string, projectId: string, interviewId: string) {
  await requireAccessibleProject(userId, projectId)
  if (!await canReadAllProjectFiles(db, projectId, userId)) throw recordingError('DUE_DILIGENCE_SOURCE_FORBIDDEN', '当前账号无法访问尽调内容的全部来源材料', 403)
  const [interview] = await db.select().from(dueDiligenceInterviews).where(and(eq(dueDiligenceInterviews.id, interviewId), eq(dueDiligenceInterviews.projectId, projectId))).limit(1)
  if (!interview) throw recordingError('NOT_FOUND', '访谈不存在', 404)
  return interview
}

export function publicRecordingSession(row: Session) {
  const { clientRequestId: _request, activeKey: _activeKey, archiveRunToken: _token, archiveLeaseExpiresAt: _archiveLease, epochs, ...rest } = row
  return { ...rest, epoch: row.currentEpoch, durationKnown: row.source === 'browser', epochs: epochs.map(epoch => ({ ...epoch })), checkpointSeconds: 30, chunkMaxBytes: 2 * 1024 * 1024, maxDurationSeconds: 8 * 60 * 60 }
}
export function publicSummaryTask(row: ArtifactTask) {
  const { sourceText: _source, actorRole: _role, chunkResults: _chunks, mergeState: _merge, runToken: _token, leaseExpiresAt: _lease, ...rest } = row
  return rest
}

export async function currentRecordingSession(interviewId: string) {
  const [session] = await db.select().from(dueDiligenceRecordingSessions).where(and(eq(dueDiligenceRecordingSessions.activeKey, interviewId), inArray(dueDiligenceRecordingSessions.status, ['recording', 'paused']))).limit(1)
  return session ?? null
}
export async function assertInterviewRecorder(userId: string, interviewId: string) {
  const session = await currentRecordingSession(interviewId)
  if (session && session.ownerUserId !== userId && session.leaseExpiresAt && session.leaseExpiresAt.getTime() > Date.now()) {
    throw recordingError('INTERVIEW_RECORDER_REQUIRED', '访谈正在由另一位员工记录，您可只读查看并发送插问', 403)
  }
}

export async function wakeDueDiligenceArtifactWorker() {
  const { queueRuntimeJobNow } = await import('./runtimeJobScheduler.js')
  // A running/temporarily unavailable scheduler does not invalidate durable enqueue.
  await queueRuntimeJobNow(DUE_DILIGENCE_WORKER_ID).catch(() => {})
}

async function linkArtifact(interviewId: string, fileId: string, kind: '录音' | '转写' | '纪要', ownerUserId: string, source: 'browser' | 'manual' | 'provider', seconds?: number) {
  await db.insert(dueDiligenceInterviewArtifacts).values({ id: randomUUID(), interviewId, fileId, kind, source, durationSeconds: seconds ?? null, createdBy: ownerUserId }).onDuplicateKeyUpdate({ set: { id: sql`${dueDiligenceInterviewArtifacts.id}` } })
}

async function reuseOrCreateFile(input: { id: string; projectId: string; userId: string; name: string; type: string; category: string; byteSize: number; sha256: string; storagePath: string; contentText?: string }) {
  const [existing] = await db.select().from(projectFiles).where(and(eq(projectFiles.projectId, input.projectId), eq(projectFiles.sha256, input.sha256), eq(projectFiles.lifecycle, 'active'))).limit(1)
  if (existing?.storagePath) { await requireProjectFileAccess(db, existing.id, input.userId); return existing.id }
  let row = existing
  if (!row) row = await addFile({ id: input.id, projectId: input.projectId, name: input.name.slice(0, 255), type: input.type, category: input.category, size: `${(input.byteSize / 1024 / 1024).toFixed(2)} MB`, byteSize: input.byteSize, sha256: input.sha256, uploader: (await db.select({ name: users.name }).from(users).where(eq(users.id, input.userId)).limit(1))[0]?.name || '访谈记录人', parseStatus: input.contentText ? '成功' : '无需解析', contentText: input.contentText ?? null, visibility: '项目成员' }, input.userId)
  if (!row) throw recordingError('FILE_ARCHIVE_FAILED', '访谈文件记录创建失败', 500)
  await setFileStoragePath(row.id, input.storagePath, input.userId)
  return row.id
}

export async function archiveInterviewText(input: { projectId: string; interviewId: string; userId: string; role: string; kind: 'transcript' | 'summary'; content: string; sourceVersion?: number | null }) {
  const interview = await requireInterviewWorkspace(input.userId, input.projectId, input.interviewId)
  await requireProjectFileUpload(db, input.projectId, input.userId)
  if (!input.content.trim()) throw recordingError('EMPTY_EXPORT', '没有可归档的文字', 400)
  const sourceHash = createHash('sha256').update(input.content).digest('hex')
  const kind = input.kind === 'transcript' ? 'archive-transcript' : 'archive-summary'
  const id = randomUUID()
  await db.insert(dueDiligenceArtifactTasks).values({ id, projectId: input.projectId, interviewId: input.interviewId, createdBy: input.userId, actorRole: input.role, kind, status: 'queued', transcriptVersion: input.sourceVersion ?? null, sourceHash, sourceText: input.content }).onDuplicateKeyUpdate({ set: { id: sql`${dueDiligenceArtifactTasks.id}` } })
  const [task] = await db.select().from(dueDiligenceArtifactTasks).where(and(eq(dueDiligenceArtifactTasks.interviewId, input.interviewId), eq(dueDiligenceArtifactTasks.kind, kind), eq(dueDiligenceArtifactTasks.sourceHash, sourceHash))).limit(1)
  if (task.archiveFileId) { await requireProjectFileAccess(db, task.archiveFileId, input.userId); return { fileId: task.archiveFileId, alreadyArchived: true } }
  const runToken = randomUUID()
  const [claimed] = await db.update(dueDiligenceArtifactTasks).set({ status: 'processing', runToken, leaseExpiresAt: new Date(Date.now() + 120_000), updatedAt: new Date() }).where(and(eq(dueDiligenceArtifactTasks.id, task.id), isNull(dueDiligenceArtifactTasks.archiveFileId), or(inArray(dueDiligenceArtifactTasks.status, ['queued', 'failed']), lt(dueDiligenceArtifactTasks.leaseExpiresAt, new Date()))))
  if (claimed.affectedRows !== 1) throw recordingError('ARCHIVE_IN_PROGRESS', '相同内容正在归档，请稍后重试')
  try {
    const label = input.kind === 'transcript' ? '访谈转写稿' : '访谈纪要'
    const children = [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${interview.title} · ${label}`, bold: true, size: 32, font: '黑体' })] }), ...input.content.split(/\r?\n/).map(text => new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text, size: 22, font: '宋体' })] }))]
    const buffer = await Packer.toBuffer(new Document({ sections: [{ children }] }))
    const fileId = randomUUID(); const storagePath = await saveProjectFileRevision(input.projectId, fileId, buffer)
    const savedId = await reuseOrCreateFile({ id: fileId, projectId: input.projectId, userId: input.userId, name: `${interview.title}-${label}-${sourceHash.slice(0, 8)}.docx`, type: 'DOCX', category: label, byteSize: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex'), storagePath, contentText: input.content })
    await linkArtifact(input.interviewId, savedId, input.kind === 'transcript' ? '转写' : '纪要', input.userId, 'manual')
    const [result] = await db.update(dueDiligenceArtifactTasks).set({ status: 'confirmed', archiveFileId: savedId, runToken: null, leaseExpiresAt: null, errorMessage: null, updatedAt: new Date() }).where(and(eq(dueDiligenceArtifactTasks.id, task.id), eq(dueDiligenceArtifactTasks.runToken, runToken)))
    if (result.affectedRows !== 1) throw recordingError('ARCHIVE_LEASE_LOST', '归档状态已更新，请刷新后核对材料')
    return { fileId: savedId, alreadyArchived: false }
  } catch (error) {
    await db.update(dueDiligenceArtifactTasks).set({ status: 'failed', runToken: null, leaseExpiresAt: null, errorMessage: error instanceof Error ? error.message.slice(0, 1000) : '归档失败', updatedAt: new Date() }).where(and(eq(dueDiligenceArtifactTasks.id, task.id), eq(dueDiligenceArtifactTasks.runToken, runToken)))
    throw error
  }
}

export async function enqueueInterviewSummary(projectId: string, interviewId: string, userId: string, role: string, transcriptVersion: number) {
  await requireInterviewWorkspace(userId, projectId, interviewId)
  const [transcript] = await db.select().from(dueDiligenceInterviewTranscripts).where(eq(dueDiligenceInterviewTranscripts.interviewId, interviewId)).limit(1)
  if (!transcript?.content.trim()) throw recordingError('EMPTY_TRANSCRIPT', '请先保存访谈转写文字', 400)
  if (transcript.version !== transcriptVersion) throw recordingError('TRANSCRIPT_VERSION_CONFLICT', '转写稿已更新，请保存后使用最新版本生成纪要')
  const id = randomUUID(); const sourceHash = createHash('sha256').update(`${transcriptVersion}:${transcript.content}`).digest('hex')
  await db.insert(dueDiligenceArtifactTasks).values({ id, projectId, interviewId, createdBy: userId, actorRole: role, kind: 'summary', status: 'queued', transcriptVersion, sourceHash, sourceText: transcript.content, totalChunks: splitTranscriptForSummary(transcript.content).length }).onDuplicateKeyUpdate({ set: { id: sql`${dueDiligenceArtifactTasks.id}` } })
  const [task] = await db.select().from(dueDiligenceArtifactTasks).where(and(eq(dueDiligenceArtifactTasks.interviewId, interviewId), eq(dueDiligenceArtifactTasks.kind, 'summary'), eq(dueDiligenceArtifactTasks.sourceHash, sourceHash))).limit(1)
  await wakeDueDiligenceArtifactWorker(); return publicSummaryTask(task)
}

async function processRecordingSession(session: Session, signal: AbortSignal) {
  await requireInterviewWorkspace(session.ownerUserId, session.projectId, session.interviewId)
  await requireProjectFileUpload(db, session.projectId, session.ownerUserId)
  const chunks = await db.select().from(dueDiligenceRecordingChunks).where(eq(dueDiligenceRecordingChunks.sessionId, session.id)).orderBy(asc(dueDiligenceRecordingChunks.epoch), asc(dueDiligenceRecordingChunks.sequence))
  const epochs = [...session.epochs]
  const storage = createDueDiligenceRecordingStorage()
  for (const epoch of epochs) {
    if (signal.aborted) throw signal.reason
    if (epoch.fileId && session.fileIds.includes(epoch.fileId)) continue
    const blocks = chunks.filter(chunk => chunk.epoch === epoch.epoch)
    if (!blocks.length) continue
    if (blocks.some((block, sequence) => block.sequence !== sequence)) throw recordingError('RECORDING_INCOMPLETE', '录音分片尚未全部保存，请补传后重试')
    const fileId = epoch.fileId || randomUUID(); epoch.fileId = fileId
    await db.update(dueDiligenceRecordingSessions).set({ epochs, updatedAt: new Date() }).where(and(eq(dueDiligenceRecordingSessions.id, session.id), eq(dueDiligenceRecordingSessions.status, 'finalizing')))
    const assembled = await storage.assemble({ sessionId: session.id, epoch: epoch.epoch, chunkCount: blocks.length, hashes: blocks.map(block => block.sha256), projectId: session.projectId, fileId, mimeType: epoch.mimeType, signal })
    const savedId = await reuseOrCreateFile({ id: fileId, projectId: session.projectId, userId: session.ownerUserId, name: `${epoch.fileName.replace(/\.[^.]+$/, '')}-片段${epoch.epoch + 1}.${assembled.extension}`, type: assembled.extension.toUpperCase(), category: '访谈录音', byteSize: assembled.byteSize, sha256: assembled.sha256, storagePath: assembled.storagePath })
    epoch.fileId = savedId
    await linkArtifact(session.interviewId, savedId, '录音', session.ownerUserId, session.source === 'upload' ? 'manual' : 'browser', session.durationSeconds)
    session.fileIds = [...new Set([...session.fileIds, savedId])]
    await db.update(dueDiligenceRecordingSessions).set({ epochs, fileIds: session.fileIds, errorMessage: null, updatedAt: new Date() }).where(and(eq(dueDiligenceRecordingSessions.id, session.id), eq(dueDiligenceRecordingSessions.status, 'finalizing')))
    // Only one epoch per scheduling tick; long archives remain bounded and resumable.
    return
  }
  await db.update(dueDiligenceRecordingSessions).set({ status: 'archived', activeKey: null, errorMessage: null, leaseExpiresAt: null, updatedAt: new Date() }).where(and(eq(dueDiligenceRecordingSessions.id, session.id), eq(dueDiligenceRecordingSessions.status, 'finalizing')))
}

async function processSummaryTask(task: ArtifactTask, signal: AbortSignal) {
  const runToken = randomUUID()
  const [claimed] = await db.update(dueDiligenceArtifactTasks).set({ status: 'processing', runToken, leaseExpiresAt: new Date(Date.now() + 120_000), attempts: sql`${dueDiligenceArtifactTasks.attempts} + 1`, updatedAt: new Date() }).where(and(eq(dueDiligenceArtifactTasks.id, task.id), eq(dueDiligenceArtifactTasks.status, 'queued')))
  if (claimed.affectedRows !== 1) return
  try {
    await requireInterviewWorkspace(task.createdBy, task.projectId, task.interviewId)
    const [actor] = await db.select({ role: users.role, status: users.status }).from(users).where(eq(users.id, task.createdBy)).limit(1)
    if (!actor || actor.status !== '启用') throw recordingError('ACTOR_UNAVAILABLE', '提交员工已停用，无法继续生成纪要', 403)
    const questions = await db.select({ id: dueDiligenceQuestions.id, title: dueDiligenceQuestions.title }).from(dueDiligenceQuestions).where(and(eq(dueDiligenceQuestions.projectId, task.projectId), isNull(dueDiligenceQuestions.deletedAt))).limit(60)
    const runtime = await resolveDueDiligenceModelRuntime(actor.role)
    const step = await nextInterviewSummaryStep({ sourceText: task.sourceText, chunkResults: task.chunkResults, mergeState: task.mergeState, signal }, async (prompt, activeSignal) => {
      const response = await fetchAiGatewayChatCompatible(runtime.baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(runtime.apiKey ? { Authorization: `Bearer ${runtime.apiKey}` } : {}) }, body: JSON.stringify({ model: runtime.model, response_format: { type: 'json_object' }, max_tokens: 4500, messages: [{ role: 'system', content: '你是股权投资访谈整理助手。只依据提供的全文片段，输出JSON {"summary":"6000字以内纪要","suggestions":[{"questionId":"已有问题ID","suggestion":"待员工确认的核查结论建议","evidenceExcerpt":"本段转写中的逐字证据"}]}。可不提建议。建议必须来自已有问题，不编造访谈事实、音频时间戳或说话人。' }, { role: 'user', content: `现有核查问题：${JSON.stringify(questions)}\n\n${prompt}` }] }), signal: AbortSignal.any([activeSignal || signal, AbortSignal.timeout(90_000)]) }, fetch, 90_000)
      if (!response.ok) throw recordingError('MODEL_UNAVAILABLE', `纪要模型暂不可用（HTTP ${response.status}），已完成片段会保留`, 503)
      const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> }
      const content = payload.choices?.[0]?.message?.content
      if (typeof content !== 'string') throw new Error('模型未返回纪要文字')
      try { return parseInterviewSummaryModelResult(JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))) }
      catch { throw recordingError('MODEL_INVALID_OUTPUT', '模型未返回有效纪要格式，已完成片段会保留', 502) }
    })
    const suggestions = [...task.questionSuggestions]
    for (const suggestion of step.suggestions) {
      const question = questions.find(item => item.id === suggestion.questionId)
      if (!question || !suggestion.evidenceExcerpt.trim() || !step.sourcePart?.text.includes(suggestion.evidenceExcerpt)) continue
      const item = { ...suggestion, title: question.title }
      const existing = suggestions.findIndex(value => value.questionId === item.questionId)
      if (existing < 0) suggestions.push(item)
      else if (suggestions[existing].suggestion !== item.suggestion) suggestions[existing] = { ...item, suggestion: `${suggestions[existing].suggestion}\n${item.suggestion}`.slice(0, 4000), evidenceExcerpt: `${suggestions[existing].evidenceExcerpt}\n${item.evidenceExcerpt}`.slice(0, 2000) }
    }
    await db.update(dueDiligenceArtifactTasks).set({ status: step.ready ? 'ready' : 'queued', completedChunks: step.chunkResults.length, chunkResults: step.chunkResults, mergeState: step.mergeState, summary: step.summary, questionSuggestions: suggestions, errorMessage: null, runToken: null, leaseExpiresAt: null, updatedAt: new Date() }).where(and(eq(dueDiligenceArtifactTasks.id, task.id), eq(dueDiligenceArtifactTasks.runToken, runToken)))
  } catch (error) {
    await db.update(dueDiligenceArtifactTasks).set({ status: 'failed', errorMessage: error instanceof Error ? error.message.slice(0, 1000) : '纪要生成失败', runToken: null, leaseExpiresAt: null, updatedAt: new Date() }).where(and(eq(dueDiligenceArtifactTasks.id, task.id), eq(dueDiligenceArtifactTasks.runToken, runToken)))
  }
}

/** Registered by the existing scheduler; never spins up a second queue or local AI. */
export async function runDueDiligenceArtifactWork(signal: AbortSignal): Promise<Record<string, unknown>> {
  // An interrupted provider request is not silently repeated and charged again.
  await db.update(dueDiligenceTranscriptionJobs).set({status:'失败',errorMessage:'上次后台转写已中断，录音仍保留；请确认后重试。',updatedAt:new Date()}).where(and(eq(dueDiligenceTranscriptionJobs.status,'转写中'),lt(dueDiligenceTranscriptionJobs.updatedAt,new Date(Date.now()-10*60_000))))
  await db.update(dueDiligenceArtifactTasks).set({ status: 'queued', runToken: null, leaseExpiresAt: null, errorMessage: '上次处理已中断，将从已完成片段继续', updatedAt: new Date() }).where(and(eq(dueDiligenceArtifactTasks.kind, 'summary'), eq(dueDiligenceArtifactTasks.status, 'processing'), lt(dueDiligenceArtifactTasks.leaseExpiresAt, new Date())))
  const [recording] = await db.select().from(dueDiligenceRecordingSessions).where(eq(dueDiligenceRecordingSessions.status, 'finalizing')).orderBy(asc(dueDiligenceRecordingSessions.updatedAt)).limit(1)
  if (recording) {
    try { await processRecordingSession(recording, signal) }
    catch (error) { await db.update(dueDiligenceRecordingSessions).set({ status: 'failed', activeKey: null, errorMessage: error instanceof Error ? error.message.slice(0, 1000) : '录音归档失败', updatedAt: new Date() }).where(eq(dueDiligenceRecordingSessions.id, recording.id)) }
    return { kind: 'recording', id: recording.id }
  }
  const [task] = await db.select().from(dueDiligenceArtifactTasks).where(and(eq(dueDiligenceArtifactTasks.kind, 'summary'), eq(dueDiligenceArtifactTasks.status, 'queued'))).orderBy(asc(dueDiligenceArtifactTasks.updatedAt)).limit(1)
  if (task) { await processSummaryTask(task, signal); return { kind: 'summary', id: task.id } }
  if (getDueDiligenceAsrCapability().configured) {
    const [asr] = await db.select({ id: dueDiligenceTranscriptionJobs.id }).from(dueDiligenceTranscriptionJobs).where(eq(dueDiligenceTranscriptionJobs.status, '待处理')).orderBy(asc(dueDiligenceTranscriptionJobs.createdAt)).limit(1)
    if (asr) { const { processTranscriptionJob } = await import('../routes/dueDiligence.js'); await processTranscriptionJob(asr.id, undefined, signal); return { kind: 'asr', id: asr.id } }
  }
  return (await import('../routes/dueDiligence.js')).runDueDiligenceExperienceWork()
}
