import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db/client.js'
import { auditLogs, digitalTwinBuildSessions, digitalTwins } from '../db/schema.js'
import type { AuthedRequest } from '../middleware/requireAuth.js'
import { appendMessages, createConversation, getConversation } from '../services/conversationService.js'
import { buildDigitalTwinProposal } from '../services/digitalTwinBuilderService.js'
import { LibrarySelectionSchema } from '../contracts/dueDiligenceLibrary.js'
import { executeDueDiligenceLibrary, libraryContentHash, resolveDueDiligenceLibrary } from '../services/dueDiligenceLibraryService.js'

export const digitalTwinBuilderRouter = Router()
const Schema = z.object({ twinId: z.string().uuid().optional(), draftId: z.string().uuid(), draft: z.object({ name: z.string().max(64), rules: z.string().max(30000), cases: z.string().max(30000) }), message: z.string().trim().min(1).max(8000).optional(), librarySelection: LibrarySelectionSchema.optional() })
const pending = new Set<string>()
digitalTwinBuilderRouter.post('/twins/builder', async (req: AuthedRequest, res, next) => {
  let lock: string | undefined
  const controller = new AbortController(); const close = () => { if (!res.writableEnded) controller.abort() }; res.on('close', close)
  try {
    const body = Schema.parse(req.body); const userId = req.user!.uid
    const checkOwner = async () => { if (body.twinId && !(await db.select({ id: digitalTwins.id }).from(digitalTwins).where(and(eq(digitalTwins.id, body.twinId), eq(digitalTwins.ownerUserId, userId), isNull(digitalTwins.deletedAt))).limit(1))[0]) throw Object.assign(new Error('分身不存在或已删除'), { status: 404 }) }
    await checkOwner()
    const scopeKey = body.twinId || body.draftId
    let [session] = await db.select().from(digitalTwinBuildSessions).where(and(eq(digitalTwinBuildSessions.ownerUserId, userId), eq(digitalTwinBuildSessions.scopeKey, scopeKey))).limit(1)
    if (!session) {
      const conversation = await createConversation(userId, { title: '数字分身 · 构建', scope: 'global', userRole: req.user!.role })
      await db.insert(digitalTwinBuildSessions).values({ id: randomUUID(), ownerUserId: userId, scopeKey, conversationId: conversation.id }).onDuplicateKeyUpdate({ set: { scopeKey } })
      ;[session] = await db.select().from(digitalTwinBuildSessions).where(and(eq(digitalTwinBuildSessions.ownerUserId, userId), eq(digitalTwinBuildSessions.scopeKey, scopeKey))).limit(1)
    }
    const conversation = await getConversation(userId, session.conversationId)
    if (!conversation) throw Object.assign(new Error('构建会话不可访问'), { status: 404 })
    if (!body.message) { res.json({ conversationId: conversation.id, messages: conversation.messages }); return }
    lock = session.id
    if (pending.has(lock)) { lock = undefined; throw Object.assign(new Error('正在整理分身，请稍候'), { status: 409 }) }
    pending.add(lock)
    const libraryActor = { userId, userName: req.user!.name, role: req.user!.role, department: req.user!.department }
    const resolve = async () => {
      const [twin] = body.twinId ? await db.select().from(digitalTwins).where(and(eq(digitalTwins.id, body.twinId), eq(digitalTwins.ownerUserId, userId), isNull(digitalTwins.deletedAt))).limit(1) : []
      return resolveDueDiligenceLibrary({ actor: libraryActor, task: 'builder', selection: body.librarySelection, bindings: twin?.libraryBindings })
    }
    const library = await resolve(), libraryContextKey = libraryContentHash(library.snapshot)
    const visibleHistory = (conversation.messages as Array<{ role: string; content: string; metadata?: Record<string, unknown> }>).filter(item => item.metadata?.libraryContextKey === libraryContextKey || !library.snapshot.length && !item.metadata?.libraryContextKey)
    const history = visibleHistory.filter((item): item is typeof item & {role:'user'|'assistant'} => item.role === 'user' || item.role === 'assistant')
    const workflow = await executeDueDiligenceLibrary(libraryActor, library, `目的：提出员工可编辑的判断方法建议，不推测员工经历。\n草稿：${JSON.stringify(body.draft).slice(0, 30000)}\n补充：${body.message}\n方法：${library.prompt.slice(0, 10000)}`, controller.signal)
    const result = await buildDigitalTwinProposal({ role: req.user!.role, draft: body.draft, message: body.message, history, libraryContext: `${library.prompt}\n${workflow?.output.slice(0, 16000) || ''}`, signal: controller.signal })
    if (libraryContentHash((await resolve()).snapshot) !== libraryContextKey) throw Object.assign(new Error('参考能力已更新或撤回，请重新整理'), { status: 409 })
    await checkOwner()
    controller.signal.throwIfAborted()
    const metadata = { libraryContextKey, librarySnapshot: library.snapshot }
    const messages = [{ id: randomUUID(), role: 'user' as const, content: body.message, metadata, createdAt: new Date().toISOString() }, { id: randomUUID(), role: 'assistant' as const, content: result.proposal.reply, metadata: { ...metadata, twinBuildProposal: result.proposal }, createdAt: new Date().toISOString() }]
    await appendMessages(userId, conversation.id, messages)
    await db.insert(auditLogs).values({ userId, userName: req.user!.name, module: '尽调工作台', action: '对话构建数字分身', target: body.twinId || body.draftId })
    res.json({ ...result, conversationId: conversation.id, messages: [...visibleHistory, ...messages], librarySnapshot: library.snapshot, warnings: library.warnings })
  } catch (error) { next(error) } finally { if (lock) pending.delete(lock); res.off('close', close) }
})
