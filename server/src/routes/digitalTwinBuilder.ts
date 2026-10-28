import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db/client.js'
import { auditLogs, digitalTwinBuildSessions, digitalTwins } from '../db/schema.js'
import type { AuthedRequest } from '../middleware/requireAuth.js'
import { appendMessages, createConversation, getConversation, type ChatMessageRow } from '../services/conversationService.js'
import { buildDigitalTwinProposal } from '../services/digitalTwinBuilderService.js'
import { LibrarySelectionSchema } from '../contracts/dueDiligenceLibrary.js'
import { executeDueDiligenceLibrary, libraryContentHash, resolveDueDiligenceLibrary } from '../services/dueDiligenceLibraryService.js'
import { historyBeforeTwinBuilderEdit, visibleTwinBuilderMessages, twinBuilderTurns, twinBuilderRevision, requireTwinBuilderRevision, twinBuilderContext } from '../contracts/digitalTwinBuilderConversation.js'
import { createTwinBuilderRequests } from '../services/digitalTwinBuilderRequests.js'

export const digitalTwinBuilderRouter = Router()
const ScopeSchema = z.object({ twinId: z.uuid().optional(), draftId: z.uuid() })
const Schema = ScopeSchema.extend({ draft: z.object({ name: z.string().max(64), rules: z.string().max(30000), cases: z.string().max(30000) }), preferenceBase: z.string().max(30000).optional(), message: z.string().trim().min(1).max(8000).optional(), requestId: z.uuid().optional(), expectedRevision: z.uuid().nullable().optional(), edit: z.object({ messageId: z.uuid(), expectedContent: z.string().max(8000), expectedLastMessageId: z.uuid() }).optional(), librarySelection: LibrarySelectionSchema.optional() }).refine(body => !body.edit || Boolean(body.message), { message: '编辑消息不能为空' })
const requests = createTwinBuilderRequests()
async function checkOwner(userId: string, twinId?: string) {
  if (twinId && !(await db.select({ id: digitalTwins.id }).from(digitalTwins).where(and(eq(digitalTwins.id, twinId), eq(digitalTwins.ownerUserId, userId), isNull(digitalTwins.deletedAt))).limit(1))[0]) throw Object.assign(new Error('分身不存在或已删除'), { status: 404 })
}
const scopeOf = (userId: string, body: z.infer<typeof ScopeSchema>) => `${userId}:${body.twinId || body.draftId}`
async function readSession(userId: string, body: z.infer<typeof ScopeSchema>) {
  await checkOwner(userId, body.twinId)
  const [session] = await db.select().from(digitalTwinBuildSessions).where(and(eq(digitalTwinBuildSessions.ownerUserId, userId), eq(digitalTwinBuildSessions.scopeKey, body.twinId || body.draftId))).limit(1)
  return session ? await getConversation(userId, session.conversationId) : undefined
}
function resultFor(messages: ChatMessageRow[], requestId: string) {
  const reply = visibleTwinBuilderMessages(messages).find(item => item.role === 'assistant' && item.metadata?.twinBuildRequestId === requestId)
  return { messages: visibleTwinBuilderMessages(messages), revision: twinBuilderRevision(messages), ...(reply ? { proposal: reply.metadata?.twinBuildProposal, proposalBase: reply.metadata?.twinBuildProposalBase, proposalRevision: reply.id, librarySnapshot: reply.metadata?.librarySnapshot } : {}) }
}

digitalTwinBuilderRouter.post('/twins/builder/stop', async (req: AuthedRequest, res, next) => {
  try {
    const body = ScopeSchema.extend({ requestId: z.uuid() }).parse(req.body), userId = req.user!.uid
    const before = await readSession(userId, body)
    const completed = (before?.messages as ChatMessageRow[] | undefined)?.some(item => item.metadata?.twinBuildRequestId === body.requestId)
    const status = completed ? 'completed' : await requests.stop(scopeOf(userId, body), body.requestId)
    const latest = await readSession(userId, body)
    await db.insert(auditLogs).values({ userId, userName: req.user!.name, module: '尽调工作台', action: '停止分身整理', target: body.twinId || body.draftId })
    res.json({ status, ...resultFor((latest?.messages || []) as ChatMessageRow[], body.requestId) })
  } catch (error) { next(error) }
})

digitalTwinBuilderRouter.delete('/twins/builder/turns/:turnId', async (req: AuthedRequest, res, next) => {
  let scope: string | undefined, operation: string | undefined, committed = false
  try {
    const body = ScopeSchema.extend({ expectedRevision: z.uuid().nullable() }).parse(req.body), userId = req.user!.uid
    const turnId = z.uuid().parse(req.params.turnId)
    const conversation = await readSession(userId, body)
    if (!conversation) throw Object.assign(new Error('构建会话不存在'), { status: 404 })
    const key = scopeOf(userId, body), id = randomUUID()
    requests.start(key, id); scope = key; operation = id
    const stored = conversation.messages as ChatMessageRow[]
    requireTwinBuilderRevision(stored, body.expectedRevision)
    if (!twinBuilderTurns(visibleTwinBuilderMessages(stored)).some(turn => turn.id === turnId)) throw Object.assign(new Error('该轮问答已删除或不属于当前对话'), { status: 404 })
    const marker: ChatMessageRow = { id: randomUUID(), role: 'assistant', content: '', metadata: { twinBuildDeletedTurnId: turnId }, createdAt: new Date().toISOString() }
    requests.beginCommit(key, id)
    if (!await appendMessages(userId, conversation.id, [marker], undefined, body.expectedRevision)) throw Object.assign(new Error('对话已更新，请重新加载后重试'), { status: 409 })
    committed = true; requests.finish(key, id, true)
    await db.insert(auditLogs).values({ userId, userName: req.user!.name, module: '尽调工作台', action: '删除分身构建问答', target: `${body.twinId || body.draftId}:${turnId}` })
    const messages = [...stored, marker]
    res.json({ messages: visibleTwinBuilderMessages(messages), revision: marker.id })
  } catch (error) { next(error) } finally { if (scope && operation) requests.finish(scope, operation, committed) }
})

digitalTwinBuilderRouter.post('/twins/builder', async (req: AuthedRequest, res, next) => {
  let scope: string | undefined, requestId: string | undefined, committed = false
  const close = () => { if (!res.writableEnded && scope && requestId) void requests.stop(scope, requestId) }; res.on('close', close)
  try {
    const body = Schema.parse(req.body); const userId = req.user!.uid
    await checkOwner(userId, body.twinId)
    const scopeKey = body.twinId || body.draftId
    let [session] = await db.select().from(digitalTwinBuildSessions).where(and(eq(digitalTwinBuildSessions.ownerUserId, userId), eq(digitalTwinBuildSessions.scopeKey, scopeKey))).limit(1)
    if (!session) {
      const conversation = await createConversation(userId, { title: '数字分身 · 构建', scope: 'global', userRole: req.user!.role })
      await db.insert(digitalTwinBuildSessions).values({ id: randomUUID(), ownerUserId: userId, scopeKey, conversationId: conversation.id }).onDuplicateKeyUpdate({ set: { scopeKey } })
      ;[session] = await db.select().from(digitalTwinBuildSessions).where(and(eq(digitalTwinBuildSessions.ownerUserId, userId), eq(digitalTwinBuildSessions.scopeKey, scopeKey))).limit(1)
    }
    const conversation = await getConversation(userId, session.conversationId)
    if (!conversation) throw Object.assign(new Error('构建会话不可访问'), { status: 404 })
    const storedMessages = conversation.messages as ChatMessageRow[]
    const activeMessages = visibleTwinBuilderMessages(storedMessages)
    if (!body.message) { res.json({ conversationId: conversation.id, messages: activeMessages, revision: twinBuilderRevision(storedMessages) }); return }
    const id = body.requestId || randomUUID(), key = scopeOf(userId, body)
    if (storedMessages.some(item => item.metadata?.twinBuildRequestId === id)) { res.json({ status: 'completed', ...resultFor(storedMessages, id) }); return }
    const signal = requests.start(key, id); scope = key; requestId = id
    if (res.destroyed) await requests.stop(key, id)
    signal.throwIfAborted()
    if (body.expectedRevision !== undefined) requireTwinBuilderRevision(storedMessages, body.expectedRevision)
    const contextMessages = body.edit ? historyBeforeTwinBuilderEdit(activeMessages, body.edit) : activeMessages
    const libraryActor = { userId, userName: req.user!.name, role: req.user!.role, department: req.user!.department }
    const resolve = async () => {
      const [twin] = body.twinId ? await db.select().from(digitalTwins).where(and(eq(digitalTwins.id, body.twinId), eq(digitalTwins.ownerUserId, userId), isNull(digitalTwins.deletedAt))).limit(1) : []
      return resolveDueDiligenceLibrary({ actor: libraryActor, task: 'builder', selection: body.librarySelection, bindings: twin?.libraryBindings })
    }
    const library = await resolve(), libraryContextKey = libraryContentHash(library.snapshot)
    const visibleHistory = twinBuilderContext(contextMessages).filter(item => item.metadata?.libraryContextKey === libraryContextKey || !library.snapshot.length && !item.metadata?.libraryContextKey)
    const history = visibleHistory.filter((item): item is typeof item & {role:'user'|'assistant'} => item.role === 'user' || item.role === 'assistant')
    const workflow = await executeDueDiligenceLibrary(libraryActor, library, `目的：提出员工可编辑的判断方法建议，不推测员工经历。\n草稿：${JSON.stringify(body.draft).slice(0, 30000)}\n补充：${body.message}\n方法：${library.prompt.slice(0, 10000)}`, signal)
    signal.throwIfAborted()
    const result = await buildDigitalTwinProposal({ role: req.user!.role, draft: body.draft, message: body.message, history, libraryContext: `${library.prompt}\n${workflow?.output.slice(0, 16000) || ''}`, signal })
    if (libraryContentHash((await resolve()).snapshot) !== libraryContextKey) throw Object.assign(new Error('参考能力已更新或撤回，请重新整理'), { status: 409 })
    await checkOwner(userId, body.twinId)
    signal.throwIfAborted()
    const latest = await getConversation(userId, conversation.id)
    if (!latest || (latest.messages as ChatMessageRow[]).at(-1)?.id !== storedMessages.at(-1)?.id) throw Object.assign(new Error('对话已更新，输入已保留，请刷新后重试'), { status: 409 })
    const metadata = { libraryContextKey, librarySnapshot: library.snapshot, twinBuildRequestId: id, twinBuildTurnId: randomUUID() }
    const proposalBase = body.preferenceBase ?? body.draft.rules
    const messages = [{ id: randomUUID(), role: 'user' as const, content: body.message, metadata: { ...metadata, ...(body.edit ? { twinBuildReplacesMessageId: body.edit.messageId } : {}) }, createdAt: new Date().toISOString() }, { id: randomUUID(), role: 'assistant' as const, content: result.proposal.reply, metadata: { ...metadata, twinBuildProposal: result.proposal, twinBuildProposalBase: proposalBase }, createdAt: new Date().toISOString() }]
    requests.beginCommit(key, id)
    if (!await appendMessages(userId, conversation.id, messages, undefined, storedMessages.at(-1)?.id ?? null)) throw Object.assign(new Error('构建会话已不存在，输入已保留'), { status: 404 })
    committed = true; requests.finish(key, id, true)
    await db.insert(auditLogs).values({ userId, userName: req.user!.name, module: '尽调工作台', action: body.edit ? '编辑分身构建对话' : '对话构建数字分身', target: body.twinId || body.draftId })
    res.json({ ...result, proposalBase, proposalRevision: messages[1].id, revision: messages[1].id, conversationId: conversation.id, messages: [...contextMessages, ...messages], librarySnapshot: library.snapshot, warnings: library.warnings })
  } catch (error) { next(error) } finally { if (scope && requestId) requests.finish(scope, requestId, committed); res.off('close', close) }
})
