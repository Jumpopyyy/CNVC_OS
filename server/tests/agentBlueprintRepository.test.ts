import assert from 'node:assert/strict'
import test from 'node:test'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import type { AgentBlueprint } from '../src/contracts/agentBlueprintContract.js'

for (const [key, value] of Object.entries({ DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_DATABASE: 'isolated_unit_test', DB_USERNAME: 'unit', DB_PASSWORD: 'unused', DB_FREFIX: 'unit_' })) process.env[key] ??= value

test('private repository binds owner and source to all queries and enforces version conflicts', async () => {
  const { listAgentBlueprints, createAgentBlueprint, updateAgentBlueprint, deleteAgentBlueprint } = await import('../src/repositories/agentBlueprintRepository.js')
  const { aiCapabilities } = await import('../src/db/schema.js')
  const dialect = new MySqlDialect()
  const rows = new Map<string, Record<string, unknown>>()
  const scopes: unknown[][] = []
  const audit: Record<string, unknown>[] = []
  const now = new Date()
  function matches(where: Parameters<typeof dialect.sqlToQuery>[0]) {
    const query = dialect.sqlToQuery(where)
    assert.match(query.sql, /source/); assert.match(query.sql, /created_by/); assert.match(query.sql, /kind/)
    const params = query.params
    scopes.push(params)
    return [...rows.values()].filter((row) => row.source === params[0] && row.kind === params[1] && row.createdBy === params[2] && (typeof params[3] !== 'string' || row.id === params[3]))
  }
  const executor = {
    transaction: async (work: (tx: unknown) => Promise<unknown>) => work(executor),
    select: () => ({ from: () => ({ where: (condition: Parameters<typeof dialect.sqlToQuery>[0]) => {
      const found = matches(condition)
      const result = Promise.resolve(found)
      return Object.assign(result, { orderBy: () => ({ limit: async () => found }), limit: () => Object.assign(Promise.resolve(found), { for: async () => found }) })
    } }) }),
    insert: (table: unknown) => ({ values: async (value: Record<string, unknown>) => { if (table === aiCapabilities) rows.set(value.id as string, { version: 1, createdAt: now, updatedAt: now, ...value }); else audit.push(value) } }),
    update: () => ({ set: (patch: Record<string, unknown>) => ({ where: async (condition: Parameters<typeof dialect.sqlToQuery>[0]) => { const found = matches(condition); for (const row of found) rows.set(row.id as string, { ...row, ...patch, version: Number(row.version) + 1 }); return [{ affectedRows: found.length }] } }) }),
    delete: () => ({ where: async (condition: Parameters<typeof dialect.sqlToQuery>[0]) => { const found = matches(condition); found.forEach((row) => rows.delete(row.id as string)); return [{ affectedRows: found.length }] } }),
  } as unknown as NonNullable<Parameters<typeof listAgentBlueprints>[1]>
  const actor = { userId: 'owner-a', userName: 'Alice', role: '研究员', department: '研究' }
  const other = { ...actor, userId: 'owner-b' }
  const blueprint: AgentBlueprint = { schemaVersion: 1, name: '私有模板', description: '', modules: [{ id: 'first', name: '处理', modelId: '11111111-1111-4111-8111-111111111111', prompt: '处理', inputTemplate: '{{input}}', skillIds: [], outputFormat: 'text', outputInstructions: '' }] }
  const created = await createAgentBlueprint(actor, blueprint, executor)
  assert.equal(created.version, 1)
  assert.equal(rows.get(created.id)!.enabled, false)
  assert.equal(rows.get(created.id)!.source, 'agent-builder')
  assert.equal((await listAgentBlueprints(other, executor)).list.length, 0)
  assert.equal((await listAgentBlueprints(actor, executor)).list[0].id, created.id)
  await assert.rejects(updateAgentBlueprint(other, created.id, 1, blueprint, executor), { status: 404 })
  await assert.rejects(deleteAgentBlueprint(other, created.id, 1, executor), { status: 404 })
  const updated = await updateAgentBlueprint(actor, created.id, 1, { ...blueprint, name: '更新模板' }, executor)
  assert.equal(updated.version, 2)
  await assert.rejects(updateAgentBlueprint(actor, created.id, 1, blueprint, executor), { status: 409 })
  await assert.rejects(deleteAgentBlueprint(actor, created.id, 1, executor), { status: 409 })
  assert.equal((await deleteAgentBlueprint(actor, created.id, 2, executor)).deleted, true)
  assert.equal(audit.length, 3)
  assert.ok(!JSON.stringify(audit).includes('prompt'))
  assert.ok(scopes.every((params) => params[0] === 'agent-builder' && params[1] === 'agent'))
})
