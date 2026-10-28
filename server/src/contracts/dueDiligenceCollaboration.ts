/** Shared display rules; no database or browser dependencies. */
export function recordingLeaseActive(session: { status: string; leaseExpiresAt?: string | Date | null } | null | undefined, now = Date.now()) {
  return Boolean(session && ['recording', 'paused'].includes(session.status)
    && session.leaseExpiresAt && new Date(session.leaseExpiresAt).getTime() > now)
}

export function speechRecoveryDelay(error: string, attempts: number): number | null {
  if (['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].includes(error)) return null
  return [2_000, 5_000, 10_000][attempts] ?? null
}

export type RecordingUploadManifest = { name: string; size: number; chunkBytes: number; fingerprint: string }
export function sameRecordingUpload(left: RecordingUploadManifest, right: RecordingUploadManifest) {
  return left.size === right.size && left.chunkBytes === right.chunkBytes && left.fingerprint === right.fingerprint
}
