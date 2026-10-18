type QuestionOutcomeInput = {
  conclusion?: string | null
  followUpNote?: string | null
  evidenceRequirement?: string | null
  source?: string | null
  generationKey?: string | null
  templateItemId?: string | null
}

/** Generated evidence requests are not employee findings, even after completion. */
export function questionOutcome(input: QuestionOutcomeInput) {
  const conclusion = input.conclusion?.trim() || ''
  const legacyManualNote = input.source === '人工创建' && !input.generationKey && !input.templateItemId ? input.evidenceRequirement?.trim() || '' : ''
  const note = input.followUpNote?.trim() || legacyManualNote
  return { conclusion, note, text: [conclusion ? `核查结论：${conclusion}` : '', note && note !== conclusion ? `员工备注：${note}` : ''].filter(Boolean).join('\n') }
}

export function questionOutcomeStillCurrent(payload: Record<string, unknown>, question: (QuestionOutcomeInput & { status: string; deletedAt?: Date | null }) | undefined) {
  if (!question || question.deletedAt || question.status !== '已完成') return false
  const current = questionOutcome(question)
  return Boolean(current.text) && current.conclusion === String(payload.conclusion || '').trim() && current.note === String(payload.note || '').trim()
}

/** The existing one-field note editor writes evidenceRequirement; retain its authorship separately. */
export function questionOutcomePatch(previous: QuestionOutcomeInput, patch: Partial<QuestionOutcomeInput>) {
  if (patch.followUpNote !== undefined && patch.evidenceRequirement === undefined && previous.source === '人工创建' && !previous.generationKey && !previous.templateItemId) return { evidenceRequirement: patch.followUpNote }
  if (patch.followUpNote === undefined && patch.evidenceRequirement !== undefined && (patch.evidenceRequirement || '').trim() !== (previous.evidenceRequirement || '').trim()) return { followUpNote: patch.evidenceRequirement }
  return {}
}
