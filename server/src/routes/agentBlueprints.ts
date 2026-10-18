import { Router } from 'express'
import { z } from 'zod'
import type { AuthedRequest } from '../middleware/requireAuth.js'
import { requireAiCapabilitiesEnabled } from '../config/extensionFeatureFlags.js'
import { validateAgentBlueprint, getAgentBlueprintCatalog, generateAgentBlueprint, runAgentBlueprint, runAgentBlueprintNode, importAgentBlueprint, exportAuthorizedAgentBlueprint } from '../services/agentBlueprintService.js'
import { designAgentChat, parseAgentDesignerRequest } from '../services/agentDesignerService.js'
import type { AiCapabilityActor } from '../services/aiCapabilityService.js'

const defaultOperations = {
  design: designAgentChat, catalog: getAgentBlueprintCatalog, generate: generateAgentBlueprint, run: runAgentBlueprint, runNode: runAgentBlueprintNode,
  export: exportAuthorizedAgentBlueprint,
  list: async (actor: AiCapabilityActor) => (await import('../repositories/agentBlueprintRepository.js')).listAgentBlueprints(actor),
  create: async (actor: AiCapabilityActor, blueprint: ReturnType<typeof validateAgentBlueprint>) => (await import('../repositories/agentBlueprintRepository.js')).createAgentBlueprint(actor, blueprint),
  update: async (actor: AiCapabilityActor, id: string, version: number, blueprint: ReturnType<typeof validateAgentBlueprint>) => (await import('../repositories/agentBlueprintRepository.js')).updateAgentBlueprint(actor, id, version, blueprint),
  delete: async (actor: AiCapabilityActor, id: string, version: number) => (await import('../repositories/agentBlueprintRepository.js')).deleteAgentBlueprint(actor, id, version),
}
export function createAgentBlueprintRouter(operations: Omit<typeof defaultOperations, 'design'> & Partial<Pick<typeof defaultOperations, 'design'>> = defaultOperations) {
const agentBlueprintsRouter = Router()
agentBlueprintsRouter.use(requireAiCapabilitiesEnabled)
function actor(req: AuthedRequest): AiCapabilityActor {
  return { userId: req.user!.uid, userName: req.user!.name, role: req.user!.role, department: req.user!.department, ip: req.ip }
}
const version = z.number().int().min(1)
const uuid = z.string().uuid()
const variablesSchema = z.record(z.string().max(48), z.string().max(60_000)).refine((value) => Object.keys(value).length <= 8, '变量最多 8 项')
agentBlueprintsRouter.get('/shared', async (req: AuthedRequest, res, next) => {
  try { const { listCallableAgentBlueprints } = await import('../repositories/agentBlueprintRepository.js'); res.json({ list: await listCallableAgentBlueprints(actor(req)) }) } catch (error) { next(error) }
})
agentBlueprintsRouter.patch('/:id/sharing', async (req: AuthedRequest, res, next) => {
  try { const body = z.object({ expectedVersion: version, visibility: z.enum(['private', 'organization']) }).strict().parse(req.body); const { setAgentBlueprintSharing } = await import('../repositories/agentBlueprintRepository.js'); res.json(await setAgentBlueprintSharing(actor(req), uuid.parse(req.params.id), body.expectedVersion, body.visibility)) } catch (error) { next(error) }
})
agentBlueprintsRouter.get('/catalog', async (req: AuthedRequest, res, next) => {
  try { res.json(await operations.catalog(actor(req))) } catch (error) { next(error) }
})
agentBlueprintsRouter.get('/', async (req: AuthedRequest, res, next) => {
  try { res.json(await operations.list(actor(req))) } catch (error) { next(error) }
})
agentBlueprintsRouter.post('/generate', async (req: AuthedRequest, res, next) => {
  try {
    const body = z.object({ description: z.string().trim().min(5).max(20_000), modelId: uuid }).strict().parse(req.body)
    const controller = new AbortController(); const close = () => { if (!res.writableEnded) controller.abort() }; res.on('close', close)
    try { res.json(await operations.generate(actor(req), body.description, body.modelId, controller.signal)) } finally { res.off('close', close) }
  } catch (error) { next(error) }
})
agentBlueprintsRouter.post('/design-chat', async (req: AuthedRequest, res, next) => {
  try {
    const body = parseAgentDesignerRequest(req.body)
    const controller = new AbortController(); const close = () => { if (!res.writableEnded) controller.abort() }; res.on('close', close)
    try { res.json(await (operations.design ?? defaultOperations.design)(actor(req), body, controller.signal)) } finally { res.off('close', close) }
  } catch (error) { next(error) }
})
agentBlueprintsRouter.post('/run', async (req: AuthedRequest, res, next) => {
  try {
    const body = z.object({ blueprint: z.unknown(), input: z.string().max(60_000), throughModuleId: z.string().max(48).optional(), variables: variablesSchema.optional() }).strict().parse(req.body)
    const controller = new AbortController(); const close = () => { if (!res.writableEnded) controller.abort() }; res.on('close', close)
    try { res.json(await operations.run(actor(req), body.blueprint, body.input, body.throughModuleId, controller.signal, undefined, body.variables)) } finally { res.off('close', close) }
  } catch (error) { next(error) }
})
agentBlueprintsRouter.post('/run-node', async (req: AuthedRequest, res, next) => {
  try {
    const body = z.object({ blueprint: z.unknown(), moduleId: z.string().min(1).max(48), context: z.object({ input: z.string().max(60_000), previous: z.string().max(120_000), outputs: z.record(z.string().max(48), z.string().max(120_000)).refine((value) => Object.keys(value).length <= 12), variables: variablesSchema.optional() }).strict() }).strict().parse(req.body)
    const controller = new AbortController(); const close = () => { if (!res.writableEnded) controller.abort() }; res.on('close', close)
    try { res.json(await operations.runNode(actor(req), body.blueprint, body.moduleId, body.context, controller.signal)) } finally { res.off('close', close) }
  } catch (error) { next(error) }
})
agentBlueprintsRouter.post('/import', async (req: AuthedRequest, res, next) => {
  try { const body = z.object({ document: z.unknown() }).strict().parse(req.body); res.json({ blueprint: importAgentBlueprint(body.document) }) } catch (error) { next(error) }
})
agentBlueprintsRouter.post('/export', async (req: AuthedRequest, res, next) => {
  try { const body = z.object({ blueprint: z.unknown(), format: z.enum(['json', 'markdown']) }).strict().parse(req.body); res.json(await operations.export(actor(req), body.blueprint, body.format)) } catch (error) { next(error) }
})
agentBlueprintsRouter.post('/', async (req: AuthedRequest, res, next) => {
  try { const body = z.object({ blueprint: z.unknown() }).strict().parse(req.body); res.status(201).json(await operations.create(actor(req), validateAgentBlueprint(body.blueprint))) } catch (error) { next(error) }
})
agentBlueprintsRouter.put('/:id', async (req: AuthedRequest, res, next) => {
  try { const body = z.object({ blueprint: z.unknown(), expectedVersion: version }).strict().parse(req.body); res.json(await operations.update(actor(req), uuid.parse(req.params.id), body.expectedVersion, validateAgentBlueprint(body.blueprint))) } catch (error) { next(error) }
})
agentBlueprintsRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try { const body = z.object({ expectedVersion: version }).strict().parse(req.body); res.json(await operations.delete(actor(req), uuid.parse(req.params.id), body.expectedVersion)) } catch (error) { next(error) }
})

return agentBlueprintsRouter
}
export const agentBlueprintsRouter = createAgentBlueprintRouter()
