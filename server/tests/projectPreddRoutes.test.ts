import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { createProjectPreddRouter } from '../src/routes/projectPredd.js'

test('PreDD HTTP endpoints bind the authenticated actor, validate uploads and propagate failures', async () => {
  const calls: unknown[][] = []
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { Object.assign(req, { user: { uid: 'owner', name: '研究员', role: '投资经理' } }); next() })
  app.use(createProjectPreddRouter({
    listProjectPreddRuns: async (...args) => { calls.push(args); return [] },
    startProjectPredd: async (...args) => {
      calls.push(args)
      if (args[1].instructions === '模拟失败') throw Object.assign(new Error('模型不可用'), { status: 503 })
      return { id: 'chat', agentId: 'agent', status: 'streaming', createdAt: 'now', error: null }
    },
  }))
  app.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status || 400).json({ error: 'request rejected' }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address() as { port: number }
  const base = `http://127.0.0.1:${address.port}/project-discovery/leads/00000000-0000-4000-8000-000000000001/predd`
  const post = (body: unknown, url = base) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    assert.equal((await fetch(base)).status, 200)
    assert.equal((await post({ instructions: '查客户', attachments: [{ name: 'BP.pdf', dataBase64: 'abc' }] })).status, 202)
    assert.deepEqual(calls[1][2], { userId: 'owner', userName: '研究员', userRole: '投资经理' })
    assert.equal((await post({ userId: 'another-user' })).status, 400)
    assert.equal((await post({ instructions: 'x'.repeat(2001) })).status, 400)
    assert.equal((await post({ attachments: Array.from({ length: 3 }, () => ({ name: 'a.pdf', dataBase64: 'abc' })) })).status, 400)
    assert.equal((await post({}, base.replace('00000000-0000-4000-8000-000000000001', 'invalid'))).status, 400)
    assert.equal(calls.length, 2, 'invalid input must never reach the runtime')
    assert.equal((await post({ instructions: '模拟失败' })).status, 503)
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
})
