import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { agentBlueprintsRouter } from '../src/routes/agentBlueprints.js'

test('HTTP import validates portable documents, cannot accept actor overrides, and respects feature gate', async () => {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { Object.assign(req, { user: { uid: 'owner', name: 'Owner', role: '研究员', department: '研究' } }); next() })
  app.use('/api/agent-blueprints', agentBlueprintsRouter)
  app.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(error.status ?? 400).json({ message: 'invalid request' }) })
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/agent-blueprints`
  const post = (path: string, body: unknown) => fetch(`${base}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const blueprint = { schemaVersion: 1, name: '导入模板', description: '', modules: [{ id: 'first', name: '处理', modelId: '11111111-1111-4111-8111-111111111111', prompt: '处理', inputTemplate: '{{input}}', skillIds: [], outputFormat: 'text', outputInstructions: '' }] }
  const previous = process.env.AI_CAPABILITIES_ENABLED
  try {
    process.env.AI_CAPABILITIES_ENABLED = 'true'
    const imported = await post('import', { document: blueprint })
    assert.equal(imported.status, 200); assert.deepEqual(await imported.json(), { blueprint })
    assert.equal((await post('import', { document: blueprint, userId: 'other' })).status, 400)
    assert.equal((await post('import', { document: { ...blueprint, modules: [] } })).status, 400)
    assert.equal((await post('generate', { description: 'valid description', modelId: 'invalid' })).status, 400)
    assert.equal((await post('run', { blueprint, input: 'x'.repeat(60001) })).status, 400)
    process.env.AI_CAPABILITIES_ENABLED = 'false'
    assert.equal((await post('import', { document: blueprint })).status, 503)
  } finally {
    if (previous === undefined) delete process.env.AI_CAPABILITIES_ENABLED; else process.env.AI_CAPABILITIES_ENABLED = previous
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('HTTP CRUD, catalog, generation, export and run bind the authenticated actor', async () => {
  const { createAgentBlueprintRouter } = await import('../src/routes/agentBlueprints.js')
  const blueprint = { schemaVersion: 1 as const, name: '模板', description: '', modules: [{ id: 'first', name: '处理', modelId: '11111111-1111-4111-8111-111111111111', prompt: '处理', inputTemplate: '{{input}}', skillIds: [], outputFormat: 'text' as const, outputInstructions: '' }] }
  const id = '22222222-2222-4222-8222-222222222222'
  const record = { id, version: 1, blueprint, createdAt: '', updatedAt: '' }
  const actors: string[] = []
  const capture = (actor: { userId: string }) => actors.push(actor.userId)
  const app = express(); app.use(express.json())
  app.use((req, _res, next) => { Object.assign(req, { user: { uid: 'authenticated-owner', name: 'Owner', role: '研究员', department: '研究' } }); next() })
  app.use(createAgentBlueprintRouter({
    catalog: async (actor) => { capture(actor); return { models: [], skills: [] } },
    list: async (actor) => { capture(actor); return { list: [record] } },
    create: async (actor) => { capture(actor); return record },
    update: async (actor) => { capture(actor); return record },
    delete: async (actor) => { capture(actor); return { deleted: true, id } },
    generate: async (actor, _description, _modelId, signal) => { capture(actor); assert.ok(signal instanceof AbortSignal); return { blueprint } },
    run: async (actor, _blueprint, _input, through, signal) => { capture(actor); assert.equal(through, 'first'); assert.ok(signal instanceof AbortSignal); return { id, status: 'succeeded', output: 'done', steps: [], durationMs: 1 } },
    runNode: async (actor, _blueprint, moduleId, context, signal) => { capture(actor); assert.equal(moduleId, 'first'); assert.equal(context.previous, '手动上游'); assert.ok(signal instanceof AbortSignal); return { id, status: 'succeeded', output: 'node done', steps: [], durationMs: 1 } },
    export: async (actor) => { capture(actor); return { filename: 'agent.json', mimeType: 'application/json', content: '{}' } },
  }))
  app.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(error.status ?? 400).json({ message: 'invalid request' }) })
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const request = (path: string, method: string, body?: unknown) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  try {
    assert.equal((await request('/catalog', 'GET')).status, 200)
    assert.equal((await request('/', 'GET')).status, 200)
    assert.equal((await request('/', 'POST', { blueprint })).status, 201)
    assert.equal((await request(`/${id}`, 'PUT', { blueprint, expectedVersion: 1 })).status, 200)
    assert.equal((await request(`/${id}`, 'DELETE', { expectedVersion: 1 })).status, 200)
    assert.equal((await request('/generate', 'POST', { description: '帮我拆解研究需求', modelId: blueprint.modules[0].modelId })).status, 200)
    assert.equal((await request('/run', 'POST', { blueprint, input: '材料', throughModuleId: 'first' })).status, 200)
    assert.equal((await request('/run-node', 'POST', { blueprint, moduleId: 'first', context: { input: '材料', previous: '手动上游', outputs: {} } })).status, 200)
    assert.equal((await request('/export', 'POST', { blueprint, format: 'json' })).status, 200)
    assert.equal((await request(`/${id}`, 'PUT', { blueprint, expectedVersion: 0 })).status, 400)
    assert.equal(actors.length, 9); assert.ok(actors.every((actor) => actor === 'authenticated-owner'))
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
})
