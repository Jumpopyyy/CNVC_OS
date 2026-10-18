import type { AgentBlueprint, AgentBlueprintCondition, AgentBlueprintModule } from './agentBlueprintContract.js'
const forbidden = new Set(['__proto__', 'prototype', 'constructor', 'start', 'input', 'inputs', 'previous', 'modules'])
export function safeAgentInputName(name: string): boolean { return /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(name) && !forbidden.has(name) }
export function agentJsonPath(path: string): string[] {
  if (!path) return []
  if (!/^[A-Za-z_][A-Za-z0-9_]*(?:(?:\.[A-Za-z_][A-Za-z0-9_]*)|(?:\[\d{1,6}\]))*$/.test(path) && !/^\[\d{1,6}\](?:(?:\.[A-Za-z_][A-Za-z0-9_]*)|(?:\[\d{1,6}\]))*$/.test(path)) throw new Error('JSON 路径仅支持字段名、点与数字下标')
  const parts = path.replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '').split('.')
  if (parts.some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))) throw new Error('JSON 路径不允许原型字段')
  return parts
}
export function joinAgentBlueprintText(parts: string[], separator = ''): string {
  let length = separator.length * Math.max(0, parts.length - 1)
  for (const part of parts) { length += part.length; if (length > 120_000) throw new Error('模块输入超过 120000 字符限制') }
  return parts.join(separator)
}
export function resolveAgentBlueprintVariables(blueprint: AgentBlueprint, variables: Record<string, string> = {}, referencedNames?: Set<string>): Record<string, string> {
  const fields = blueprint.inputFields ?? []
  if (Object.keys(variables).some((name) => !fields.some((field) => field.name === name))) throw new Error('输入变量不存在')
  return Object.fromEntries(fields.map((field) => {
    const value = Object.hasOwn(variables, field.name) ? variables[field.name] : (field.defaultValue ?? '')
    if (typeof value !== 'string' || value.length > 60_000) throw new Error('输入变量超过限制')
    if (referencedNames && !referencedNames.has(field.name)) return [field.name, value]
    if (field.required && !value.trim()) throw new Error(`请填写 ${field.label}`)
    if (value !== '') {
      if (field.type === 'number' && (!value.trim() || !Number.isFinite(Number(value)))) throw new Error(`${field.label} 需要数字`)
      if (field.type === 'boolean' && !['true', 'false'].includes(value)) throw new Error(`${field.label} 需要 true 或 false`)
      if (field.type === 'select' && !field.options?.includes(value)) throw new Error(`${field.label} 选项无效`)
    }
    return [field.name, value]
  }))
}
export function agentSourceValue(source: string, input: string, outputs: Record<string, string>, previous: string, variables: Record<string, string> = {}): string {
  if (source === 'input') return input
  if (source === 'previous') return previous
  if (source.startsWith('inputs.')) return Object.hasOwn(variables, source.slice(7)) ? variables[source.slice(7)] : ''
  return Object.hasOwn(outputs, source) ? outputs[source] : ''
}
export function testAgentCondition(condition: AgentBlueprintCondition, input: string, outputs: Record<string, string>, previous: string, variables: Record<string, string> = {}): boolean {
  const source = agentSourceValue(condition.source, input, outputs, previous, variables)
  const left = Number(source); const right = Number(condition.value)
  const numeric = Boolean(source.trim() && condition.value.trim()) && Number.isFinite(left) && Number.isFinite(right)
  switch (condition.operator) {
    case 'contains': return source.includes(condition.value)
    case 'not_contains': return !source.includes(condition.value)
    case 'equals': return source.trim() === condition.value.trim()
    case 'not_equals': return source.trim() !== condition.value.trim()
    case 'empty': return !source.trim()
    case 'not_empty': return Boolean(source.trim())
    case 'gt': return numeric && left > right
    case 'gte': return numeric && left >= right
    case 'lt': return numeric && left < right
    case 'lte': return numeric && left <= right
  }
}
export function executeAgentManualModule(module: AgentBlueprintModule, rendered: string, input: string, outputs: Record<string, string>, previous: string, variables: Record<string, string>): string {
  switch (module.kind) {
    case 'output': case 'template': return rendered
    case 'json-extract': {
      let value: unknown = JSON.parse(rendered)
      for (const key of agentJsonPath(module.jsonExtract!.path)) {
        if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key)) {
          if (module.jsonExtract!.missing === 'empty') return module.outputFormat === 'json' ? 'null' : ''
          throw new Error('JSON 路径不存在')
        }
        value = (value as Record<string, unknown>)[key]
      }
      return module.outputFormat === 'json' ? JSON.stringify(value) : typeof value === 'string' ? value : JSON.stringify(value)
    }
    case 'aggregate': {
      const config = module.aggregate!
      const parts = config.sources.map((source) => agentSourceValue(source, input, outputs, previous, variables))
      return config.mode === 'first-non-empty' ? (parts.find((part) => part.trim()) ?? '') : joinAgentBlueprintText(parts, config.separator)
    }
    case 'text-process': {
      const config = module.textProcess!
      switch (config.operation) {
        case 'trim': return rendered.trim()
        case 'uppercase': return rendered.toUpperCase()
        case 'lowercase': return rendered.toLowerCase()
        case 'slice': return rendered.slice(config.start, config.end)
        case 'replace': {
          const search = config.search!; const replacement = config.replacement ?? ''
          const parts = rendered.split(search)
          return joinAgentBlueprintText(parts, replacement)
        }
      }
    }
    default: throw new Error('节点类型无效')
  }
}
