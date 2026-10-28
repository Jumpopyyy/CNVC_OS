import { z } from 'zod'

export const LibrarySourceSchema = z.enum(['prompt-skill', 'prompt-agent', 'capability-skill', 'workflow'])
export const LibraryTaskSchema = z.enum(['checklist', 'conversation', 'builder'])
export const LibraryReferenceSchema = z.object({
  source: LibrarySourceSchema, id: z.string().regex(/^[a-zA-Z0-9:_-]{1,160}$/),
  version: z.number().int().positive(), hash: z.string().regex(/^[a-f0-9]{64}$/),
})
export const LibraryBindingSchema = LibraryReferenceSchema.extend({
  enabled: z.boolean().default(true), tasks: z.array(LibraryTaskSchema).min(1).max(3),
})
export const LibrarySelectionSchema = z.object({
  skills: z.array(LibraryReferenceSchema).max(4).default([]),
  agent: LibraryReferenceSchema.nullable().optional(),
  // New unified selectors submit the complete selection. Legacy callers keep additive defaults.
  replaceBindings: z.boolean().optional(),
})
export type LibraryReference = z.infer<typeof LibraryReferenceSchema>
export type LibraryBinding = z.infer<typeof LibraryBindingSchema>
export type LibrarySelection = z.infer<typeof LibrarySelectionSchema>
export type LibraryTask = z.infer<typeof LibraryTaskSchema>
export type LibraryItem = LibraryReference & { name: string; description: string; kind: 'skill' | 'agent'; execution: 'instructions' | 'workflow'; dependencies?: Array<{ id: string; name: string; version: number; hash: string }> }
export type LibrarySnapshot = LibraryItem & { tasks?: LibraryTask[] }
export const libraryKey = (item: Pick<LibraryReference, 'source' | 'id'>) => `${item.source}/${item.id}`

export function librarySelectionForTask(bindings: LibraryBinding[], task: LibraryTask, selection?: LibrarySelection): LibrarySelection {
  const skills = new Map((selection?.skills || []).map(item => [libraryKey(item), item]))
  let agent = selection?.agent || null
  if (!selection?.replaceBindings) for (const binding of bindings) {
    if (!binding.enabled || !binding.tasks.includes(task)) continue
    if (binding.source === 'workflow' || binding.source === 'prompt-agent') agent ||= binding
    else if (!skills.has(libraryKey(binding))) skills.set(libraryKey(binding), binding)
  }
  return { skills: [...skills.values()], agent, replaceBindings: true }
}

export function updateLibraryBindingsForTasks(bindings: LibraryBinding[], selection: LibrarySelection, tasks: LibraryTask[]): LibraryBinding[] {
  if (!tasks.length) throw new Error('请选择常用能力的适用场景')
  const selected = [...selection.skills, ...(selection.agent ? [selection.agent] : [])]
  const selectedKeys = new Set(selected.map(libraryKey))
  const result = bindings.flatMap(binding => {
    if (selectedKeys.has(libraryKey(binding))) return []
    const remaining = binding.tasks.filter(task => !tasks.includes(task))
    return remaining.length ? [{ ...binding, tasks: remaining }] : []
  })
  for (const ref of selected) {
    const old = bindings.find(item => libraryKey(item) === libraryKey(ref))
    result.push({ source: ref.source, id: ref.id, version: ref.version, hash: ref.hash, enabled: true,
      tasks: [...new Set([...(old?.enabled ? old.tasks : []), ...tasks])] })
  }
  return result
}
