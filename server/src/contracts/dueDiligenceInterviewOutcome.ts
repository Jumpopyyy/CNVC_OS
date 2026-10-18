type Interview = { id: string; projectId: string; summary?: string | null }
type SummaryTask = { id: string; interviewId: string; projectId: string; kind: string; status: string; summary?: string | null; transcriptVersion?: number | null }

/** Completion status and a client-supplied version are not evidence of human confirmation. */
export function confirmedInterviewSummary<T extends SummaryTask>(interview: Interview, tasks: T[]) {
  const text = interview.summary?.trim()
  if (!text) return undefined
  return tasks.find(task => task.interviewId === interview.id && task.projectId === interview.projectId && task.kind === 'summary' && task.status === 'confirmed' && Number.isInteger(task.transcriptVersion) && Number(task.transcriptVersion) > 0 && task.summary?.trim() === text)
}

export function interviewOutcomeStillCurrent(payload: Record<string, unknown>, interview: Interview | undefined, tasks: SummaryTask[]) {
  if (!interview || String(payload.note || '').trim() !== interview.summary?.trim()) return false
  const eligible = payload.sourceTaskId ? tasks.filter(task => task.id === payload.sourceTaskId) : tasks
  return Boolean(confirmedInterviewSummary(interview, eligible))
}

export function interviewSummaryPatch(previous: Pick<Interview, 'summary'>, patch: Pick<Interview, 'summary'>) {
  return patch.summary !== undefined && (patch.summary || '').trim() !== (previous.summary || '').trim() ? { summaryTranscriptVersion: null } : {}
}
