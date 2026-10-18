import { and, asc, eq, inArray, like, ne, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  projectManagementAccessGrants, projectManagementAccessPolicies, projects, users,
} from '../db/schema.js'
import { ProjectManagementAccessSchema, type ProjectManagementAccess } from '../contracts/projectManagementAccessContract.js'
import { createMySqlIdentityRepositoryContext } from '../repositories/index.js'
import { emitAuthInvalidation } from '../runtime/authSessionEvents.js'

type Actor = { userId: string; userName: string }

function accessError(status: number, code: string, message: string) {
  return Object.assign(new Error(message), { status, code })
}

export async function listProjectManagementAccessPolicies() {
  const [policies, grants] = await Promise.all([
    db.select().from(projectManagementAccessPolicies),
    db.select({ userId: projectManagementAccessGrants.userId, canEdit: projectManagementAccessGrants.canEdit }).from(projectManagementAccessGrants),
  ])
  return policies.filter((policy) => policy.mode === 'custom').map((policy) => ({
    userId: policy.userId, readScope: policy.readScope, editScope: policy.editScope,
    grantCount: grants.filter((grant) => grant.userId === policy.userId).length,
    editGrantCount: grants.filter((grant) => grant.userId === policy.userId && grant.canEdit).length,
  }))
}

export async function getProjectManagementAccess(userId: string) {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw accessError(404, 'USER_NOT_FOUND', '用户不存在')
  const [policy] = await db.select().from(projectManagementAccessPolicies)
    .where(eq(projectManagementAccessPolicies.userId, userId)).limit(1)
  if (!policy || policy.mode === 'inherit') return { mode: 'inherit' as const, version: policy?.version ?? null, readScope: 'none' as const, editScope: 'none' as const, grants: [] }
  const grants = await db.select({
    projectId: projectManagementAccessGrants.projectId,
    projectName: projects.name,
    canView: projectManagementAccessGrants.canView,
    canEdit: projectManagementAccessGrants.canEdit,
  }).from(projectManagementAccessGrants)
    .innerJoin(projects, eq(projects.id, projectManagementAccessGrants.projectId))
    .where(eq(projectManagementAccessGrants.userId, userId)).orderBy(asc(projects.name))
  return { mode: 'custom' as const, version: policy.version, readScope: policy.readScope, editScope: policy.editScope, grants }
}

export async function searchProjectManagementAccessOptions(keyword: string) {
  const term = keyword.trim()
  return db.select({ id: projects.id, name: projects.name, companyName: projects.companyName })
    .from(projects).where(and(
      ne(projects.lifecycle, 'deleted'),
      term ? or(like(projects.name, `%${term}%`), like(projects.companyName, `%${term}%`)) : undefined,
    )).orderBy(asc(projects.name)).limit(50)
}

export async function saveProjectManagementAccess(
  userId: string,
  input: { mode: 'inherit'; expectedVersion: number | null } | ({ mode: 'custom'; expectedVersion: number | null } & ProjectManagementAccess),
  actor: Actor,
) {
  const parsed = input.mode === 'custom' ? ProjectManagementAccessSchema.parse({
    readScope: input.readScope, editScope: input.editScope, grants: input.grants,
  }) : null
  await db.transaction(async (tx) => {
    const identity = createMySqlIdentityRepositoryContext(tx)
    const administrator = await identity.users.lockById(actor.userId)
    if (!administrator || administrator.status !== '启用' || !(await identity.users.listPermissionCodes(administrator.id)).includes('system.manage')) {
      throw accessError(403, 'ROLE_FORBIDDEN', '仅系统管理员可修改项目权限')
    }
    const target = await identity.users.lockById(userId)
    if (!target) throw accessError(404, 'USER_NOT_FOUND', '用户不存在')
    const [current] = await tx.select().from(projectManagementAccessPolicies)
      .where(eq(projectManagementAccessPolicies.userId, userId)).for('update').limit(1)
    if ((current?.version ?? null) !== input.expectedVersion) {
      throw accessError(409, 'VERSION_CONFLICT', '项目权限已被其他管理员修改，请刷新后重试')
    }
    if (parsed) {
      const projectIds = parsed.grants.map((grant) => grant.projectId)
      if (projectIds.length) {
        const valid = await tx.select({ id: projects.id }).from(projects)
          .where(and(inArray(projects.id, projectIds), ne(projects.lifecycle, 'deleted')))
        if (valid.length !== projectIds.length) throw accessError(400, 'PROJECT_GRANT_INVALID', '包含不存在或已删除的项目')
      }
      if (current) {
        await tx.update(projectManagementAccessPolicies).set({
          mode: 'custom', readScope: parsed.readScope, editScope: parsed.editScope,
          version: current.version + 1, updatedAt: new Date(),
        }).where(eq(projectManagementAccessPolicies.userId, userId))
      } else {
        await tx.insert(projectManagementAccessPolicies).values({
          userId, mode: 'custom', readScope: parsed.readScope, editScope: parsed.editScope,
        })
      }
    } else if (current) {
      await tx.update(projectManagementAccessPolicies).set({
        mode: 'inherit', readScope: 'none', editScope: 'none',
        version: current.version + 1, updatedAt: new Date(),
      }).where(eq(projectManagementAccessPolicies.userId, userId))
    } else {
      await tx.insert(projectManagementAccessPolicies).values({ userId, mode: 'inherit', readScope: 'none', editScope: 'none' })
    }
    await tx.delete(projectManagementAccessGrants).where(eq(projectManagementAccessGrants.userId, userId))
    if (parsed?.grants.length) {
      await tx.insert(projectManagementAccessGrants).values(parsed.grants.map((grant) => ({ userId, ...grant })))
    }
    const revokedSessions = await identity.users.revokeActiveSessions(userId, new Date())
    await identity.audits.append({
      userId: administrator.id, userName: administrator.name, module: '项目授权', action: '调整成员项目权限',
      target: JSON.stringify({ targetUserId: userId, mode: input.mode, readScope: parsed?.readScope, editScope: parsed?.editScope, grants: parsed?.grants, revokedSessions }),
    })
  })
  emitAuthInvalidation({ type: 'user', userId })
  return getProjectManagementAccess(userId)
}
