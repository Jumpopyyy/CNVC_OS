import { createHash } from 'node:crypto'

export type QuestionEvidenceDraft = { fileId: string; fileVersion: number; excerpt: string; locator?: string; contentHash?: string | null }
export type ExpertQuestionReference = { publicationId: string; publishedVersion: number; ruleExcerpt: string }
export type GeneratedQuestionDraft = {
  title: string; category: string; priority: '高' | '中' | '低'; evidenceRequirement: string; rationale: string
  sourceNames: string[]; publicationIds: string[]; sourceKind?: string; templateItemId?: string; attentionSource?: string
  evidence?: QuestionEvidenceDraft[]; generationKeys?: string[]; expertReferences?: ExpertQuestionReference[]
}
export type ExistingQuestionReference = { id: string; title: string; generationKey?: string | null; generationKeys?: string[] | null; deletedAt?: Date | string | null; version: number }
export type QuestionReviewItem = { index: number; key: string; action: 'new' | 'existing' | 'suppressed' | 'similar'; existingQuestionId?: string; existingTitle?: string; expectedVersion?: number; similarity?: number }

export const normalizeQuestionTitle = (title: string) => title.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
export function stableQuestionKey(question: Pick<GeneratedQuestionDraft, 'title' | 'templateItemId'>): string {
  return question.templateItemId ? `template:${question.templateItemId}` : `title:${createHash('sha256').update(normalizeQuestionTitle(question.title)).digest('hex')}`
}
export function questionKeys(question: GeneratedQuestionDraft): string[] {
  return [...new Set([stableQuestionKey(question), stableQuestionKey({ title: question.title }), ...(question.generationKeys || [])])]
}
const uniqueEvidence = (items: QuestionEvidenceDraft[]) => [...new Map(items.map(item => [`${item.fileId}:${item.fileVersion}:${item.excerpt}`, item])).values()]
const shortAttention = (value?: string) => value && Array.from(value).length > 512 ? `${Array.from(value).slice(0, 511).join('')}…` : value

/** Same-title AI enrichment wins over the template, without discarding its stable key. */
export function combineGeneratedQuestions(items: GeneratedQuestionDraft[]): GeneratedQuestionDraft[] {
  const combined = new Map<string, GeneratedQuestionDraft>()
  const ranks = { 高: 0, 中: 1, 低: 2 }
  for (const item of items) {
    const title = normalizeQuestionTitle(item.title)
    const previous = combined.get(title)
    if (!previous) { combined.set(title, { ...item, attentionSource: shortAttention(item.attentionSource), generationKeys: questionKeys(item), evidence: uniqueEvidence(item.evidence || []) }); continue }
    const enhanced = item.sourceKind !== '标准模板' && item.sourceKind !== '规则匹配'
    combined.set(title, { ...previous, ...(enhanced ? item : {}),
      templateItemId: previous.templateItemId || item.templateItemId,
      priority: ranks[item.priority] < ranks[previous.priority] ? item.priority : previous.priority,
      publicationIds: [...new Set([...previous.publicationIds, ...item.publicationIds])],
      attentionSource: shortAttention([...new Set([previous.attentionSource, item.attentionSource].filter(Boolean))].join('；')),
      sourceNames: [...new Set([...previous.sourceNames, ...item.sourceNames])],
      evidence: uniqueEvidence([...(previous.evidence || []), ...(item.evidence || [])]),
      expertReferences: [...new Map([...(previous.expertReferences || []), ...(item.expertReferences || [])].map(ref => [`${ref.publicationId}:${ref.publishedVersion}:${ref.ruleExcerpt}`, ref])).values()],
      generationKeys: [...new Set([...questionKeys(previous), ...questionKeys(item)])],
    })
  }
  return [...combined.values()].sort((a, b) => ranks[a.priority] - ranks[b.priority])
}

export function questionSimilarity(left: string, right: string): number {
  const grams = (value: string) => { const text = normalizeQuestionTitle(value); return new Set(Array.from({ length: Math.max(text.length - 1, 0) }, (_, index) => text.slice(index, index + 2))) }
  const a = grams(left); const b = grams(right)
  if (!a.size || !b.size) return 0
  return 2 * [...a].filter(item => b.has(item)).length / (a.size + b.size)
}

/** Similarity is a suggestion only. Deleted/excluded stable sources stay suppressed. */
export function buildQuestionReview(generated: GeneratedQuestionDraft[], existing: ExistingQuestionReference[]): QuestionReviewItem[] {
  return generated.map((question, index) => {
    const key = stableQuestionKey(question); const keys = questionKeys(question)
    const exact = existing.find(item => keys.some(value => value === item.generationKey || item.generationKeys?.includes(value)) || normalizeQuestionTitle(item.title) === normalizeQuestionTitle(question.title))
    if (exact) return { index, key, action: exact.deletedAt ? 'suppressed' : 'existing', existingQuestionId: exact.id, existingTitle: exact.title, expectedVersion: exact.version }
    const similar = existing.filter(item => !item.deletedAt).map(item => ({ item, similarity: questionSimilarity(item.title, question.title) })).sort((a, b) => b.similarity - a.similarity)[0]
    if (similar && similar.similarity >= 0.72) return { index, key, action: 'similar', existingQuestionId: similar.item.id, existingTitle: similar.item.title, expectedVersion: similar.item.version, similarity: similar.similarity }
    return { index, key, action: 'new' }
  })
}

/** Reject unknown IDs, stale versions and invented quotes; filenames alone are not evidence. */
export function validateGeneratedEvidence(items: QuestionEvidenceDraft[], files: Array<{ id: string; version: number; contentText: string | null; sha256?: string | null }>): QuestionEvidenceDraft[] {
  const compact = (text: string) => text.replace(/\s+/g, '')
  return uniqueEvidence(items.flatMap(item => {
    const file = files.find(value => value.id === item.fileId && value.version === item.fileVersion)
    const excerpt = item.excerpt.trim()
    if (!file?.contentText || excerpt.length < 6 || !compact(file.contentText).includes(compact(excerpt))) return []
    return [{ fileId: file.id, fileVersion: file.version, excerpt, contentHash: file.sha256 || null }]
  }))
}
