import { z } from 'zod'

export const ProjectAccessScopeSchema = z.enum(['none', 'own', 'all'])
export type ProjectAccessScope = z.infer<typeof ProjectAccessScopeSchema>

export const ProjectGrantSchema = z.object({
  projectId: z.uuid(),
  canView: z.boolean(),
  canEdit: z.boolean(),
}).strict()

export const ProjectManagementAccessSchema = z.object({
  readScope: ProjectAccessScopeSchema,
  editScope: ProjectAccessScopeSchema,
  grants: z.array(ProjectGrantSchema).max(500),
}).strict().superRefine((value, context) => {
  const rank: Record<ProjectAccessScope, number> = { none: 0, own: 1, all: 2 }
  if (rank[value.editScope] > rank[value.readScope]) {
    context.addIssue({ code: 'custom', path: ['editScope'], message: '编辑范围不能大于查看范围' })
  }
  const ids = new Set<string>()
  value.grants.forEach((grant, index) => {
    if (grant.canEdit && !grant.canView) {
      context.addIssue({ code: 'custom', path: ['grants', index], message: '编辑项目必须同时允许查看' })
    }
    if (ids.has(grant.projectId)) {
      context.addIssue({ code: 'custom', path: ['grants', index], message: '项目不能重复授权' })
    }
    ids.add(grant.projectId)
  })
})

export type ProjectManagementAccess = z.infer<typeof ProjectManagementAccessSchema>

export function projectManagementAccessDecision(
  policy: ProjectManagementAccess | null,
  actorId: string,
  project: { id: string; ownerUserId: string | null; createdBy: string | null; memberUserIds: readonly string[] },
  capability: 'read' | 'edit',
): boolean | null {
  if (!policy) return null
  const own = project.ownerUserId === actorId || project.createdBy === actorId || project.memberUserIds.includes(actorId)
  const scopeAllows = (scope: ProjectAccessScope) => scope === 'all' || (scope === 'own' && own)
  const grant = policy.grants.find((item) => item.projectId === project.id)
  return capability === 'edit'
    ? scopeAllows(policy.editScope) || Boolean(grant?.canEdit)
    : scopeAllows(policy.readScope) || scopeAllows(policy.editScope) || Boolean(grant?.canView || grant?.canEdit)
}
