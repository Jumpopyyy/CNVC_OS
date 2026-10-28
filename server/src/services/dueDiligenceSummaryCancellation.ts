// Persistent run tokens fence late responses and late cancellation requests.
const active = new Map<string, { controller: AbortController; runToken?: string }>()
export function registerSummaryCancellation(id: string, runToken?: string) {
  const controller = new AbortController()
  active.set(id, { controller, runToken })
  return { signal: controller.signal, release: () => { if (active.get(id)?.controller === controller) active.delete(id) } }
}
export function abortSummaryRequest(id: string, runToken?: string) {
  const request = active.get(id)
  if (request && (runToken === undefined || request.runToken === runToken)) request.controller.abort(new DOMException('员工停止生成', 'AbortError'))
}
