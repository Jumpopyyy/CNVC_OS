import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import type { SQL } from 'drizzle-orm'

// No .env and no network: queries below terminate at an in-memory executor.
Object.assign(process.env, { DB_HOST: '127.0.0.1', DB_PORT: '1', DB_DATABASE: 'agent_boundary_unit', DB_USERNAME: 'unit', DB_PASSWORD: 'unit', DB_FREFIX: 'unit_' })
const { db, pool } = await import('../src/db/client.js')
const { createMySqlAiConfigurationRepository } = await import('../src/repositories/mysql/mysqlAiConfigurationRepository.js')
after(() => pool.end())

for (const method of ['listCapabilitySettings', 'listEnabledCapabilitiesAndBindings', 'findCapability'] as const) {
  test(`private Agent templates are excluded by SQL in ${method}`, async () => {
    const conditions: SQL[] = []
    const query = {
      from() { return this },
      where(condition: SQL) { conditions.push(condition); return this },
      orderBy() { return Promise.resolve([]) },
      limit() { return Promise.resolve([]) },
    }
    const repository = createMySqlAiConfigurationRepository({ select: () => query } as never)
    if (method === 'findCapability') await repository.findCapability('private-id')
    else await repository[method]()
    const compiled = conditions.map(condition => new MySqlDialect().sqlToQuery(condition))
    assert.ok(compiled.some(query => query.params.includes('agent-builder') && /`source` <> \?/.test(query.sql)))
  })
}

test('public capability import cannot overwrite a private Agent with the same key', async (t) => {
  let writes = 0
  const existing = { id: 'private-id', source: 'agent-builder' }
  const query = { from() { return this }, where() { return this }, limit() { return this }, for() { return Promise.resolve([existing]) } }
  t.mock.method(db, 'transaction', async (callback: (tx: unknown) => unknown) => callback({
    select: () => query,
    insert: () => { writes++; throw new Error('must not write') },
    update: () => { writes++; throw new Error('must not write') },
  }))
  const repository = createMySqlAiConfigurationRepository({} as never)
  await assert.rejects(repository.upsertUploadedCapabilityWithAudit({ record: { kind: 'agent', capabilityKey: 'private-key' } } as never), { code: 'CAPABILITY_KEY_RESERVED', status: 409 })
  assert.equal(writes, 0)
})
