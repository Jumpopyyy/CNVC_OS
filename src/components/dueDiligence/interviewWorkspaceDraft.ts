export type InterviewWorkspaceDraft = {
  scope: string; updatedAt: string; promptText: string; promptQuestionId: string
  promptResponses: Record<string, string>; promptRequest?: { key: string; id: string }
  summary?: { taskId: string; sourceVersion: number; base: string; text: string; decisions: Record<string, string> }
}
export function hasWorkspaceDraft(value: InterviewWorkspaceDraft) {
  return Boolean(value.promptText.trim() || Object.values(value.promptResponses).some(text => text.trim())
    || value.summary && (value.summary.text !== value.summary.base || Object.keys(value.summary.decisions).length))
}
