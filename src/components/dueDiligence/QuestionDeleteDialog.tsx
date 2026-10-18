import { useEffect, useRef, useState } from 'react'
import { Button, Modal } from '../ui'
import type { Question } from './types'

export function QuestionDeleteDialog({ question, onDelete, onClose }: { question: Question; onDelete: (question: Question) => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const alive = useRef(true)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    alive.current = true
    const previous = document.activeElement
    root.current?.querySelector<HTMLButtonElement>('[data-cancel-delete]')?.focus()
    return () => { alive.current = false; if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  const close = () => { if (!pending.current) onClose() }
  const remove = async () => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try { await onDelete(question); if (alive.current) onClose() }
    catch (cause) { if (alive.current) setError(`删除失败：${cause instanceof Error ? cause.message : '请稍后重试'}`) }
    finally { pending.current = false; if (alive.current) setBusy(false) }
  }
  return <div ref={root} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); close() }
    if (event.key !== 'Tab') return
    const controls = root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    if (!controls?.length) return
    const first = controls[0], last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }}>
    <Modal open title="删除核查问题" onClose={close} footer={<>
      <Button data-cancel-delete variant="secondary" disabled={busy} onClick={close}>取消</Button>
      <Button variant="danger" disabled={busy} onClick={() => void remove()}>{busy ? '正在删除…' : '确认删除'}</Button>
    </>}>
      <p className="break-words text-sm text-slate-700">确认删除“{question.title}”？</p>
      <p className="mt-2 text-xs text-slate-500">仅删除当前核查问题，不删除关联项目材料。</p>
      {busy && <p role="status" className="mt-3 text-sm text-slate-500">正在保存删除结果，请稍候。</p>}
      {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
    </Modal>
  </div>
}
