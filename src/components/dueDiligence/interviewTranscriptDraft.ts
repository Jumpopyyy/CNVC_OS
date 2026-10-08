/** Apply a newer persisted transcript only while the local editor is unchanged. */
export function shouldReplaceTranscriptDraft(
  currentDraft: string,
  lastPersistedContent: string,
  previousVersion: number | null | undefined,
  incomingVersion: number | null | undefined,
) {
  const newerVersion = incomingVersion != null && (previousVersion == null || incomingVersion > previousVersion)
  return newerVersion && currentDraft === lastPersistedContent
}
