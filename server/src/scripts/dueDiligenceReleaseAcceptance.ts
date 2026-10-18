import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import express, { type ErrorRequestHandler } from 'express'
import mysql, { type RowDataPacket } from 'mysql2/promise'
import { eq } from 'drizzle-orm'
import type { AuthedRequest } from '../middleware/requireAuth.js'
import { cleanupFdeTables, withAcceptanceCleanup } from './fdeAcceptanceCleanup.js'
import { withFdeAcceptanceSignals } from './fdeAcceptanceSignals.js'
import { assertIsolatedMysqlAcceptanceDatabase } from './mysqlAcceptanceSafety.js'

assertIsolatedMysqlAcceptanceDatabase('dueDiligenceReleaseAcceptance')
assert.equal(process.argv.length, 2, '不接受自定义前缀或写入目标')
const sourcePrefix = process.env.DB_FREFIX ?? ''
assert.match(sourcePrefix, /^[A-Za-z0-9_]+$/)
assert.ok(!sourcePrefix.startsWith('fde_accept_'))
const targetPrefix = `fde_accept_${randomBytes(5).toString('hex')}_`
if (process.env.DB_MIGRATION_USERNAME && process.env.DB_MIGRATION_PASSWORD) {
  process.env.DB_USERNAME = process.env.DB_MIGRATION_USERNAME
  process.env.DB_PASSWORD = process.env.DB_MIGRATION_PASSWORD
}
process.env.DB_FREFIX = targetPrefix
process.env.DB_MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url))
const { mysqlConfig, quoteMysqlIdentifier } = await import('../db/config.js')
assert.equal(mysqlConfig.tablePrefix, targetPrefix)
const connect = () => mysql.createConnection({ host: mysqlConfig.host, port: mysqlConfig.port,
  database: mysqlConfig.database, user: mysqlConfig.user, password: mysqlConfig.password,
  charset: 'utf8mb4_0900_ai_ci', connectTimeout: 10_000 })
async function tableNames(connection: mysql.Connection, prefix: string) {
  const [rows] = await connection.query<Array<RowDataPacket & { name: string }>>(
    'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND LEFT(TABLE_NAME,?)=? ORDER BY TABLE_NAME',
    [mysqlConfig.database, prefix.length, prefix])
  return rows.map(row => row.name)
}

await withFdeAcceptanceSignals(async lifecycle => {
  const metadata = await connect()
  let sourceTables: string[]
  try {
    sourceTables = await tableNames(metadata, sourcePrefix)
    assert.equal((await tableNames(metadata, targetPrefix)).length, 0)
  } finally { await metadata.end().catch(() => metadata.destroy()) }
  let fixturePool: { end(): Promise<void> } | undefined
  let server: Server | undefined
  const originalFetch = globalThis.fetch
  const checks: string[] = []
  await withAcceptanceCleanup(async () => {
    lifecycle.checkpoint()
    const { pool, db } = await import('../db/client.js'); fixturePool = pool
    const { applySchemaMigrations, assertSchemaReady } = await import('../db/migrate.js')
    await applySchemaMigrations(); await assertSchemaReady()
    const { users, projects, projectFiles, digitalTwinLearningCandidates, dueDiligenceArtifactTasks } = await import('../db/schema.js')
    const owner = randomUUID(), outsider = randomUUID(), projectId = randomUUID(), otherProject = randomUUID(), fileId = randomUUID()
    await db.insert(users).values([owner, outsider].map(id => ({ id, email: `${id}@acceptance.invalid`, name: '合成验收用户', role: '投资经理', passwordHash: 'synthetic-non-login' })))
    await db.insert(projects).values([projectId, otherProject].map(id => ({ id, name: '合成尽调项目', industry: 'SaaS', owner: '合成验收用户', ownerUserId: owner, createdBy: owner, workflowModel: 'fde-v1' })))
    await db.insert(projectFiles).values({ id: fileId, projectId, name: '合成项目材料.txt', type: 'TXT', category: '项目基础资料', uploader: '合成验收用户', uploadedBy: owner, parseStatus: '成功', contentText: 'SaaS 订阅业务合成材料' })
    const { dueDiligenceRouter } = await import('../routes/dueDiligence.js')
    const app = express()
    app.use(express.json())
    // Test-only identity injection: this app listens on a random loopback port.
    app.use((req: AuthedRequest, _res, next) => {
      req.user = { uid: req.header('x-fixture-user') === outsider ? outsider : owner, email: 'fixture@acceptance.invalid', name: '合成验收用户', role: '投资经理', department: '投资部' }; next()
    })
    app.use('/dd', dueDiligenceRouter)
    app.use(((error, _req, res, _next) => {
      const status = error.status ?? (error.name === 'ZodError' ? 400 : 500)
      res.status(status).json({ code: error.code ?? 'INTERNAL_ERROR' })
    }) as ErrorRequestHandler)
    server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)) })
    const address = server.address(); assert.ok(address && typeof address !== 'string')
    const base = `http://127.0.0.1:${address.port}/dd`
    let modelResponder: ((body:{messages:Array<{role:string;content:string}>})=>Promise<string>|string)|null=null
    let modelContractCalls=0
    // Block external HTTP. Only a deterministic in-process model protocol fixture may respond.
    globalThis.fetch = ((input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (modelResponder && url === 'https://model-fixture.invalid/v1/responses') {
        return Promise.resolve(new Response('{}', { status: 404 }))
      }
      if (modelResponder && url === 'https://model-fixture.invalid/v1/chat/completions') {
        modelContractCalls++
        return Promise.resolve(modelResponder(JSON.parse(String(init?.body)))).then(content=>new Response(JSON.stringify({choices:[{message:{content}}]}),{status:200,headers:{'content-type':'application/json'}}))
      }
      assert.ok(url.startsWith(`${base}/`), '验收禁止模型或其他外部 HTTP 调用')
      return originalFetch(input, init)
    }) as typeof fetch
    async function request(method: string, route: string, status: number, body?: unknown, user: string = owner): Promise<Record<string, any>> {
      lifecycle.checkpoint()
      const response = await fetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json', 'x-fixture-user': user }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) })
      assert.equal(response.status, status, `${method} ${route}: ${await response.clone().text().then(text => text.slice(0, 160))}`)
      if (status === 204) return {}
      return response.json() as Promise<Record<string, any>>
    }
    const root = `/projects/${projectId}`
    const pack = await request('POST', `${root}/question-packs/generate`, 201, { mode: 'baseline', fileIds: [fileId] })
    assert.equal(pack.generationMode, 'baseline'); assert.equal(pack.modelStatus, '未调用'); assert.ok(pack.questions.length >= 18)
    const fallback = await request('POST', `${root}/question-packs/generate`, 201, { mode: 'auto', fileIds: [fileId] })
    assert.equal(fallback.generationMode, 'baseline'); assert.equal(fallback.modelStatus, '不可用'); assert.ok(fallback.warning)
    assert.equal(fallback.created, 0, '重复回退不得重复插入问题')
    checks.push('auto-mode-blocked-model-falls-back-without-duplicate-questions')
    const applied = await request('POST', `${root}/question-packs/${pack.id}/apply`, 200, {})
    assert.equal(applied.created, 0, '生成后已自动加入，重复确认不得再次插入')
    const document = await fetch(`${base}${root}/question-packs/${pack.id}/docx`)
    assert.equal(document.status, 200); assert.match(document.headers.get('content-type') ?? '', /wordprocessingml/)
    const bytes = Buffer.from(await document.arrayBuffer()); assert.equal(bytes.subarray(0, 2).toString(), 'PK'); assert.ok(bytes.length > 1000)
    checks.push('baseline-pack-generate-apply-docx')
    const question = await request('POST', `${root}/questions`, 201, { title: '合成手工问题', fileIds: [fileId] })
    const updated = await request('PATCH', `${root}/questions/${question.id}`, 200, { title: '已更新问题', expectedVersion: question.version })
    assert.equal(updated.version, question.version + 1)
    assert.equal((await request('PATCH', `${root}/questions/${question.id}`, 409, { title: '过期修改', expectedVersion: question.version })).code, 'VERSION_CONFLICT')
    const refreshedQuestion=(await request('GET', `${root}/questions`, 200)).list.find((row: { id: string }) => row.id === question.id)
    assert.equal(refreshedQuestion.title,'已更新问题')
    assert.deepEqual(refreshedQuestion.fileIds,[fileId],'只编辑标题不得清空已有材料引用')
    const liveWord = await fetch(`${base}${root}/questions/docx`)
    assert.equal(liveWord.status,200)
    const liveBytes = Buffer.from(await liveWord.arrayBuffer())
    const xml = await (await JSZip.loadAsync(liveBytes)).file('word/document.xml')!.async('string')
    assert.match(xml,/已更新问题/);assert.doesNotMatch(xml,/关注来源|本清单由/)
    if(process.env.DD_TEST_ARTIFACT_DIR){
      const directory=path.resolve(process.env.DD_TEST_ARTIFACT_DIR);await mkdir(directory,{recursive:true})
      await writeFile(path.join(directory,'current-checklist.docx'),liveBytes)
    }
    checks.push('question-create-read-update-version-conflict')
    const interview = await request('POST', `${root}/interviews`, 201, { title: '合成访谈', mode: '远程' })
    const revised = await request('PATCH', `${root}/interviews/${interview.id}`, 200, { notes: '合成记录', expectedVersion: interview.version })
    assert.equal(revised.notes, '合成记录')
    await request('PATCH', `${root}/interviews/${interview.id}`, 409, { notes: '旧版本', expectedVersion: interview.version })
    assert.ok((await request('GET', `${root}/interviews`, 200)).list.some((row: { id: string }) => row.id === interview.id))
    const arranged=await request('PATCH',`${root}/interviews/${interview.id}`,200,{expectedVersion:revised.version,status:'进行中',location:'合成会议室',agenda:'核对原始合同',counterparty:'合成项目方',participantNames:['合成员工'],summary:'未确认的合成纪要草稿'})
    const renamed=await request('PATCH',`${root}/interviews/${interview.id}`,200,{expectedVersion:arranged.version,title:'改名后的合成访谈'})
    for (const field of ['mode','status','location','agenda','counterparty','participantNames','notes','summary']) assert.deepEqual(renamed[field],arranged[field],`访谈重命名不得重置 ${field}`)
    const otherQuestion = await request('POST', `/projects/${otherProject}/questions`, 201, { title: '另一项目问题' })
    await request('POST', `${root}/interviews/${interview.id}/prompts`, 400, { content: '跨项目引用', questionId: otherQuestion.id })
    await request('POST', `${root}/interviews/${interview.id}/prompts`, 201, { content: '同项目引用', questionId: question.id })
    checks.push('interview-create-read-update-version-conflict-cross-project-prompt')
    const interviewRoot = `${root}/interviews/${interview.id}`
    const recordingRequest = {clientRequestId:randomUUID(),mimeType:'audio/wav',source:'upload'}
    const recording = await request('POST', `${interviewRoot}/recording-sessions`, 201, recordingRequest)
    await request('DELETE',interviewRoot,409)
    assert.equal((await request('POST', `${interviewRoot}/recording-sessions`, 201, recordingRequest)).id, recording.id)
    const recordingRoot = `${interviewRoot}/recording-sessions/${recording.id}`
    const wav = Buffer.alloc(8044,128)
    wav.write('RIFF'); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(8000,24); wav.writeUInt32LE(8000,28); wav.writeUInt16LE(1,32); wav.writeUInt16LE(8,34); wav.write('data',36); wav.writeUInt32LE(8000,40)
    const putChunk = async (bytes:Buffer,sequence:number,status:number) => {
      const response = await fetch(`${base}${recordingRoot}/epochs/0/chunks/${sequence}`, {method:'PUT',headers:{'content-type':'application/octet-stream','x-chunk-sha256':createHash('sha256').update(bytes).digest('hex')},body:new Uint8Array(bytes)})
      assert.equal(response.status,status,await response.clone().text()); return response.json()
    }
    await putChunk(wav.subarray(0,4000),0,200); await putChunk(wav.subarray(0,4000),0,200)
    await request('POST', `${recordingRoot}/finalize`,409,{durationSeconds:1,expectedChunks:[{epoch:0,count:2}]})
    await putChunk(wav.subarray(4000),1,200)
    assert.equal((await request('GET',recordingRoot,200)).chunks.length,2)
    await request('GET',recordingRoot,403,undefined,outsider)
    const download = await fetch(`${base}${recordingRoot}/epochs/0/download`)
    assert.equal(download.status,200); assert.deepEqual(Buffer.from(await download.arrayBuffer()),wav)
    await request('POST', `${recordingRoot}/finalize`,200,{durationSeconds:1,expectedChunks:[{epoch:0,count:2}]})
    const { runDueDiligenceArtifactWork } = await import('../services/dueDiligenceInterviewWorkflowService.js')
    await runDueDiligenceArtifactWork(AbortSignal.timeout(30000)); await runDueDiligenceArtifactWork(AbortSignal.timeout(30000))
    const finishedRecording = await request('GET',recordingRoot,200)
    assert.equal(finishedRecording.session.status,'archived',finishedRecording.session.errorMessage)
    assert.equal(finishedRecording.session.fileIds.length,1)
    checks.push('binary-chunk-idempotency-incomplete-finalization-rejected-recovery-download-worker-archive')
    const discarded = await request('POST',`${interviewRoot}/recording-sessions`,201,{...recordingRequest,clientRequestId:randomUUID()})
    await request('POST',`${interviewRoot}/recording-sessions/${discarded.id}/discard`,200,{})
    assert.equal((await request('GET',`${interviewRoot}/recording-sessions/${discarded.id}`,200)).session.status,'discarded')
    const transcript = await request('PUT',`${interviewRoot}/transcript`,200,{content:'受访者表示客户回款需进一步核查，尚未提供银行流水。',status:'已确认',source:'manual',expectedVersion:null})
    assert.equal((await request('GET',`${interviewRoot}/transcript?afterVersion=0`,200)).changed,true)
    assert.equal((await request('GET',`${interviewRoot}/transcript?afterVersion=${transcript.version}`,200)).changed,false)
    await request('PUT',`${interviewRoot}/transcript`,409,{content:'旧稿不得覆盖',status:'草稿',source:'manual',expectedVersion:transcript.version+1})
    const archivedTranscript = await request('POST',`${interviewRoot}/archive`,201,{kind:'transcript',sourceVersion:transcript.version})
    assert.equal((await request('POST',`${interviewRoot}/archive`,200,{kind:'transcript',sourceVersion:transcript.version})).fileId,archivedTranscript.fileId)
    const summary = await request('POST',`${interviewRoot}/summary/tasks`,202,{transcriptVersion:transcript.version})
    await runDueDiligenceArtifactWork(AbortSignal.timeout(30000))
    assert.equal((await request('GET',`${interviewRoot}/summary/tasks`,200)).list[0].status,'failed','未配置模型不得伪装完成')
    // Synthetic ready output tests confirmation independently of a paid model.
    await db.update(dueDiligenceArtifactTasks).set({status:'ready',summary:'访谈陈述：客户称回款正常。待核验：银行流水。',completedChunks:summary.totalChunks}).where(eq(dueDiligenceArtifactTasks.id,summary.id))
    const confirmed = await request('POST',`${interviewRoot}/summary/tasks/${summary.id}/confirm`,200,{summary:'访谈陈述：客户称回款正常。待核验：银行流水。',expectedInterviewVersion:renamed.version})
    assert.ok(confirmed.fileId)
    assert.equal((await request('POST',`${interviewRoot}/summary/tasks/${summary.id}/confirm`,200,{summary:'访谈陈述：客户称回款正常。待核验：银行流水。',expectedInterviewVersion:renamed.version})).fileId,confirmed.fileId)
    checks.push('discard-transcript-delta-version-conflict-idempotent-text-archive-summary-confirmation')
    for (const route of ['/questions', '/interviews', `/question-packs/${pack.id}/docx`]) await request('GET', `${root}${route}`, 403, undefined, outsider)
    await db.update(projectFiles).set({ accessMode: 'explicit' }).where(eq(projectFiles.id, fileId))
    for (const route of ['/questions', '/interviews', `/question-packs/${pack.id}/docx`]) {
      assert.equal((await request('GET', `${root}${route}`, 403)).code, 'DUE_DILIGENCE_SOURCE_FORBIDDEN')
    }
    await request('POST', `${root}/question-packs/generate`, 403, { mode: 'baseline' })
    await db.update(projectFiles).set({ accessMode: 'project', lifecycle: 'deleted', deletedBy: owner, deletedAt: new Date(), deleteReason: '合成回收站验收', retentionUntil: new Date(Date.now() + 86_400_000) }).where(eq(projectFiles.id, fileId))
    await request('GET', `${root}/questions`, 403)
    await db.update(projectFiles).set({ lifecycle: 'active', deletedBy: null, deletedAt: null, deleteReason: null, retentionUntil: null }).where(eq(projectFiles.id, fileId))
    checks.push('outsider-restricted-file-recycled-source-denied')
    const capabilities = await request('GET', '/capabilities', 200)
    assert.equal(capabilities.apiVersion, 2); assert.equal(capabilities.database.ready, true)
    await request('POST', '/capabilities/write-probe', 200, {})
    const twin = await request('POST', '/twins', 201, { name: '合成分身', role: '尽调顾问', rules: '优先核验现金流', cases: '', clientRequestId: randomUUID() })
    const emptyLibrary = await request('GET', `/twins/${twin.id}/skill-library`, 200)
    assert.equal(emptyLibrary.apiVersion, 2); assert.deepEqual(emptyLibrary.assets, []); assert.deepEqual(emptyLibrary.imports, [])
    await request('POST', `/twins/${twin.id}/publish`, 400, { introduction: '合成分身', publicRules: '优先核验现金流' })
    await request('POST', `/twins/${twin.id}/publish`, 200, { introduction: '合成分身', publicRules: '优先核验现金流', publicBoundaries: '核验后判断', confirmed: true, industryTags: [], capabilityTags: [] })
    assert.ok((await request('GET', '/twin-directory', 200)).list.some((row: { twinId: string }) => row.twinId === twin.id))
    await request('POST', `/twins/${twin.id}/withdraw-publication`, 200, {})
    assert.ok(!(await request('GET', '/twin-directory', 200)).list.some((row: { twinId: string }) => row.twinId === twin.id))
    checks.push('capabilities-unified-skill-library-publication-withdrawal')
    const candidateId = randomUUID()
    await db.insert(digitalTwinLearningCandidates).values({ id: candidateId, twinId: twin.id, ownerUserId: owner, sourceFileId: fileId, sourceHash: 'synthetic-hash', sourceName: '合成来源', sourceKey: 'synthetic-key', projectId, rules: '合成规则', cases: '合成案例', boundaries: '合成边界', rationale: '合成依据' })
    const snapshot = async () => {
      const tables = ['digital_twin_learning_candidates', 'digital_twin_experience_events', 'digital_twin_skills', 'digital_twins', 'audit_logs']
      return Promise.all(tables.map(async table => {
        const [rows] = await pool.query(`SELECT * FROM ${quoteMysqlIdentifier(`${targetPrefix}${table}`)} ORDER BY id`)
        return JSON.stringify(rows)
      }))
    }
    const before = await snapshot()
    assert.ok((await request('GET', `/twins/${twin.id}/learning-candidates`, 200)).list.some((row: { id: string }) => row.id === candidateId))
    assert.deepEqual(await snapshot(), before)
    const versionBefore = (await request('GET','/twins',200)).list.find((row:{id:string})=>row.id===twin.id).activeVersion
    await request('POST',`/twins/${twin.id}/learning-candidates/${candidateId}/decision`,200,{decision:'确认'})
    const library = await request('GET',`/twins/${twin.id}/skill-library`,200)
    assert.equal(library.skills.length,1);assert.equal(library.skills[0].status,'已生效')
    const skillDownload = await fetch(`${base}/twins/${twin.id}/skills/${library.skills[0].id}/download`)
    assert.equal(skillDownload.status,200); assert.match(await skillDownload.text(),/## 操作步骤/)
    assert.ok((await request('GET','/twins',200)).list.find((row:{id:string})=>row.id===twin.id).activeVersion>versionBefore)
    const {resolveDueDiligenceTwinContext}=await import('../services/dueDiligenceTwinRuntimeService.js')
    assert.equal((await resolveDueDiligenceTwinContext({userId:owner,twinId:twin.id,projectId,task:'checklist'})).snapshot.skills.length,1)
    await request('PATCH',`/twins/${twin.id}/skills/${library.skills[0].id}`,200,{enabled:false})
    assert.equal((await resolveDueDiligenceTwinContext({userId:owner,twinId:twin.id,projectId,task:'conversation'})).snapshot.skills.length,0)
    await request('PATCH',`/twins/${twin.id}/skills/${library.skills[0].id}`,200,{enabled:true})
    await request('GET',`/twins/${twin.id}/skill-library`,404,undefined,outsider)
    const dialogue = await request('POST',`/twins/${twin.id}/dialogue`,200,{})
    assert.equal(dialogue.snapshot.skills.length,1)
    const {appendMessages}=await import('../services/conversationService.js')
    const messageId=randomUUID()
    await appendMessages(owner,dialogue.conversationId,[{id:randomUUID(),role:'user',content:'合成问题：如何核验回款？',createdAt:new Date().toISOString()},{id:messageId,role:'assistant',content:'合成回答：交叉核对合同和流水，不只依赖口头确认。',createdAt:new Date().toISOString()}])
    await request('POST',`/twins/${twin.id}/conversation-candidates`,202,{conversationId:dialogue.conversationId,messageId,feedback:'采纳'})
    await request('POST',`/twins/${twin.id}/conversation-candidates`,400,{conversationId:dialogue.conversationId,messageId:randomUUID(),feedback:'采纳'})
    const twinVersion = (await request('GET','/twins',200)).list.find((row:{id:string})=>row.id===twin.id).activeVersion
    await runDueDiligenceArtifactWork(AbortSignal.timeout(30000))
    assert.ok((await request('GET',`/twins/${twin.id}/skill-library`,200)).candidates.some((row:{sourceType:string;status:string})=>row.sourceType==='分身对话反馈' && row.status==='待确认'))
    assert.equal((await request('GET','/twins',200)).list.find((row:{id:string})=>row.id===twin.id).activeVersion,twinVersion,'未采纳经验不能改变分身')
    checks.push('confirmed-private-skill-version-runtime-enabled-disabled-isolation-server-backed-feedback')
    await db.update(projectFiles).set({ accessMode: 'explicit' }).where(eq(projectFiles.id, fileId))
    assert.ok(!(await request('GET', `/twins/${twin.id}/learning-candidates`, 200)).list.some((row:{id:string})=>row.id===candidateId))
    await request('GET',`/twins/${twin.id}/skills/${library.skills[0].id}/download`,404)
    assert.equal((await request('GET',`/twins/${twin.id}/skill-library`,200)).skills.length,0)
    assert.equal((await request('GET',`/twins/${twin.id}/skills`,200)).list.length,0)
    assert.equal((await resolveDueDiligenceTwinContext({userId:owner,twinId:twin.id,task:'conversation'})).snapshot.skills.length,0)
    await db.update(projectFiles).set({ accessMode: 'project' }).where(eq(projectFiles.id, fileId))
    await db.update(projects).set({ ownerUserId: outsider }).where(eq(projects.id, projectId))
    assert.ok(!(await request('GET', `/twins/${twin.id}/learning-candidates`, 200)).list.some((row:{id:string})=>row.id===candidateId))
    await db.update(projects).set({ ownerUserId: owner }).where(eq(projects.id, projectId))
    checks.push('learning-candidates-read-only-and-revoked-source-filtered')
    await request('DELETE', `${root}/interviews/${interview.id}`, 204)
    await request('DELETE', `${root}/questions/${question.id}`, 204)
    assert.ok(!(await request('GET', `${root}/interviews`, 200)).list.length)
    checks.push('interview-and-question-delete')
    const { acceptDigitalTwinBuilder }=await import('./digitalTwinBuilderAcceptance.js')
    checks.push(...await acceptDigitalTwinBuilder({request,owner,caller:outsider,setModelResponder:responder=>{modelResponder=responder}}))
    console.log(JSON.stringify({ checks, syntheticDataOnly: true, externalModelCalls: 0, modelContractCalls }))
  }, async () => {
    globalThis.fetch = originalFetch
    await withAcceptanceCleanup(async () => {
      if (server) await new Promise<void>((resolve, reject) => { server!.close(error => error ? reject(error) : resolve()); server!.closeIdleConnections() })
    }, async () => {
      await withAcceptanceCleanup(async () => { await fixturePool?.end() }, async () => {
        const result = await cleanupFdeTables({ targetPrefix, sourcePrefix, sourceTables, connect: async () => {
          const connection = await connect()
          try { await connection.query('SET SESSION lock_wait_timeout=10') }
          catch (error) { await connection.end().catch(() => connection.destroy()); throw error }
          return { tables: prefix => tableNames(connection, prefix), foreignKeys: async enabled => { await connection.query(`SET FOREIGN_KEY_CHECKS=${enabled ? 1 : 0}`) },
            drop: async table => { await connection.query(`DROP TABLE IF EXISTS ${quoteMysqlIdentifier(table)}`) }, close: async () => { await connection.end().catch(() => connection.destroy()) } }
        } })
        console.log(JSON.stringify({ cleanup: true, tables: result.tables, businessTableSetUnchanged: true }))
      })
    })
  })
  lifecycle.checkpoint()
  console.log(JSON.stringify({ ok: true, acceptance: 'due-diligence-release', checks: checks.length, cleanupCompleted: true }))
})
