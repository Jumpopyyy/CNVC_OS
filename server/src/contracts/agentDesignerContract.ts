import type { AgentBlueprint, AgentBlueprintModule } from './agentBlueprintContract.js'

/** Browser-safe conversation contract. Generation never saves or executes a workflow. */
export type AgentDesignerMessage = { role: 'user' | 'assistant'; content: string }
export type AgentDesignerRequest = {
  modelId: string
  messages: AgentDesignerMessage[]
  currentBlueprint?: unknown
  forceGenerate?: boolean
}
export type AgentDesignerBrief = {
  goal: string
  audience: string
  input: string
  output: string
  constraints: string[]
  successCriteria: string[]
}
export type AgentDesignerReply = {
  phase: 'clarify' | 'ready'
  message: string
  question?: { question: string; recommendedAnswer: string; options: string[] }
  brief: AgentDesignerBrief
  nodePlan: { name: string; kind: NonNullable<AgentBlueprintModule['kind']>; reason: string; input: string; output: string }[]
  blueprint?: AgentBlueprint
  skillUsed: 'grill-me' | null
}
