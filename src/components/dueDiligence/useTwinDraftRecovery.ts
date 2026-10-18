import { useCallback, useEffect, useRef, useState } from 'react'
import { readTwinDraft, writeTwinDraft, type TwinRecoveryContent, type TwinRecoveryRecord } from './twinDraftRecovery'

export function useTwinDraftRecovery(ownerId: string, content: TwinRecoveryContent | null) {
  const [pending, setPending] = useState<TwinRecoveryRecord | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [savedAt, setSavedAt] = useState(0)
  const [writing, setWriting] = useState(false)
  const [storedContent, setStoredContent] = useState<string | null>(null)
  const [loadedOwner, setLoadedOwner] = useState('')
  const session = useRef<{ ownerId: string; revision: number; failed: boolean; alive: boolean; loaded: boolean; pendingWrites: number; queuedContent: string | null; queue: Promise<unknown> }>()
  const encoded = JSON.stringify(content)
  useEffect(() => {
    setReady(false); setPending(null); setError(''); setSavedAt(0); setStoredContent(null); setLoadedOwner(''); setWriting(false)
    const current = { ownerId, revision: 0, failed: false, alive: true, loaded: false, pendingWrites: 0, queuedContent: null as string | null, queue: Promise.resolve() as Promise<unknown> }
    session.current = current
    if (!ownerId) { setReady(true); return () => { current.alive = false } }
    void readTwinDraft(ownerId).then(record => {
      if (!current.alive) return
      current.revision = record.revision; current.loaded = true
      current.queuedContent = JSON.stringify(record.content)
      setPending(record.content ? record : null); setLoadedOwner(ownerId); setReady(true)
    }).catch(err => { if (current.alive) { current.failed = true; setError((err as Error).message); setLoadedOwner(ownerId); setReady(true) } })
    return () => { current.alive = false }
  }, [ownerId])
  useEffect(() => {
    const current = session.current
    if (!ready || pending || !ownerId || !current?.loaded || current.ownerId !== ownerId || current.failed) return
    if (current.queuedContent === encoded) { if (!current.pendingWrites) setStoredContent(encoded); return }
    current.queuedContent = encoded
    const value = JSON.parse(encoded) as TwinRecoveryContent | null
    current.pendingWrites++; setWriting(true)
    // Serialize local transactions: a slow write must never resurrect a discarded draft.
    current.queue = current.queue.then(async () => {
      if (current.failed) return
      const record = await writeTwinDraft(ownerId, current.revision, value)
      current.revision = record.revision
      current.pendingWrites--
      if (current.alive) { setSavedAt(value ? record.updatedAt : 0); setStoredContent(encoded); setWriting(current.pendingWrites > 0) }
    }).catch(err => { current.failed = true; if (current.alive) { setError((err as Error).message); setWriting(false) } })
  }, [ready, pending, ownerId, encoded])
  const dismiss = useCallback(() => setPending(null), [])
  const sameOwner = loadedOwner === ownerId
  return { pending: sameOwner ? pending : null, ready: sameOwner && ready, error: sameOwner ? error : '', savedAt: sameOwner ? savedAt : 0, writing: sameOwner && writing, currentStored: sameOwner && !pending && !error && storedContent === encoded, dismiss }
}
