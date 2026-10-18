import { Router } from 'express'
import { z } from 'zod'
import type { AuthedRequest } from '../middleware/requireAuth.js'
import { listProjectPreddRuns, startProjectPredd } from '../services/projectPreddService.js'

export function createProjectPreddRouter(service = { listProjectPreddRuns, startProjectPredd }) {
  const router = Router()
  const actor = (req: AuthedRequest) => ({ userId: req.user!.uid, userName: req.user!.name, userRole: req.user!.role })
  const id = (value: string | string[]) => z.string().uuid().parse(value)
  router.get('/project-discovery/leads/:id/predd', async (req: AuthedRequest, res, next) => {
    try { res.json({ list: await service.listProjectPreddRuns(id(req.params.id), actor(req)) }) }
    catch (error) { next(error) }
  })
  router.post('/project-discovery/leads/:id/predd', async (req: AuthedRequest, res, next) => {
    try {
      const body = z.object({
        instructions: z.string().trim().max(2_000).optional(),
        attachments: z.array(z.object({
          name: z.string().trim().min(1).max(180),
          declaredType: z.string().max(255).optional(),
          dataBase64: z.string().min(1).max(28_000_000),
        }).strict()).max(2).default([]),
      }).strict().parse(req.body ?? {})
      res.status(202).json(await service.startProjectPredd(id(req.params.id), body, actor(req)))
    } catch (error) { next(error) }
  })
  return router
}

export const projectPreddRouter = createProjectPreddRouter()
