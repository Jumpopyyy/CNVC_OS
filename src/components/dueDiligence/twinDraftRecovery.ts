import { z } from 'zod'
import type { TwinBuildProposal, TwinBuildUpload, TwinDraft } from './types'

export type TwinBuilderDraft = { message: string; proposal: TwinBuildProposal | null; proposalAsset: TwinBuildUpload | null }
export const emptyTwinBuilderDraft = (): TwinBuilderDraft => ({ message: '', proposal: null, proposalAsset: null })
export type TwinRecoveryContent = { draft: TwinDraft; draftId: string; builder: TwinBuilderDraft }
export type TwinRecoveryRecord = { ownerId: string; revision: number; updatedAt: number; content: TwinRecoveryContent | null }
export const TWIN_DRAFT_TTL = 7 * 24 * 60 * 60 * 1000
const text = z.string().max(100_000)
const contentSchema = z.object({
  draftId: z.uuid(),
  draft: z.object({
    id: z.union([z.uuid(), z.literal('')]), expectedVersion: z.number().int().positive().optional(),
    name: z.string().max(256), role: z.string().max(128), rules: text, cases: text,
    description: text.optional(), descriptionMode: z.enum(['auto', 'manual']).optional(),
    avatarPreset: z.string().max(64).nullable().optional(), avatarDataUrl: z.string().max(3_000_000).nullable().optional(),
    assetAdoptions: z.array(z.object({ assetId: z.uuid(), traits: text, expectedSuggestion: text })).max(20).optional(),
  }),
  builder: z.object({
    message: text,
    proposal: z.object({ reply: text, description: text, rules: text, cases: text, followUps: z.array(z.object({ question: text, options: z.array(text).max(10) })).max(10) }).nullable(),
    proposalAsset: z.object({ name: text, assetId: z.uuid().optional(), status: z.enum(['parsing', 'ready', 'adopted', 'error']), traits: text.optional(), error: text.optional() }).nullable(),
  }),
})

// A browser draft is never a saved twin, a learning decision, or a publication.
export function recoverTwinDraft(raw: unknown, ownerId: string, now = Date.now()): TwinRecoveryRecord {
  const record = z.object({ ownerId: z.string(), revision: z.number().int().nonnegative(), updatedAt: z.number(), content: z.unknown() }).safeParse(raw)
  if (!record.success || record.data.ownerId !== ownerId) return { ownerId, revision: 0, updatedAt: now, content: null }
  const valid = contentSchema.safeParse(record.data.content)
  return { ...record.data, content: valid.success && now - record.data.updatedAt <= TWIN_DRAFT_TTL && record.data.updatedAt <= now + 60_000 ? valid.data : null }
}

export function nextTwinDraftRecord(current: TwinRecoveryRecord | undefined, ownerId: string, expectedRevision: number, content: TwinRecoveryContent | null): TwinRecoveryRecord {
  if (current && current.ownerId !== ownerId) throw new Error('草稿账号不匹配，请重新登录')
  if ((current?.revision || 0) !== expectedRevision) throw new Error('另一页面已更新恢复草稿。请先复制当前未保存文字，再刷新页面核对，避免相互覆盖。')
  if (content && JSON.stringify(content).length > 4_000_000) throw new Error('草稿过大，未能暂存；请保存分身后再离开')
  const parsed = content ? contentSchema.safeParse(content) : null
  if (parsed && !parsed.success) throw new Error('草稿包含过长或无效字段，未能暂存；请检查输入并保存分身')
  return { ownerId, revision: expectedRevision + 1, updatedAt: Date.now(), content: parsed?.success ? parsed.data : null }
}

let database: Promise<IDBDatabase> | undefined
function openDatabase() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('此浏览器不支持草稿恢复')); return }
    const request = indexedDB.open('cnvc-twin-draft-recovery', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'ownerId' })
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined }; resolve(request.result) }
    request.onerror = () => reject(new Error('无法打开草稿暂存，请检查浏览器存储权限'))
    request.onblocked = () => reject(new Error('草稿暂存被旧页面占用，请关闭旧页面后重试'))
  }).catch(error => { database = undefined; throw error })
  return database
}
export async function readTwinDraft(ownerId: string): Promise<TwinRecoveryRecord> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readonly')
    const request = tx.objectStore('drafts').get(ownerId)
    tx.oncomplete = () => resolve(recoverTwinDraft(request.result, ownerId))
    tx.onabort = tx.onerror = () => reject(new Error('读取草稿失败，请勿关闭尚未保存内容的页面'))
  })
}
export async function writeTwinDraft(ownerId: string, revision: number, content: TwinRecoveryContent | null): Promise<TwinRecoveryRecord> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite')
    const store = tx.objectStore('drafts'); const request = store.get(ownerId)
    let result: TwinRecoveryRecord; let conflict: Error | undefined
    request.onsuccess = () => { try { result = nextTwinDraftRecord(request.result, ownerId, revision, content); store.put(result) } catch (error) { conflict = error as Error; tx.abort() } }
    tx.oncomplete = () => resolve(result)
    tx.onabort = tx.onerror = () => reject(conflict || new Error('草稿暂存失败，可能存储空间不足；请保存分身后再离开'))
  })
}
