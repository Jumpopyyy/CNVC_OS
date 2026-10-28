type Status = 'running' | 'committing' | 'completed' | 'cancelled' | 'failed'
type Request = { status: Status; controller: AbortController; done: Promise<void>; settle: () => void; updatedAt: number }

// The workbench uses one application process. Revisions in MySQL remain the
// authoritative write guard; this registry only controls in-flight requests.
export function createTwinBuilderRequests() {
  const requests = new Map<string, Request>()
  const locks = new Map<string, string>()
  const key = (scope: string, id: string) => `${scope}:${id}`
  const prune = () => { for (const [id, request] of requests) if (!['running', 'committing'].includes(request.status) && Date.now() - request.updatedAt > 600_000) requests.delete(id) }
  const registry = {
    start(scope: string, id: string) {
      prune()
      const existing = requests.get(key(scope, id))
      if (existing?.status === 'cancelled') throw Object.assign(new Error('本轮已停止'), { status: 409, code: 'TWIN_BUILD_CANCELLED' })
      if (existing || locks.has(scope)) throw Object.assign(new Error('对话正在更新，请稍候再试'), { status: 409 })
      let settle!: () => void
      const request: Request = { status: 'running', controller: new AbortController(), done: new Promise<void>(resolve => { settle = resolve }), settle: () => settle(), updatedAt: Date.now() }
      requests.set(key(scope, id), request); locks.set(scope, id)
      return request.controller.signal
    },
    beginCommit(scope: string, id: string) {
      const request = requests.get(key(scope, id))!
      request.controller.signal.throwIfAborted()
      if (request.status !== 'running') throw new Error('请求已结束')
      request.status = 'committing'
    },
    finish(scope: string, id: string, completed: boolean) {
      const request = requests.get(key(scope, id))
      if (!request) return
      if (request.status !== 'cancelled') request.status = completed ? 'completed' : 'failed'
      request.updatedAt = Date.now(); request.settle()
      if (locks.get(scope) === id) locks.delete(scope)
    },
    async stop(scope: string, id: string): Promise<Status> {
      prune()
      const request = requests.get(key(scope, id))
      if (!request) {
        // A cancel can arrive before the original HTTP request reaches the route.
        const controller = new AbortController(); controller.abort()
        requests.set(key(scope, id), { status: 'cancelled', controller, done: Promise.resolve(), settle: () => {}, updatedAt: Date.now() })
        return 'cancelled'
      }
      if (request.status === 'committing') { await request.done; return request.status }
      if (request.status === 'running') {
        request.status = 'cancelled'; request.controller.abort(); request.updatedAt = Date.now()
        if (locks.get(scope) === id) locks.delete(scope)
      }
      return request.status
    },
  }
  return registry
}
