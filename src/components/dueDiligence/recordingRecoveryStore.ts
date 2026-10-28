// IndexedDB is an outbox, not the authority for archived recordings. Remove
// chunks only after the server has acknowledged their checksum.
export type RecordingRecovery = {
  scope: string; sessionId: string; epoch: number; nextSequence: number
  mimeType: string; seconds: number; lastSavedAt?: string; stopped: boolean; uploadIncomplete?: boolean; epochCounts?: Record<string, number>
  uploadManifest?: import('../../../server/src/contracts/dueDiligenceCollaboration').RecordingUploadManifest
}
export type RecordingChunk = { key: string; scope: string; sessionId: string; epoch: number; sequence: number; blob: Blob }
export type TranscriptRecovery = { scope: string; content: string; baseVersion: number | null; updatedAt: string }
let database: Promise<IDBDatabase> | undefined
function open() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('cnvc-dd-recording-outbox', 1)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('sessions', { keyPath: 'scope' })
      db.createObjectStore('drafts', { keyPath: 'scope' })
      db.createObjectStore('chunks', { keyPath: 'key' }).createIndex('scope', 'scope')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { database = undefined; reject(new Error('浏览器本地保存不可用，请保留文字并暂停录入。')) }
  })
  return database
}
async function transaction<T>(store: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode); const request = action(tx.objectStore(store))
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('本地保存失败，可能是可用存储不足。'))
  })
}
export const saveRecordingRecovery = (value: RecordingRecovery) => transaction('sessions', 'readwrite', store => store.put(value))
export const loadRecordingRecovery = (scope: string) => transaction<RecordingRecovery | undefined>('sessions', 'readonly', store => store.get(scope))
export const saveRecordingChunk = (chunk: RecordingChunk) => transaction('chunks', 'readwrite', store => store.put(chunk))
export async function saveRecordingCheckpoint(value: RecordingRecovery, chunk: RecordingChunk) {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['sessions', 'chunks'], 'readwrite')
    tx.objectStore('sessions').put(value)
    tx.objectStore('chunks').put(chunk)
    tx.oncomplete = () => resolve()
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('本地保存失败，可能是可用存储不足。'))
  })
}
export const deleteRecordingChunk = (key: string) => transaction('chunks', 'readwrite', store => store.delete(key))
export async function nextRecordingChunk(scope: string) {
  // A cursor reads only one Blob at a time, including during offline recovery.
  const db = await open()
  return new Promise<RecordingChunk | undefined>((resolve, reject) => {
    const request = db.transaction('chunks').objectStore('chunks').index('scope').openCursor(IDBKeyRange.only(scope))
    request.onsuccess = () => resolve(request.result?.value as RecordingChunk | undefined)
    request.onerror = () => reject(request.error)
  })
}
export async function clearRecordingRecovery(scope: string) {
  let chunk = await nextRecordingChunk(scope)
  while (chunk) { await deleteRecordingChunk(chunk.key); chunk = await nextRecordingChunk(scope) }
  await transaction('sessions', 'readwrite', store => store.delete(scope))
}
export const saveTranscriptRecovery = (value: TranscriptRecovery) => transaction('drafts', 'readwrite', store => store.put(value))
export const loadTranscriptRecovery = (scope: string) => transaction<TranscriptRecovery | undefined>('drafts', 'readonly', store => store.get(scope))
export const clearTranscriptRecovery = (scope: string) => transaction('drafts', 'readwrite', store => store.delete(scope))
// Distinct keys keep the richer workspace outbox compatible with v1 databases.
// Order unmount writes before a newly mounted workspace reads the same draft.
const workspaceOperations = new Map<string, Promise<unknown>>()
function workspaceOperation<T>(scope: string, action: () => Promise<T>): Promise<T> {
  const result = (workspaceOperations.get(scope) || Promise.resolve()).catch(() => {}).then(action)
  workspaceOperations.set(scope, result)
  void result.finally(() => { if (workspaceOperations.get(scope) === result) workspaceOperations.delete(scope) }).catch(() => {})
  return result
}
export const loadInterviewWorkspaceDraft = (scope: string) => workspaceOperation(scope, () => transaction<import('./interviewWorkspaceDraft').InterviewWorkspaceDraft | undefined>('drafts', 'readonly', store => store.get(`workspace/${scope}`)))
export const saveInterviewWorkspaceDraft = (value: import('./interviewWorkspaceDraft').InterviewWorkspaceDraft) => workspaceOperation(value.scope, () => transaction('drafts', 'readwrite', store => store.put({ ...value, scope: `workspace/${value.scope}` })))
export const clearInterviewWorkspaceDraft = (scope: string) => workspaceOperation(scope, () => transaction('drafts', 'readwrite', store => store.delete(`workspace/${scope}`)))
export const recordingChunkKey = (scope: string, sessionId: string, epoch: number, sequence: number) => `${scope}/${sessionId}/${String(epoch).padStart(5, '0')}/${String(sequence).padStart(8, '0')}`
