import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TwinInquiryPanel, type TwinInquiry } from '../../../src/components/dueDiligence/TwinInquiryInbox'
import '../../../src/styles.css'

// Vite-only interactive fixture. No API, database, model, or authenticated data.
// This HTML is not imported by the app or included in its production entry.
if (!import.meta.env.DEV) throw new Error('Synthetic browser fixture is development-only')
const sample: TwinInquiry = { id: 'synthetic-inquiry', twinId: 'synthetic-twin', twinName: '合成员工分身', projectName: '合成项目', callerName: '合成领导', question: '2026年9月15日估值谈到了多少？后来如何处理？', status: '待补充', reply: null, createdAt: '2026-10-16T00:00:00Z' }
function Fixture() {
  const [list, setList] = useState([sample])
  const [loadError, setLoadError] = useState('')
  const [writes, setWrites] = useState(0)
  const [unsaved, setUnsaved] = useState(false)
  const [lastSaved, setLastSaved] = useState('')
  const [request, setRequest] = useState<{ resolve: () => void; reject: (error: Error) => void; item: TwinInquiry; body: { decision: string; content: string } } | null>(null)
  return <main className="mx-auto max-w-4xl space-y-4 p-6">
    <h1 className="text-xl font-semibold">分身问询组件 · 合成验收（非业务数据）</h1>
    <p>仅验证真实组件的交互和异步状态，不代表双员工或真实模型验收。</p>
    <section aria-label="合成验收控制" style={{ position: 'fixed', left: 8, bottom: 8, width: 280, zIndex: 70 }} className="space-y-2 rounded-lg border bg-white p-3 text-xs shadow">
      <p>提交次数：{writes}；离开保护：{unsaved ? '开启' : '关闭'}；请求：{request ? '等待结果' : '无'}</p>
      <p>已保存内容：{lastSaved || '无'}</p>
      <div className="flex flex-wrap gap-2">
        <button className="rounded border p-2" onClick={() => { setList(items => [...items]); setLoadError('') }}>模拟正常刷新</button>
        <button className="rounded border p-2" onClick={() => setLoadError('合成网络错误')}>模拟刷新失败</button>
        <button className="rounded border p-2" onClick={() => setList(items => items.map(item => ({ ...item, status: '已补充' })))}>模拟其他页面已处理</button>
        <button className="rounded border p-2" onClick={() => setList([])}>模拟提醒不可访问</button>
        <button className="rounded border p-2 disabled:opacity-40" disabled={!request} onClick={() => { if (!request) return; const current = request; setRequest(null); current.reject(new Error('合成保存错误，请重试')) }}>模拟保存失败</button>
        <button className="rounded border p-2 disabled:opacity-40" disabled={!request} onClick={() => { if (!request) return; const current = request; setRequest(null); setList(items => items.map(item => item.id === current.item.id ? { ...item, status: current.body.decision === '补充' ? '已补充' : '暂不纳入' } : item)); setLastSaved(current.body.content); current.resolve() }}>完成保存</button>
        <button className="rounded border p-2" disabled={Boolean(request)} onClick={() => setList([sample])}>重置提醒状态</button>
      </div>
    </section>
    <TwinInquiryPanel list={list} loadError={loadError} onPendingChange={React.useCallback((_key: string, pending: boolean) => setUnsaved(pending), [])} onReply={(item, body) => { setWrites(value => value + 1); return new Promise<void>((resolve, reject) => setRequest({ resolve, reject, item, body })) }} />
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
