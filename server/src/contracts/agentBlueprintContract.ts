/** Browser-safe, provider-neutral workflow contract. No credentials or executable code. */
export type AgentBlueprintCondition = {
  /** input, previous, or a preceding module ID */
  source: string
  operator: 'contains' | 'not_contains' | 'equals' | 'not_equals' | 'empty' | 'not_empty' | 'gt' | 'gte' | 'lt' | 'lte'
  value: string
}
export type AgentBlueprintModule = {
  /** Omitted kind preserves the original sequential LLM behavior. */
  kind?: 'llm' | 'condition' | 'output' | 'template' | 'json-extract' | 'aggregate' | 'text-process'
  id: string
  name: string
  modelId: string
  prompt: string
  /** Supports {{input}}, {{previous}}, {{modules.<preceding module id>}}. */
  inputTemplate: string
  skillIds: string[]
  outputFormat: 'text' | 'markdown' | 'json'
  outputInstructions: string
  condition?: AgentBlueprintCondition
  conditionGroup?: { mode: 'and' | 'or'; rules: AgentBlueprintCondition[] }
  modelOptions?: { temperature?: number; maxTokens?: number }
  jsonExtract?: { path: string; missing: 'empty' | 'error' }
  aggregate?: { sources: string[]; mode: 'first-non-empty' | 'concat'; separator: string }
  textProcess?: { operation: 'trim' | 'uppercase' | 'lowercase' | 'replace' | 'slice'; search?: string; replacement?: string; start?: number; end?: number }
  errorPolicy?: { retryCount: number; onFailure: 'stop' | 'fallback'; fallbackOutput?: string }
}
export type AgentBlueprintEdge = { id: string; source: string; target: string; branch?: 'true' | 'false' }
export type AgentBlueprintGraph = {
  /** start is a virtual node; condition branches activate only their matching path. */
  edges: AgentBlueprintEdge[]
  positions: Record<string, { x: number; y: number }>
}
export type AgentBlueprint = {
  schemaVersion: 1
  name: string
  description: string
  modules: AgentBlueprintModule[]
  graph?: AgentBlueprintGraph
  inputFields?: AgentBlueprintInputField[]
}
export type AgentBlueprintInputField = { name: string; label: string; type: 'text' | 'number' | 'boolean' | 'select'; required: boolean; defaultValue?: string; options?: string[] }
export type AgentBlueprintNodeContext = { input: string; previous: string; outputs: Record<string, string>; variables?: Record<string, string> }
export type AgentBlueprintRecord = {
  id: string
  version: number
  visibility?: 'private' | 'organization'
  ownerUserId?: string
  blueprint: AgentBlueprint
  createdAt: string
  updatedAt: string
}
export type AgentBlueprintCatalog = {
  models: { id: string; name: string; modelKey: string }[]
  skills: { id: string; name: string; description: string; executionMode: 'instructions-only' }[]
}
export type AgentBlueprintStepResult = {
  moduleId: string
  name: string
  modelId: string
  status: 'succeeded' | 'skipped' | 'failed'
  input: string
  output: string
  error?: string
  durationMs: number
  attempts?: number
  fallback?: boolean
  conditionMatched?: boolean
}
export type AgentBlueprintRun = {
  id: string
  status: 'succeeded' | 'failed'
  steps: AgentBlueprintStepResult[]
  output: string
  durationMs: number
}
export type AgentBlueprintExport = { filename: string; mimeType: string; content: string }
