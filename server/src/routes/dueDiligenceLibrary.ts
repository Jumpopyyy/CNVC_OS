import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { auditLogs, digitalTwins, digitalTwinVersions, digitalTwinSkillImports } from '../db/schema.js'
import type { AuthedRequest } from '../middleware/requireAuth.js'
import { LibraryBindingSchema, LibraryReferenceSchema } from '../contracts/dueDiligenceLibrary.js'
import { getDueDiligenceLibrary, libraryContentHash, loadLibraryReference, validateLibraryBindings } from '../services/dueDiligenceLibraryService.js'
import { prepareDueDiligenceSkillImport } from '../services/dueDiligenceSkillImportService.js'

export const dueDiligenceLibraryRouter = Router()
const actor = (req: AuthedRequest) => ({ userId: req.user!.uid, userName: req.user!.name, role: req.user!.role, department: req.user!.department, ip: req.ip })
async function owned(req: AuthedRequest) {
  const id = z.string().uuid().parse(req.params.id)
  const [row] = await db.select().from(digitalTwins).where(and(eq(digitalTwins.id, id), eq(digitalTwins.ownerUserId, req.user!.uid), isNull(digitalTwins.deletedAt))).limit(1)
  if (!row) throw Object.assign(new Error('数字分身不存在或无权访问'), { status: 404 })
  return row
}
dueDiligenceLibraryRouter.get('/library', async (req: AuthedRequest, res, next) => {
  try { const { projectId } = z.object({ projectId: z.string().uuid().optional() }).parse(req.query); res.json(await getDueDiligenceLibrary(actor(req), projectId)) } catch (error) { next(error) }
})
dueDiligenceLibraryRouter.get('/twins/:id/library-bindings', async (req: AuthedRequest, res, next) => {
  try { const row = await owned(req); res.json({ version: row.activeVersion, bindings: row.libraryBindings }) } catch (error) { next(error) }
})
dueDiligenceLibraryRouter.put('/twins/:id/library-bindings', async (req: AuthedRequest, res, next) => {
  try {
    const row = await owned(req), body = z.object({ expectedVersion: z.number().int().positive(), bindings: z.array(LibraryBindingSchema).max(9) }).strict().parse(req.body)
    if (row.activeVersion !== body.expectedVersion) throw Object.assign(new Error('分身已更新，请刷新后核对能力设置'), { status: 409 })
    await validateLibraryBindings(actor(req), body.bindings)
    const version = body.expectedVersion + 1
    await db.transaction(async tx => {
      const [changed] = await tx.update(digitalTwins).set({ libraryBindings: body.bindings, activeVersion: version, updatedAt: new Date() }).where(and(eq(digitalTwins.id, row.id), eq(digitalTwins.ownerUserId, req.user!.uid), isNull(digitalTwins.deletedAt), eq(digitalTwins.activeVersion, body.expectedVersion)))
      if (changed.affectedRows !== 1) throw Object.assign(new Error('分身已更新，请刷新后保存能力设置'), { status: 409 })
      await tx.insert(digitalTwinVersions).values({ id: randomUUID(), twinId: row.id, ownerUserId: req.user!.uid, version, rules: row.rules, cases: row.cases, libraryBindings: body.bindings, source: 'library' })
      await tx.insert(auditLogs).values({ userId: req.user!.uid, userName: req.user!.name, module: '尽调工作台', action: '保存分身能力绑定', target: `${row.id}:v${version}`, ip: req.ip })
    })
    res.json({ version, bindings: body.bindings })
  } catch (error) { next(error) }
})
dueDiligenceLibraryRouter.post('/twins/:id/library-learn', async (req: AuthedRequest, res, next) => {
  try {
    const twin = await owned(req), ref = LibraryReferenceSchema.parse(req.body)
    const item = await loadLibraryReference(actor(req), ref)
    // A workflow contributes its method description, never its model credentials or runtime outputs.
    const method = item.instructions || item.blueprint!.modules.map(module => `## ${module.name}\n${module.prompt}\n输出要求：${module.outputInstructions}`).join('\n\n')
    const content = `# ${item.name}（个人适配建议）\n\n## 员工本人已确认的判断方式（不能从方法模板推断员工经历）\n${twin.rules.slice(0, 6000)}\n\n## 本人已保存的案例与边界\n${twin.cases.slice(0, 6000)}\n\n## 待学习的方法\n${method}`
    const contentHash = libraryContentHash({ ref, content })
    const prepared = await prepareDueDiligenceSkillImport({ content, sourceName: item.name, role: req.user!.role })
    const warning = [prepared.warning, twin.rules.length > 6000 || twin.cases.length > 6000 ? '本次个人适配仅参考偏好与案例各前6000字符，请核对适用范围。' : ''].filter(Boolean).join('；') || null
    // Recheck after model latency; learning cannot retain a just-withdrawn source.
    await loadLibraryReference(actor(req), ref)
    const parsed = { ...prepared.parsed, libraryRef: ref }
    await db.insert(digitalTwinSkillImports).values({ id: randomUUID(), twinId: twin.id, ownerUserId: req.user!.uid, sourceType: '平台能力学习', sourceName: `${item.name} · 来源 v${item.version} / 分身 v${twin.activeVersion}`, sourceUrl: `cnvc:${ref.source}:${ref.id}`, contentHash, content, parsed, status: '待学习', errorMessage: warning }).onDuplicateKeyUpdate({ set: { contentHash } })
    await db.insert(auditLogs).values({ userId: req.user!.uid, userName: req.user!.name, module: '尽调工作台', action: '添加能力学习建议', target: `${twin.id}:${item.name}:v${item.version}`.slice(0, 255), ip: req.ip })
    res.status(201).json({ ok: true, generationMode: prepared.generationMode, warning, message: '已加入待学习，请编辑后确认；尚未改变判断偏好或启用 Skill' })
  } catch (error) { next(error) }
})
