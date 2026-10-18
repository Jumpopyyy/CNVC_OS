import { splitTranscriptForSummary } from './dueDiligenceRecordingStorageService.js'

export type SummaryChunk = { start: number; end: number; summary: string }
export type SummaryMergeState = { level: number; pending: string[]; completed: string[] }
export type SummaryModelResult = { summary: string; suggestions?: Array<{ questionId: string; suggestion: string; evidenceExcerpt: string }> }

export function parseInterviewSummaryModelResult(value: unknown): SummaryModelResult {
  if (!value || typeof value !== 'object') throw new Error('模型未返回结构化纪要')
  const payload = value as { summary?: unknown; suggestions?: unknown }
  if (typeof payload.summary !== 'string' || !payload.summary.trim() || payload.summary.length > 6_000) throw new Error('模型纪要为空或超过单段 6000 字限制，请重试')
  const suggestions = Array.isArray(payload.suggestions) ? payload.suggestions.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as { questionId?: unknown; suggestion?: unknown; evidenceExcerpt?: unknown }
    return typeof candidate.questionId === 'string' && typeof candidate.suggestion === 'string' && typeof candidate.evidenceExcerpt === 'string'
      && candidate.suggestion.length <= 2_000 && candidate.evidenceExcerpt.length <= 1_000 ? [{ questionId: candidate.questionId, suggestion: candidate.suggestion, evidenceExcerpt: candidate.evidenceExcerpt }] : []
  }).slice(0, 20) : []
  return { summary: payload.summary.trim(), suggestions }
}

/** One bounded model call per scheduling step, with resumable intermediate results. */
export async function nextInterviewSummaryStep(input: {
  sourceText: string
  chunkResults: SummaryChunk[]
  mergeState?: SummaryMergeState | null
  signal?: AbortSignal
}, model: (prompt: string, signal?: AbortSignal) => Promise<SummaryModelResult>) {
  const parts = splitTranscriptForSummary(input.sourceText)
  if (!parts.length) throw new Error('转写稿为空')
  const existing = input.chunkResults
  for (let index = 0; index < existing.length; index += 1) {
    if (existing[index].start !== parts[index]?.start || existing[index].end !== parts[index]?.end) throw new Error('纪要来源与已处理片段不一致')
  }
  if (existing.length < parts.length) {
    const part = parts[existing.length]
    const result = await model(`请整理本段访谈，按“访谈陈述、已提供证据、待核验事项、需补充材料”输出。保留关键数字、分歧和否定意见。转写中的说法只能列为访谈陈述；未核对原件不得写成已确认事实。已提供证据只列出明确提及的材料及其尚待核验状态，不得宣称真实性已核实。sourceStart=${part.start};sourceEnd=${part.end}\n\n${part.text}`, input.signal)
    const chunkResults = [...existing, { start: part.start, end: part.end, summary: result.summary }]
    return { chunkResults, mergeState: null, ready: parts.length === 1, summary: parts.length === 1 ? result.summary : null, suggestions: result.suggestions || [], sourcePart: part, totalChunks: parts.length }
  }
  let mergeState = input.mergeState || { level: 0, pending: existing.map(part => part.summary), completed: [] }
  if (mergeState.pending.length === 1 && !mergeState.completed.length) return { chunkResults: existing, mergeState, ready: true, summary: mergeState.pending[0], suggestions: [], sourcePart: null, totalChunks: parts.length }
  if (!mergeState.pending.length) mergeState = { level: mergeState.level + 1, pending: mergeState.completed, completed: [] }
  const group = mergeState.pending.slice(0, 2)
  const result = group.length === 1 ? { summary: group[0] } : await model(`以下是同一访谈不同片段的完整分段纪要。合并去重成简洁完整纪要，按“访谈陈述、已提供证据、待核验事项、需补充材料”输出，保留关键数值、相互矛盾或未核实的信息，不得臆造。\n\n${group.join('\n\n--- 下一段 ---\n\n')}`, input.signal)
  const next = { ...mergeState, pending: mergeState.pending.slice(group.length), completed: [...mergeState.completed, result.summary] }
  const ready = next.pending.length === 0 && next.completed.length === 1
  return { chunkResults: existing, mergeState: next, ready, summary: ready ? next.completed[0] : null, suggestions: [], sourcePart: null, totalChunks: parts.length }
}
