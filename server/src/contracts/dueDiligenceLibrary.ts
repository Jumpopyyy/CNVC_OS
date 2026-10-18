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
})
export type LibraryReference = z.infer<typeof LibraryReferenceSchema>
export type LibraryBinding = z.infer<typeof LibraryBindingSchema>
export type LibrarySelection = z.infer<typeof LibrarySelectionSchema>
export type LibraryTask = z.infer<typeof LibraryTaskSchema>
export type LibraryItem = LibraryReference & { name: string; description: string; kind: 'skill' | 'agent'; execution: 'instructions' | 'workflow'; dependencies?: Array<{ id: string; name: string; version: number; hash: string }> }
export type LibrarySnapshot = LibraryItem & { tasks?: LibraryTask[] }
export const libraryKey = (item: Pick<LibraryReference, 'source' | 'id'>) => `${item.source}/${item.id}`
