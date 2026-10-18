import { randomUUID } from 'node:crypto'
import { and, desc, eq, or, sql } from 'drizzle-orm'
import type { db } from '../db/client.js'
type Database = typeof db
async function database(executor?: Database) { return executor ?? (await import('../db/client.js')).db }
import { aiCapabilities, auditLogs } from '../db/schema.js'
import type { AgentBlueprint, AgentBlueprintRecord } from '../contracts/agentBlueprintContract.js'
import type { AiCapabilityActor } from '../services/aiCapabilityService.js'
import { validateAgentBlueprint } from '../services/agentBlueprintService.js'

const SOURCE = 'agent-builder'
export function canCallSavedAgent(row: { source: string; kind: string; createdBy: string | null; config: Record<string, unknown> }, userId: string) {
  return row.source === SOURCE && row.kind === 'agent' && (row.createdBy === userId || row.config.blueprintVisibility === 'organization')
}
function owned(userId: string, id?: string) {
  return and(eq(aiCapabilities.source, SOURCE), eq(aiCapabilities.kind, 'agent'), eq(aiCapabilities.createdBy, userId), ...(id ? [eq(aiCapabilities.id, id)] : []))
}
function view(row: typeof aiCapabilities.$inferSelect): AgentBlueprintRecord {
  return { id: row.id, version: row.version, ownerUserId: row.createdBy ?? undefined, visibility: row.config.blueprintVisibility === 'organization' ? 'organization' : 'private', blueprint: validateAgentBlueprint(row.config.blueprint), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
}
function audit(actor: AiCapabilityActor, action: string, id: string) {
  return { userId: actor.userId, userName: actor.userName, module: 'Agent 搭建', action, target: id, ip: actor.ip }
}
function notFound(): never { throw Object.assign(new Error('个人 Agent 模板不存在'), { status: 404, code: 'AGENT_BLUEPRINT_NOT_FOUND' }) }
function conflict(): never { throw Object.assign(new Error('模板已在其他页面修改，请重新加载后保存'), { status: 409, code: 'AGENT_BLUEPRINT_VERSION_CONFLICT' }) }
export async function listAgentBlueprints(actor: AiCapabilityActor, executor?: Database) {
  const db = await database(executor)
  const rows = await db.select().from(aiCapabilities).where(owned(actor.userId)).orderBy(desc(aiCapabilities.updatedAt)).limit(200)
  return { list: rows.map(view) }
}
export async function createAgentBlueprint(actor: AiCapabilityActor, blueprint: AgentBlueprint, executor?: Database) {
  const db = await database(executor)
  return db.transaction(async (tx) => {
    const id = randomUUID()
    await tx.insert(aiCapabilities).values({ id, kind: 'agent', capabilityKey: `personal:${id}`, source: SOURCE, name: blueprint.name, description: blueprint.description, packageVersion: '1', config: { blueprint }, enabled: false, allowedRoles: [], toolNames: [], dependencyNames: [], createdBy: actor.userId, updatedBy: actor.userId })
    await tx.insert(auditLogs).values(audit(actor, '创建个人模板', id))
    const [created] = await tx.select().from(aiCapabilities).where(owned(actor.userId, id)).limit(1)
    if (!created) notFound()
    return view(created)
  })
}
export async function updateAgentBlueprint(actor: AiCapabilityActor, id: string, expectedVersion: number, blueprint: AgentBlueprint, executor?: Database) {
  const db = await database(executor)
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ version: aiCapabilities.version, config: aiCapabilities.config }).from(aiCapabilities).where(owned(actor.userId, id)).limit(1).for('update')
    if (!existing) notFound()
    if (existing.version !== expectedVersion) conflict()
    const [result] = await tx.update(aiCapabilities).set({ name: blueprint.name, description: blueprint.description, config: { ...existing.config, blueprint }, enabled: false, updatedBy: actor.userId, updatedAt: new Date(), version: sql`${aiCapabilities.version} + 1` }).where(and(owned(actor.userId, id), eq(aiCapabilities.version, expectedVersion)))
    if (result.affectedRows !== 1) conflict()
    await tx.insert(auditLogs).values(audit(actor, '更新个人模板', id))
    const [updated] = await tx.select().from(aiCapabilities).where(owned(actor.userId, id)).limit(1)
    return view(updated)
  })
}
export async function deleteAgentBlueprint(actor: AiCapabilityActor, id: string, expectedVersion: number, executor?: Database) {
  const db = await database(executor)
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ version: aiCapabilities.version }).from(aiCapabilities).where(owned(actor.userId, id)).limit(1).for('update')
    if (!existing) notFound()
    if (existing.version !== expectedVersion) conflict()
    const [result] = await tx.delete(aiCapabilities).where(and(owned(actor.userId, id), eq(aiCapabilities.version, expectedVersion)))
    if (result.affectedRows !== 1) conflict()
    await tx.insert(auditLogs).values(audit(actor, '删除个人模板', id))
    return { deleted: true, id }
  })
}

// Sharing applies only to saved text workflows, not to runtime tool grants or model credentials.
export async function listCallableAgentBlueprints(actor: AiCapabilityActor) {
  const db = await database()
  const rows = await db.select().from(aiCapabilities).where(and(
    eq(aiCapabilities.source, SOURCE), eq(aiCapabilities.kind, 'agent'),
    or(eq(aiCapabilities.createdBy, actor.userId), sql`JSON_UNQUOTE(JSON_EXTRACT(${aiCapabilities.config}, '$.blueprintVisibility')) = 'organization'`),
  )).orderBy(desc(aiCapabilities.updatedAt)).limit(200)
  return rows.map(view)
}

export async function getCallableAgentBlueprint(actor: AiCapabilityActor, id: string, executor?: Database) {
  const db = await database(executor)
  const [row] = await db.select().from(aiCapabilities).where(and(eq(aiCapabilities.id, id), eq(aiCapabilities.source, SOURCE), eq(aiCapabilities.kind, 'agent'))).limit(1)
  if (!row || !canCallSavedAgent(row, actor.userId)) notFound()
  return view(row)
}

export async function setAgentBlueprintSharing(actor: AiCapabilityActor, id: string, expectedVersion: number, visibility: 'private' | 'organization', executor?: Database) {
  const db = await database(executor)
  return db.transaction(async tx => {
    const [row] = await tx.select().from(aiCapabilities).where(owned(actor.userId, id)).limit(1).for('update')
    if (!row || row.createdBy !== actor.userId) notFound()
    if (row.version !== expectedVersion) conflict()
    await tx.update(aiCapabilities).set({ config: { ...row.config, blueprintVisibility: visibility }, version: row.version + 1, updatedAt: new Date(), updatedBy: actor.userId }).where(and(owned(actor.userId, id), eq(aiCapabilities.version, expectedVersion)))
    await tx.insert(auditLogs).values(audit(actor, visibility === 'organization' ? '共享文本工作流' : '撤回工作流共享', id))
    return { ...view(row), version: row.version + 1, visibility }
  })
}
