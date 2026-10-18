import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db/client.js'
import { auditLogs, digitalTwinInquiries, digitalTwinProjectKnowledge, digitalTwins, projects, users } from '../db/schema.js'
import type { AuthedRequest } from '../middleware/requireAuth.js'
import { projectAccessCondition } from '../services/projectAccessService.js'
import { projectSummaryFileAccessCondition } from '../services/projectFileAccessService.js'
import { requireTwinKnowledgeScope } from '../services/digitalTwinKnowledgeService.js'

export const digitalTwinKnowledgeRouter = Router()
digitalTwinKnowledgeRouter.get('/twins/inquiries', async (req: AuthedRequest, res, next) => {
  try {
    const list = await db.select({ id: digitalTwinInquiries.id, twinId: digitalTwins.id, twinName: digitalTwins.name, projectId: projects.id, projectName: projects.name, callerName: users.name, question: digitalTwinInquiries.question, status: digitalTwinInquiries.status, reply: digitalTwinInquiries.reply, createdAt: digitalTwinInquiries.createdAt }).from(digitalTwinInquiries)
      .innerJoin(digitalTwins, eq(digitalTwins.id, digitalTwinInquiries.twinId)).innerJoin(projects, eq(projects.id, digitalTwinInquiries.projectId)).innerJoin(users, eq(users.id, digitalTwinInquiries.callerUserId))
      .where(and(eq(digitalTwinInquiries.ownerUserId, req.user!.uid), eq(digitalTwins.ownerUserId, req.user!.uid), isNull(digitalTwins.deletedAt), projectAccessCondition({ uid: req.user!.uid, name: req.user!.name, role: req.user!.role }), projectSummaryFileAccessCondition(req.user!.uid)))
      .orderBy(desc(eq(digitalTwinInquiries.status, '待补充')), desc(digitalTwinInquiries.createdAt)).limit(100)
    res.json({ list })
  } catch (error) { next(error) }
})
digitalTwinKnowledgeRouter.post('/twins/:id/inquiries/:inquiryId/reply', async (req: AuthedRequest, res, next) => {
  try {
    const twinId = z.string().uuid().parse(req.params.id); const inquiryId = z.string().uuid().parse(req.params.inquiryId)
    const body = z.object({ decision: z.enum(['补充', '暂不纳入']), content: z.string().trim().max(16000).default('') }).parse(req.body)
    if (body.decision === '补充' && body.content.length < 4) throw Object.assign(new Error('请填写实际处理情况，并尽量说明发生日期、金额口径与依据'), { status: 400 })
    const [item] = await db.select().from(digitalTwinInquiries).where(and(eq(digitalTwinInquiries.id, inquiryId), eq(digitalTwinInquiries.twinId, twinId), eq(digitalTwinInquiries.ownerUserId, req.user!.uid))).limit(1)
    if (!item) throw Object.assign(new Error('补充提醒不存在'), { status: 404 })
    await requireTwinKnowledgeScope(twinId, req.user!.uid, item.projectId)
    const status = body.decision === '补充' ? '已补充' : '暂不纳入'
    await db.transaction(async tx => {
      const [claimed] = await tx.update(digitalTwinInquiries).set({ status, reply: body.content || null, answeredAt: new Date() }).where(and(eq(digitalTwinInquiries.id, inquiryId), eq(digitalTwinInquiries.status, '待补充')))
      if (claimed.affectedRows !== 1) throw Object.assign(new Error('该提醒已处理，请刷新'), { status: 409 })
      if (body.decision === '补充') await tx.insert(digitalTwinProjectKnowledge).values({ id: randomUUID(), twinId, ownerUserId: req.user!.uid, projectId: item.projectId, inquiryId, title: item.question.slice(0, 255), content: body.content })
      await tx.insert(auditLogs).values({ userId: req.user!.uid, userName: req.user!.name, module: '尽调工作台', action: `数字分身项目问询${status}`, target: inquiryId })
    })
    res.json({ status })
  } catch (error) { next(error) }
})
