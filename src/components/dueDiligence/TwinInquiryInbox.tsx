import { useEffect, useRef, useState } from 'react'
import { BellRing } from 'lucide-react'
import { api, apiPost } from '../../lib/api'
import { Badge, Button, Card, Modal } from '../ui'
import { TwinAvatar } from './TwinAvatar'
export type TwinInquiry = { id:string; twinId:string; twinName:string; projectName:string; callerName:string; question:string; status:string; reply:string|null; createdAt:string }
type Reply = { decision: '补充'|'暂不纳入'; content: string }
type PendingChange = (editor: string, pending: boolean) => void
export function TwinInquiryInbox({ onPendingChange }: { onPendingChange?: PendingChange }) {
  const [list, setList] = useState<TwinInquiry[]>([])
  const [error, setError] = useState('')
  const sequence = useRef(0), submitting = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    let loading = false
    const load = async () => {
      if (loading || submitting.current) return
      loading = true
      const ticket = ++sequence.current
      try { const data = await api<{list:TwinInquiry[]}>('/due-diligence/twins/inquiries', { signal: controller.signal }); if (!controller.signal.aborted && ticket === sequence.current) { setList(data.list); setError('') } }
      catch (err) { if (!controller.signal.aborted && ticket === sequence.current) setError((err as Error).message) }
      finally { loading = false }
    }
    void load(); const timer = window.setInterval(() => void load(), 15000)
    return () => { sequence.current++; controller.abort(); window.clearInterval(timer) }
  }, [])
  const reply = async (item: TwinInquiry, body: Reply) => {
    submitting.current = true
    const ticket = ++sequence.current
    try {
      const result = await apiPost<{status:string}>(`/due-diligence/twins/${item.twinId}/inquiries/${item.id}/reply`, body)
      if (ticket === sequence.current) setList(items => items.map(row => row.id === item.id ? { ...row, status: result.status, reply: body.content } : row))
    } finally { submitting.current = false }
  }
  return <TwinInquiryPanel list={list} loadError={error} onReply={reply} onPendingChange={onPendingChange} />
}

// The API container owns refreshes; editing survives refreshes and failed writes.
export function TwinInquiryPanel({ list, loadError = '', onReply, onPendingChange }: {
  list: TwinInquiry[]
  loadError?: string
  onReply: (item: TwinInquiry, body: Reply) => Promise<void>
  onPendingChange?: PendingChange
}) {
  const [editing, setEditing] = useState<TwinInquiry|null>(null)
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmClose, setConfirmClose] = useState(false)
  const submitting = useRef(false), mounted = useRef(true)
  const pending = list.filter(item => item.status === '待补充')
  const unavailable = Boolean(editing && !pending.some(item => item.id === editing.id))
  const hasUnsaved = busy || Boolean(editing && content.trim())
  useEffect(() => { onPendingChange?.('inquiry', hasUnsaved) }, [hasUnsaved, onPendingChange])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onPendingChange?.('inquiry', false) } }, [onPendingChange])
  const close = () => { setEditing(null); setContent(''); setSubmitError(''); setConfirmClose(false) }
  const requestClose = () => { if (submitting.current) return; if (content.trim()) setConfirmClose(true); else close() }
  const respond = async (decision: Reply['decision']) => {
    if (!editing || submitting.current || unavailable || confirmClose || (decision === '补充' && content.trim().length < 4)) return
    submitting.current = true; setBusy(true); setSubmitError('')
    try {
      await onReply(editing, { decision, content: content.trim() })
      if (!mounted.current) return
      setNotice(decision === '补充' ? '补充信息已保存，可通过该分身重新查询。' : '已标记为暂不纳入，未写入项目知识。')
      close()
    } catch (error) { if (mounted.current) setSubmitError((error as Error).message) }
    finally { submitting.current = false; if (mounted.current) setBusy(false) }
  }
  if (!pending.length && !loadError && !editing && !notice) return null
  return <Card className="border-brand-200 p-4"><div className="flex items-center gap-2"><BellRing aria-hidden="true" className="h-4 w-4 text-brand-700" /><h2 className="font-semibold">分身收到的询问</h2><span aria-live="polite" aria-atomic="true"><Badge>{pending.length} 条待补充</Badge></span></div>
    {notice && <p role="status" className="mt-2 text-sm text-brand-700">{notice}</p>}
    <div className="mt-3 space-y-2">{pending.map(item => <div key={item.id} className="flex items-start gap-3 rounded-lg bg-slate-50 p-3"><TwinAvatar id={item.twinId} name={item.twinName} size="sm" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.callerName} 询问了 {item.twinName}</p><p className="mt-1 text-xs text-slate-500">{item.projectName} · {new Date(item.createdAt).toLocaleString('zh-CN')}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">{item.question}</p></div><Button size="sm" disabled={busy || Boolean(editing)} onClick={() => { setEditing(item); setContent(''); setSubmitError(''); setNotice('') }}>补充信息</Button></div>)}</div>
    {loadError && <p role="alert" className="mt-2 text-sm text-rose-700">问询提醒刷新失败：{loadError}</p>}
    <Modal open={Boolean(editing)} title="补充到该分身的项目记录" onClose={requestClose} footer={<><Button variant="secondary" disabled={busy || unavailable || confirmClose} onClick={() => void respond('暂不纳入')}>暂不纳入</Button><Button disabled={busy || unavailable || confirmClose || content.trim().length < 4} onClick={() => void respond('补充')}>{busy ? '保存中…' : '确认纳入'}</Button></>}>
      {editing && <div className="space-y-3" aria-busy={busy}>
        <p className="whitespace-pre-wrap break-words text-sm">{editing.callerName}：{editing.question}</p><p className="text-xs text-slate-500">归属：{editing.twinName} · {editing.projectName}。保存后，有该项目权限的同事可通过此分身查询。</p>
        {unavailable && <p role="alert" className="text-sm text-amber-700">此提醒已处理或暂不可访问，未提交的文字仍保留，可复制留存；不会覆盖已有补充。</p>}
        <label className="block"><span className="label">实际处理情况与依据</span><textarea className="textarea min-h-44" autoFocus disabled={busy || confirmClose} maxLength={16000} value={content} onChange={event => setContent(event.target.value)} placeholder="请说明发生日期、处理结果、金额口径，以及依据或仍不确定的事项。" /></label>
        {submitError && <p role="alert" className="text-sm text-rose-700">补充信息未保存：{submitError}</p>}
        {confirmClose && <div role="alertdialog" aria-label="放弃未保存的补充信息" className="rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-sm">补充信息还未保存，确定放弃并关闭吗？</p><div className="mt-3 flex gap-2"><Button autoFocus variant="secondary" onClick={() => setConfirmClose(false)}>继续编辑</Button><Button onClick={close}>放弃并关闭</Button></div></div>}
      </div>}
    </Modal>
  </Card>
}
