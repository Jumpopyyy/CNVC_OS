import type { RecordingUploadManifest } from '../../../server/src/contracts/dueDiligenceCollaboration'
export const blobSha256 = async (blob: Blob) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), value => value.toString(16).padStart(2, '0')).join('')
/** Hash at most one chunk in memory; the final manifest is only a list of digests. */
export async function inspectRecordingUpload(file: File, chunkBytes: number, signal?: AbortSignal, progress?: (value: number) => void) {
  const hashes: string[] = []
  for (let offset = 0; offset < file.size; offset += chunkBytes) {
    signal?.throwIfAborted()
    hashes.push(await blobSha256(file.slice(offset, offset + chunkBytes)))
    progress?.(Math.min(100, Math.round((offset + chunkBytes) / file.size * 100)))
  }
  signal?.throwIfAborted()
  const manifest: RecordingUploadManifest = {name:file.name,size:file.size,chunkBytes,fingerprint:await blobSha256(new Blob([hashes.join('')]))}
  return { manifest, hashes }
}
