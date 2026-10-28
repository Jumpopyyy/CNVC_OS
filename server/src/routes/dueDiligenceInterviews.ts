import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { createHash, randomUUID } from 'node:crypto'
import { raw, Router } from 'express'
import { z } from 'zod'
import { db } from '../db/client.js'
import { auditLogs, dueDiligenceArtifactTasks, dueDiligenceInterviewArtifacts, dueDiligenceInterviews, dueDiligenceInterviewTranscripts, dueDiligenceQuestions, dueDiligenceRecordingChunks, dueDiligenceRecordingSessions, projectFiles } from '../db/schema.js'
import type { AuthedRequest } from '../middleware/requireAuth.js'
import { projectFileAccessCondition, requireProjectFileUpload } from '../services/projectFileAccessService.js'
import { archiveInterviewText, currentRecordingSession, enqueueInterviewSummary, leaseUntil, publicRecordingSession, publicSummaryTask, requireInterviewWorkspace, wakeDueDiligenceArtifactWorker } from '../services/dueDiligenceInterviewWorkflowService.js'
import { createDueDiligenceRecordingStorage, RECORDING_CHUNK_MAX_BYTES, RECORDING_SESSION_MAX_BYTES, RECORDING_SESSION_MAX_SECONDS, recordingContainer, recordingError } from '../services/dueDiligenceRecordingStorageService.js'
import { abortSummaryRequest } from '../services/dueDiligenceSummaryCancellation.js'

const routeId = (value: string | string[]) => z.string().uuid().parse(value)
const base = '/projects/:projectId/interviews/:id'
const seconds = z.number().int().min(0).max(RECORDING_SESSION_MAX_SECONDS)
type Session = typeof dueDiligenceRecordingSessions.$inferSelect
type Interview = typeof dueDiligenceInterviews.$inferSelect
type SummaryConfirmed = (req: AuthedRequest, interview: Interview, task: { id: string; transcriptVersion: number | null }) => Promise<void>

async function audit(req: AuthedRequest, action: string, target: string) {
  await db.insert(auditLogs).values({ userId: req.user!.uid, userName: req.user!.name, module: '尽调工作台', action, target })
}
function assertOwner(session: Session, userId: string) {
  if (session.ownerUserId !== userId) throw recordingError('INTERVIEW_RECORDER_REQUIRED', '仅本次录音的记录人可以继续、结束或放弃录入', 403)
}
function fileName(value: string | undefined, mimeType: string) {
  const extension = recordingContainer(mimeType).extension
  const stem = (value || '访谈录音').replace(/[\\/\u0000-\u001f]/g, '_').replace(/\.[^.]+$/, '').slice(0, 220)
  return `${stem || '访谈录音'}.${extension}`
}
async function workspace(req: AuthedRequest) {
  const projectId = routeId(req.params.projectId); const interviewId = routeId(req.params.id)
  const interview = await requireInterviewWorkspace(req.user!.uid, projectId, interviewId)
  return { projectId, interviewId, interview }
}
async function requireSession(req: AuthedRequest) {
  const context = await workspace(req); const sessionId = routeId(req.params.sessionId)
  const [session] = await db.select().from(dueDiligenceRecordingSessions).where(and(eq(dueDiligenceRecordingSessions.id, sessionId), eq(dueDiligenceRecordingSessions.interviewId, context.interviewId), eq(dueDiligenceRecordingSessions.projectId, context.projectId))).limit(1)
  if (!session) throw recordingError('NOT_FOUND', '录音会话不存在', 404)
  return { ...context, session }
}
async function requireTask(req: AuthedRequest) {
  const context = await workspace(req); const taskId = routeId(req.params.taskId)
  const [task] = await db.select().from(dueDiligenceArtifactTasks).where(and(eq(dueDiligenceArtifactTasks.id, taskId), eq(dueDiligenceArtifactTasks.interviewId, context.interviewId), eq(dueDiligenceArtifactTasks.kind, 'summary'))).limit(1)
  if (!task) throw recordingError('NOT_FOUND', '纪要任务不存在', 404)
  return { ...context, task }
}
const chunksFor = (id: string) => db.select().from(dueDiligenceRecordingChunks).where(eq(dueDiligenceRecordingChunks.sessionId, id)).orderBy(asc(dueDiligenceRecordingChunks.epoch), asc(dueDiligenceRecordingChunks.sequence))

/** Mounted behind the platform's existing auth, CSRF and trusted-origin middleware. */
export function createDueDiligenceInterviewRouter(onSummaryConfirmed?: SummaryConfirmed) {
  const router = Router()
  router.post(`${base}/recording-sessions`, async (req: AuthedRequest, res, next) => {
    try {
      const { projectId, interviewId } = await workspace(req); await requireProjectFileUpload(db, projectId, req.user!.uid)
      const body = z.object({ clientRequestId: z.string().uuid(), mimeType: z.string().max(128), fileName: z.string().max(255).optional(), source: z.enum(['browser', 'upload']).default('browser'), replaceExpiredSessionId: z.string().uuid().optional(), uploadManifest: z.object({name:z.string().max(255),size:z.number().int().positive().max(RECORDING_SESSION_MAX_BYTES),chunkBytes:z.literal(RECORDING_CHUNK_MAX_BYTES),fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).optional() }).parse(req.body)
      const container = recordingContainer(body.mimeType); const name = fileName(body.fileName, body.mimeType)
      const session = await db.transaction(async tx => {
        // Serialize recorder ownership using an existing parent row, not a process-local lock.
        await tx.select({ id: dueDiligenceInterviews.id }).from(dueDiligenceInterviews).where(eq(dueDiligenceInterviews.id, interviewId)).for('update')
        const [duplicate] = await tx.select().from(dueDiligenceRecordingSessions).where(and(eq(dueDiligenceRecordingSessions.ownerUserId, req.user!.uid), eq(dueDiligenceRecordingSessions.clientRequestId, body.clientRequestId))).limit(1)
        if (duplicate) {
          if (duplicate.interviewId !== interviewId || duplicate.projectId !== projectId) throw recordingError('RECORDING_REQUEST_CONFLICT', '录音请求已用于其他访谈')
          return duplicate
        }
        const [active] = await tx.select().from(dueDiligenceRecordingSessions).where(eq(dueDiligenceRecordingSessions.activeKey, interviewId)).limit(1)
        if (active?.leaseExpiresAt && active.leaseExpiresAt.getTime() > Date.now()) throw recordingError('INTERVIEW_RECORDING_ACTIVE', '本访谈已有录音，请先继续、结束或放弃原录音')
        if (active && active.ownerUserId !== req.user!.uid && body.replaceExpiredSessionId !== active.id) throw recordingError('RECORDING_TAKEOVER_REQUIRED', '原记录人已离线，请确认接续记录后开始。原录音保留。')
        if (body.replaceExpiredSessionId && active?.id !== body.replaceExpiredSessionId) throw recordingError('RECORDING_SESSION_CONFLICT', '记录状态已变化，请刷新后核对')
        if (active) await tx.update(dueDiligenceRecordingSessions).set({ activeKey: null, status: 'paused', updatedAt: new Date() }).where(eq(dueDiligenceRecordingSessions.id, active.id))
        const id = randomUUID()
        await tx.insert(dueDiligenceRecordingSessions).values({ id, projectId, interviewId, ownerUserId: req.user!.uid, clientRequestId: body.clientRequestId, activeKey: interviewId, mimeType: container.mimeType, fileName: name, source: body.source, epochs: [{ epoch: 0, mimeType: container.mimeType, fileName: name, ...(body.source === 'upload' && body.uploadManifest ? {uploadManifest:body.uploadManifest} : {}) }], leaseExpiresAt: leaseUntil(), lastCheckpointAt: new Date() })
        return (await tx.select().from(dueDiligenceRecordingSessions).where(eq(dueDiligenceRecordingSessions.id, id)).limit(1))[0]
      })
      await audit(req, '创建持久化访谈录音', session.id); res.status(201).json(publicRecordingSession(session))
    } catch (error) { next(error) }
  })
  router.get(`${base}/recording-sessions`, async (req: AuthedRequest, res, next) => {
    try { const { interviewId } = await workspace(req); const rows = await db.select().from(dueDiligenceRecordingSessions).where(eq(dueDiligenceRecordingSessions.interviewId, interviewId)).orderBy(desc(dueDiligenceRecordingSessions.createdAt)).limit(100); res.json({ list: rows.map(publicRecordingSession) }) } catch (error) { next(error) }
  })
  router.get(`${base}/recording-sessions/:sessionId`, async (req: AuthedRequest, res, next) => {
    try { const { session } = await requireSession(req); const chunks = await chunksFor(session.id); res.json({ session: publicRecordingSession(session), chunks: chunks.map(({ epoch, sequence, byteSize, sha256 }) => ({ epoch, sequence, byteSize, sha256 })) }) } catch (error) { next(error) }
  })
  router.put(`${base}/recording-sessions/:sessionId/epochs/:epoch/chunks/:sequence`, raw({ type: 'application/octet-stream', limit: RECORDING_CHUNK_MAX_BYTES }), async (req: AuthedRequest, res, next) => {
    try {
      const { session, projectId } = await requireSession(req); assertOwner(session, req.user!.uid); await requireProjectFileUpload(db, projectId, req.user!.uid)
      const epoch = z.coerce.number().int().min(0).max(100_000).parse(req.params.epoch); const sequence = z.coerce.number().int().min(0).max(100_000).parse(req.params.sequence)
      const hash = z.string().regex(/^[a-f0-9]{64}$/i).parse(req.get('X-Chunk-Sha256'))
      if (!Buffer.isBuffer(req.body) || !req.body.length || req.body.length > RECORDING_CHUNK_MAX_BYTES) throw recordingError('RECORDING_CHUNK_TOO_LARGE', '请使用不超过 2 MB 的二进制录音分片', 413)
      const result = await db.transaction(async tx => {
        await tx.select({id:dueDiligenceInterviews.id}).from(dueDiligenceInterviews).where(eq(dueDiligenceInterviews.id,session.interviewId)).for('update')
        const [locked] = await tx.select().from(dueDiligenceRecordingSessions).where(eq(dueDiligenceRecordingSessions.id, session.id)).for('update')
        if (locked && !locked.activeKey && ['recording','paused'].includes(locked.status)) {
          const [other] = await tx.select().from(dueDiligenceRecordingSessions).where(eq(dueDiligenceRecordingSessions.activeKey,locked.interviewId)).limit(1)
          if (other) throw recordingError('INTERVIEW_RECORDING_ACTIVE','另一场录入正在进行，原分片仍保留，请结束该录入后恢复')
          await tx.update(dueDiligenceRecordingSessions).set({activeKey:locked.interviewId,leaseExpiresAt:leaseUntil()}).where(eq(dueDiligenceRecordingSessions.id,locked.id))
          locked.activeKey=locked.interviewId
        }
        if (!locked || !['recording', 'paused'].includes(locked.status) || locked.currentEpoch !== epoch || locked.activeKey !== locked.interviewId) throw recordingError('RECORDING_SESSION_CONFLICT', '录音已结束或已切换记录人，请恢复会话后重试')
        const [existing] = await tx.select().from(dueDiligenceRecordingChunks).where(and(eq(dueDiligenceRecordingChunks.sessionId, session.id), eq(dueDiligenceRecordingChunks.epoch, epoch), eq(dueDiligenceRecordingChunks.sequence, sequence))).limit(1)
        if (!existing && locked.byteSize + req.body.length > RECORDING_SESSION_MAX_BYTES) throw recordingError('RECORDING_CAPACITY_EXCEEDED', '单场录音容量上限为 1 GB', 413)
        if (existing && existing.sha256 !== hash.toLowerCase()) throw recordingError('RECORDING_CHUNK_CONFLICT', '同一录音分片已有不同内容')
        const saved = await createDueDiligenceRecordingStorage().putChunk(session.id, epoch, sequence, req.body, hash)
        if (!existing) await tx.insert(dueDiligenceRecordingChunks).values({ id: randomUUID(), sessionId: session.id, epoch, sequence, byteSize: saved.byteSize, sha256: saved.sha256 })
        await tx.update(dueDiligenceRecordingSessions).set({ byteSize: existing ? locked.byteSize : locked.byteSize + saved.byteSize, lastCheckpointAt: new Date(), leaseExpiresAt: leaseUntil(), updatedAt: new Date() }).where(eq(dueDiligenceRecordingSessions.id, session.id))
        return { session: (await tx.select().from(dueDiligenceRecordingSessions).where(eq(dueDiligenceRecordingSessions.id, session.id)).limit(1))[0], chunk: { epoch, sequence, byteSize: saved.byteSize, sha256: saved.sha256, duplicate: Boolean(existing) } }
      })
      res.json({ session: publicRecordingSession(result.session), chunk: result.chunk })
    } catch (error) { next(error) }
  })
  router.post(`${base}/recording-sessions/:sessionId/heartbeat`, async (req: AuthedRequest, res, next) => {
    try {
      const { session } = await requireSession(req); assertOwner(session, req.user!.uid)
      const body = z.object({ epoch: z.number().int().min(0), durationSeconds: seconds, status: z.enum(['recording', 'paused']) }).parse(req.body)
      const [result] = await db.update(dueDiligenceRecordingSessions).set({ status: body.status, durationSeconds: sql`GREATEST(${dueDiligenceRecordingSessions.durationSeconds}, ${body.durationSeconds})`, leaseExpiresAt: leaseUntil(), updatedAt: new Date() }).where(and(eq(dueDiligenceRecordingSessions.id, session.id), eq(dueDiligenceRecordingSessions.currentEpoch, body.epoch), eq(dueDiligenceRecordingSessions.activeKey, session.interviewId), inArray(dueDiligenceRecordingSessions.status, ['recording', 'paused'])))
      if (result.affectedRows !== 1) throw recordingError('RECORDING_SESSION_CONFLICT', '录音会话或记录人已变更，请刷新后恢复')
      res.json(publicRecordingSession((await db.select().from(dueDiligenceRecordingSessions).where(eq(dueDiligenceRecordingSessions.id, session.id)).limit(1))[0]))
    } catch (error) { next(error) }
  })
  router.post(`${base}/recording-sessions/:sessionId/resume`, async (req: AuthedRequest, res, next) => {
    try {
      const { session } = await requireSession(req); assertOwner(session, req.user!.uid)
      const body = z.object({ expectedEpoch: z.number().int().min(0), mimeType: z.string().max(128).optional() }).parse(req.body)
      const result = await db.transaction(async tx => {
        await tx.select({ id: dueDiligenceInterviews.id }).from(dueDiligenceInterviews).where(eq(dueDiligenceInterviews.id, session.interviewId)).for('update')
        const [locked] = await tx.select().from(dueDiligenceRecordingSessions).where(eq(dueDiligenceRecordingSessions.id, session.id)).for('update')
        if (!locked || !['recording', 'paused', 'failed'].includes(locked.status) || locked.currentEpoch !== body.expectedEpoch || locked.durationSeconds >= RECORDING_SESSION_MAX_SECONDS) throw recordingError('RECORDING_SESSION_CONFLICT', '录音已更新、已结束或达到 8 小时上限，请刷新后核对')
        if (locked.source === 'upload') throw recordingError('RECORDING_UPLOAD_RESUME_UNSUPPORTED', '已有文件上传请继续补传当前分片，不创建新的录音容器', 400)
        const [other] = await tx.select().from(dueDiligenceRecordingSessions).where(eq(dueDiligenceRecordingSessions.activeKey, session.interviewId)).limit(1)
        if (other && other.id !== locked.id && other.leaseExpiresAt && other.leaseExpiresAt.getTime() > Date.now()) throw recordingError('INTERVIEW_RECORDING_ACTIVE', '另一位员工正在记录本访谈')
        if (other && other.id !== locked.id) await tx.update(dueDiligenceRecordingSessions).set({ activeKey: null, status: 'paused', updatedAt: new Date() }).where(eq(dueDiligenceRecordingSessions.id, other.id))
        const mimeType = recordingContainer(body.mimeType || locked.mimeType).mimeType; const epoch = locked.currentEpoch + 1
        await tx.update(dueDiligenceRecordingSessions).set({ currentEpoch: epoch, mimeType, epochs: [...locked.epochs, { epoch, mimeType, fileName: fileName(locked.fileName, mimeType) }], activeKey: session.interviewId, status: 'recording', errorMessage: null, leaseExpiresAt: leaseUntil(), updatedAt: new Date() }).where(eq(dueDiligenceRecordingSessions.id, locked.id))
        return (await tx.select().from(dueDiligenceRecordingSessions).where(eq(dueDiligenceRecordingSessions.id, locked.id)).limit(1))[0]
      })
      await audit(req, '恢复持久化访谈录音', session.id); res.json(publicRecordingSession(result))
    } catch (error) { next(error) }
  })
  router.post(`${base}/recording-sessions/:sessionId/finalize`, async (req: AuthedRequest, res, next) => {
    try {
      const { session } = await requireSession(req); assertOwner(session, req.user!.uid)
      const body = z.object({ durationSeconds: seconds, expectedChunks: z.array(z.object({ epoch: z.number().int().min(0), count: z.number().int().min(0).max(100_000) })).max(1000).optional() }).parse(req.body)
      const result = await db.transaction(async tx => {
        const [locked] = await tx.select().from(dueDiligenceRecordingSessions).where(eq(dueDiligenceRecordingSessions.id, session.id)).for('update')
        if (!locked) throw recordingError('NOT_FOUND', '录音会话不存在', 404)
        if (['archived', 'finalizing'].includes(locked.status)) return locked
        if (locked.status === 'discarded') throw recordingError('RECORDING_SESSION_DISCARDED', '本次录入已放弃')
        const chunks = await tx.select().from(dueDiligenceRecordingChunks).where(eq(dueDiligenceRecordingChunks.sessionId, locked.id)).orderBy(asc(dueDiligenceRecordingChunks.sequence))
        if (!chunks.length) throw recordingError('EMPTY_RECORDING', '录音分片尚未保存，请先补传', 400)
        const manifest = locked.epochs[0]?.uploadManifest
        if (manifest && (chunks.length !== Math.ceil(manifest.size / manifest.chunkBytes) || chunks.reduce((sum, chunk) => sum + chunk.byteSize, 0) !== manifest.size)) throw recordingError('RECORDING_INCOMPLETE', '文件尚未完整上传，请重新选择原文件继续补传')
        if (manifest && createHash('sha256').update(chunks.map(chunk => chunk.sha256).join('')).digest('hex') !== manifest.fingerprint) throw recordingError('RECORDING_FILE_CHANGED', '文件内容与上传清单不一致，请核对原文件', 422)
        for (const epoch of locked.epochs) {
          const blocks = chunks.filter(block => block.epoch === epoch.epoch)
          if (blocks.some((block, index) => block.sequence !== index)) throw recordingError('RECORDING_INCOMPLETE', '录音分片尚未全部保存，请重新保存后结束')
          const expected = body.expectedChunks?.find(item => item.epoch === epoch.epoch)
          if (body.expectedChunks && (!expected || expected.count !== blocks.length)) throw recordingError('RECORDING_INCOMPLETE', '录音分片数量不一致，请先补传全部片段')
        }
        if (body.expectedChunks?.some(expected => !locked.epochs.some(epoch => epoch.epoch === expected.epoch))) throw recordingError('RECORDING_INCOMPLETE', '存在不属于本场录音的片段')
        await tx.update(dueDiligenceRecordingSessions).set({ status: 'finalizing', activeKey: null, durationSeconds: Math.max(locked.durationSeconds, body.durationSeconds), archiveRunToken: null, archiveLeaseExpiresAt: null, errorMessage: null, updatedAt: new Date() }).where(eq(dueDiligenceRecordingSessions.id, locked.id))
        return (await tx.select().from(dueDiligenceRecordingSessions).where(eq(dueDiligenceRecordingSessions.id, locked.id)).limit(1))[0]
      })
      await wakeDueDiligenceArtifactWorker(); await audit(req, '结束并排队归档录音', session.id); res.json(publicRecordingSession(result))
    } catch (error) { next(error) }
  })
  router.post(`${base}/recording-sessions/:sessionId/discard`, async (req: AuthedRequest, res, next) => {
    try {
      const { session } = await requireSession(req); assertOwner(session, req.user!.uid)
      const [result] = await db.update(dueDiligenceRecordingSessions).set({ status: 'discarded', activeKey: null, leaseExpiresAt: null, archiveRunToken: null, archiveLeaseExpiresAt: null, updatedAt: new Date() }).where(and(eq(dueDiligenceRecordingSessions.id, session.id), inArray(dueDiligenceRecordingSessions.status, ['recording', 'paused', 'failed', 'discarded'])))
      if (result.affectedRows !== 1) throw recordingError('RECORDING_ALREADY_FINALIZED', '录音已提交归档，不能再放弃本次录入')
      await audit(req, '放弃本次录音', session.id); res.json(publicRecordingSession((await db.select().from(dueDiligenceRecordingSessions).where(eq(dueDiligenceRecordingSessions.id, session.id)).limit(1))[0]))
    } catch (error) { next(error) }
  })
  router.get(`${base}/recording-sessions/:sessionId/epochs/:epoch/download`, async (req: AuthedRequest, res, next) => {
    try {
      const { session } = await requireSession(req); assertOwner(session,req.user!.uid); const epoch = z.coerce.number().int().min(0).parse(req.params.epoch)
      const metadata = session.epochs.find(item => item.epoch === epoch); if (!metadata) throw recordingError('NOT_FOUND', '录音片段不存在', 404)
      const chunks = (await chunksFor(session.id)).filter(chunk => chunk.epoch === epoch)
      if (!chunks.length || chunks.some((chunk, index) => chunk.sequence !== index)) throw recordingError('RECORDING_INCOMPLETE', '录音分片不完整，已保存片段仍保留')
      res.setHeader('Content-Type', metadata.mimeType); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(metadata.fileName)}`)
      res.setHeader('Content-Length', chunks.reduce((sum, chunk) => sum + chunk.byteSize, 0)); res.setHeader('Cache-Control', 'private, no-store')
      const stream = createDueDiligenceRecordingStorage().epochStream(session.id, epoch, chunks.length, chunks.map(chunk => chunk.sha256))
      stream.on('error', error => { if (res.headersSent) res.destroy(error); else next(error) }); res.on('close', () => stream.destroy()); stream.pipe(res)
    } catch (error) { next(error) }
  })
  router.get(`${base}/transcript`, async (req: AuthedRequest, res, next) => {
    try {
      const { interviewId, interview } = await workspace(req); const after = z.coerce.number().int().min(0).default(0).parse(req.query.afterVersion)
      const [transcript] = await db.select().from(dueDiligenceInterviewTranscripts).where(eq(dueDiligenceInterviewTranscripts.interviewId, interviewId)).limit(1)
      const recording = await currentRecordingSession(interviewId)
      const artifacts = await db.select({ id: dueDiligenceInterviewArtifacts.id, interviewId: dueDiligenceInterviewArtifacts.interviewId, fileId: dueDiligenceInterviewArtifacts.fileId, kind: dueDiligenceInterviewArtifacts.kind, source: dueDiligenceInterviewArtifacts.source, durationSeconds: dueDiligenceInterviewArtifacts.durationSeconds, name: projectFiles.name, createdAt: dueDiligenceInterviewArtifacts.createdAt }).from(dueDiligenceInterviewArtifacts).innerJoin(projectFiles, eq(projectFiles.id, dueDiligenceInterviewArtifacts.fileId)).where(and(eq(dueDiligenceInterviewArtifacts.interviewId, interviewId), projectFileAccessCondition(req.user!.uid))).orderBy(desc(dueDiligenceInterviewArtifacts.createdAt))
      const changed = Boolean(transcript && transcript.version !== after)
      res.json({ changed, transcript: changed ? transcript : null, recordingSession: recording ? publicRecordingSession(recording) : null, interviewVersion: interview.version, artifacts })
    } catch (error) { next(error) }
  })
  router.post(`${base}/summary/tasks`, async (req: AuthedRequest, res, next) => {
    try { const { projectId, interviewId } = await workspace(req); const body = z.object({ transcriptVersion: z.number().int().positive(), regenerate: z.boolean().default(false) }).parse(req.body); const task = await enqueueInterviewSummary(projectId, interviewId, req.user!.uid, req.user!.role, body.transcriptVersion, body.regenerate); await audit(req, '排队生成完整访谈纪要', task.id); res.status(202).json(task) } catch (error) { next(error) }
  })
  router.get(`${base}/summary/tasks`, async (req: AuthedRequest, res, next) => {
    try { const { interviewId } = await workspace(req); const list = await db.select().from(dueDiligenceArtifactTasks).where(and(eq(dueDiligenceArtifactTasks.interviewId, interviewId), eq(dueDiligenceArtifactTasks.kind, 'summary'))).orderBy(desc(dueDiligenceArtifactTasks.createdAt)).limit(req.query.latest === '1' ? 1 : 50); res.json({ list: list.map(publicSummaryTask) }) } catch (error) { next(error) }
  })
  router.post(`${base}/summary/tasks/:taskId/retry`, async (req: AuthedRequest, res, next) => {
    try {
      const { task } = await requireTask(req)
      if (task.createdBy !== req.user!.uid) throw recordingError('TASK_OWNER_REQUIRED', '请由纪要提交人重试任务', 403)
      await db.update(dueDiligenceArtifactTasks).set({ status: 'queued', errorMessage: null, updatedAt: new Date() }).where(and(eq(dueDiligenceArtifactTasks.id, task.id), inArray(dueDiligenceArtifactTasks.status, ['failed', 'cancelled'])))
      await wakeDueDiligenceArtifactWorker(); await audit(req, '重试完整访谈纪要', task.id)
      res.json(publicSummaryTask((await db.select().from(dueDiligenceArtifactTasks).where(eq(dueDiligenceArtifactTasks.id, task.id)).limit(1))[0]))
    } catch (error) { next(error) }
  })
  router.post(`${base}/summary/tasks/:taskId/stop`, async (req: AuthedRequest, res, next) => {
    try {
      const { task } = await requireTask(req)
      if (task.createdBy !== req.user!.uid) throw recordingError('TASK_OWNER_REQUIRED', '请由纪要提交人停止任务', 403)
      const stoppedToken = await db.transaction(async tx => {
        const [current] = await tx.select().from(dueDiligenceArtifactTasks).where(eq(dueDiligenceArtifactTasks.id, task.id)).for('update')
        if (!current || !['queued', 'processing'].includes(current.status)) return null
        await tx.update(dueDiligenceArtifactTasks).set({ status: 'cancelled', runToken: null, leaseExpiresAt: null, errorMessage: null, updatedAt: new Date() }).where(eq(dueDiligenceArtifactTasks.id, task.id))
        return current.runToken
      })
      if (stoppedToken) abortSummaryRequest(task.id, stoppedToken)
      const [current] = await db.select().from(dueDiligenceArtifactTasks).where(eq(dueDiligenceArtifactTasks.id,task.id)).limit(1)
      await audit(req, current.status === 'cancelled' ? '停止生成纪要' : '核对纪要完成状态', task.id)
      res.json(publicSummaryTask(current))
    } catch (error) { next(error) }
  })
  router.post(`${base}/summary/tasks/:taskId/confirm`, async (req: AuthedRequest, res, next) => {
    try {
      const { task, projectId, interviewId } = await requireTask(req)
      const body = z.object({ summary: z.string().trim().min(1).max(100_000), expectedInterviewVersion: z.number().int().positive(), questionDecisions: z.array(z.object({ questionId: z.string().uuid(), conclusion: z.string().trim().max(8000), expectedVersion: z.number().int().positive().optional() })).max(100).default([]) }).parse(req.body)
      if (!['ready', 'confirmed'].includes(task.status)) throw recordingError('SUMMARY_NOT_READY', '纪要仍在生成，或已失败，请处理完成后确认')
      const result = await db.transaction(async tx => {
        const [interview] = await tx.select().from(dueDiligenceInterviews).where(eq(dueDiligenceInterviews.id, interviewId)).for('update')
        const [currentTask] = await tx.select().from(dueDiligenceArtifactTasks).where(eq(dueDiligenceArtifactTasks.id, task.id)).for('update')
        if (currentTask.status === 'confirmed') {
          if (currentTask.summary !== body.summary) throw recordingError('SUMMARY_ALREADY_CONFIRMED', '此纪要已确认；请编辑访谈中的现有纪要，不覆盖已归档版本')
          return { interview, alreadyConfirmed: true }
        }
        if (interview.version !== body.expectedInterviewVersion) throw recordingError('VERSION_CONFLICT', '访谈已更新，您的纪要草稿已保留，请刷新版本后再确认')
        const [transcript] = await tx.select({ version: dueDiligenceInterviewTranscripts.version }).from(dueDiligenceInterviewTranscripts).where(eq(dueDiligenceInterviewTranscripts.interviewId, interviewId)).for('update')
        if (transcript?.version !== task.transcriptVersion) throw recordingError('TRANSCRIPT_VERSION_CONFLICT', '转写稿已有新版本，纪要草稿已保留，请核对后基于最新转写生成')
        for (const decision of body.questionDecisions) {
          if (!task.questionSuggestions.some(item => item.questionId === decision.questionId)) throw recordingError('INVALID_QUESTION_LINK', '只能确认此纪要提出的现有问题建议', 400)
          const [question] = await tx.select().from(dueDiligenceQuestions).where(and(eq(dueDiligenceQuestions.id, decision.questionId), eq(dueDiligenceQuestions.projectId, projectId), isNull(dueDiligenceQuestions.deletedAt))).for('update')
          if (!question || decision.expectedVersion !== undefined && decision.expectedVersion !== question.version) throw recordingError('QUESTION_VERSION_CONFLICT', '关联问题已变化，请刷新后核对建议')
          await tx.update(dueDiligenceQuestions).set({ conclusion: decision.conclusion, evidenceRequirement: [question.evidenceRequirement,decision.conclusion].filter(Boolean).join('\n').slice(0,4000), version: question.version + 1, updatedAt: new Date() }).where(eq(dueDiligenceQuestions.id, question.id))
        }
        await tx.update(dueDiligenceInterviews).set({ summary: body.summary, summaryTranscriptVersion: task.transcriptVersion, status: '已结束', version: interview.version + 1, updatedAt: new Date() }).where(eq(dueDiligenceInterviews.id, interviewId))
        await tx.update(dueDiligenceArtifactTasks).set({ status: 'confirmed', summary: body.summary, updatedAt: new Date() }).where(eq(dueDiligenceArtifactTasks.id, task.id))
        return { interview: (await tx.select().from(dueDiligenceInterviews).where(eq(dueDiligenceInterviews.id, interviewId)).limit(1))[0], alreadyConfirmed: false }
      })
      // A failed document archive must not erase the already committed human confirmation.
      if (!result.alreadyConfirmed && onSummaryConfirmed) await onSummaryConfirmed(req, result.interview, task).catch(() => {})
      // Confirmation and archive have independent idempotency: retry never overwrites a newer interview.
      const archived = await archiveInterviewText({ projectId, interviewId, userId: req.user!.uid, role: req.user!.role, kind: 'summary', content: body.summary, sourceVersion: task.transcriptVersion })
      await db.update(dueDiligenceArtifactTasks).set({ archiveFileId: archived.fileId, updatedAt: new Date() }).where(eq(dueDiligenceArtifactTasks.id, task.id))
      await audit(req, '确认并归档访谈纪要', task.id); res.json({ interview: result.interview, ...archived, alreadyArchived: archived.alreadyArchived || result.alreadyConfirmed })
    } catch (error) { next(error) }
  })
  router.post(`${base}/archive`, async (req: AuthedRequest, res, next) => {
    try {
      const { projectId, interviewId, interview } = await workspace(req)
      const body = z.object({ kind: z.enum(['transcript', 'summary']), content: z.string().max(1_000_000).optional(), sourceVersion: z.number().int().positive().nullable().optional() }).parse(req.body)
      const [transcript] = body.kind === 'transcript' ? await db.select().from(dueDiligenceInterviewTranscripts).where(eq(dueDiligenceInterviewTranscripts.interviewId, interviewId)).limit(1) : []
      const content = body.content ?? (body.kind === 'transcript' ? transcript?.content : interview.summary) ?? ''
      if (body.sourceVersion && body.kind === 'transcript' && transcript?.version !== body.sourceVersion) throw recordingError('TRANSCRIPT_VERSION_CONFLICT', '转写稿已更新，请使用最新版本归档')
      const result = await archiveInterviewText({ projectId, interviewId, userId: req.user!.uid, role: req.user!.role, kind: body.kind, content, sourceVersion: body.sourceVersion ?? transcript?.version })
      await audit(req, `确认归档${body.kind === 'transcript' ? '转写稿' : '纪要'}`, interviewId); res.status(result.alreadyArchived ? 200 : 201).json(result)
    } catch (error) { next(error) }
  })
  return router
}
