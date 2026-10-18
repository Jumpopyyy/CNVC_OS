import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QuestionsWorkspace } from '../../../src/components/dueDiligence/QuestionsWorkspace'
import type { Question } from '../../../src/components/dueDiligence/types'
import '../../../src/styles.css'

// Only the actual component and synthetic callbacks; no API, model, or database.
if (!import.meta.env.DEV) throw new Error('Synthetic browser fixture is development-only')
const samples: Question[] = ['A', 'B'].map(id => ({ id, projectId: id, title: `合成项目${id}的核查问题`, category: '业务', priority: '中', evidenceRequirement: '', status: '待核查', assigneeName: '合成员工', fileId: null, source: '合成验收', version: 1, createdAt: '2026-10-17T00:00:00Z' }))
function Fixture() {
  const [project, setProject] = useState('A')
  const [questions, setQuestions] = useState(samples)
  const [writes, setWrites] = useState(0)
  const [request, setRequest] = useState<{ question: Question; resolve: () => void; reject: (error: Error) => void } | null>(null)
  const [notice, setNotice] = useState('')
  return <main className="mx-auto max-w-5xl p-6">
    <h1 className="mb-4 text-xl font-semibold">核查问题删除 · 合成验收（非业务数据）</h1>
    <section aria-label="合成验收控制" style={{ position: 'fixed', left: 8, bottom: 8, width: 280, zIndex: 70 }} className="space-y-2 rounded-lg border bg-white p-3 text-xs shadow">
      <p>当前项目：{project}；提交次数：{writes}；请求：{request ? '等待结果' : '无'}；剩余问题：{questions.length}</p>
      <p role="status">{notice}</p>
      <div className="flex flex-wrap gap-2">
        <button className="rounded border p-2" disabled={!request} onClick={() => { if (!request) return; const current = request; setRequest(null); current.reject(new Error('合成网络错误，可重试')) }}>模拟删除失败</button>
        <button className="rounded border p-2" disabled={!request} onClick={() => { if (!request) return; const current = request; setRequest(null); setQuestions(items => items.filter(item => item.id !== current.question.id)); setNotice(`已删除${current.question.title}`); current.resolve() }}>完成删除</button>
        <button className="rounded border p-2" onClick={() => setProject(value => value === 'A' ? 'B' : 'A')}>切换合成项目</button>
      </div>
    </section>
    <QuestionsWorkspace key={project} projectId={project} questions={questions.filter(item => item.projectId === project)} files={[]} members={[]} publicTwins={[]} loading={false} defaultAssigneeId="" defaultAssigneeName="合成员工"
      onDelete={question => { setWrites(value => value + 1); return new Promise<void>((resolve, reject) => setRequest({ question, resolve, reject })) }}
      onCreate={async () => {}} onUpdate={async () => {}} onBatchAssign={async () => {}} onStatus={async () => {}} onReorder={async () => {}}
      onGenerate={async () => { throw new Error('本验收不调用生成服务') }} onApply={async () => ({ created: 0, merged: 0, skipped: 0 })} onRetryParse={async () => {}} onUpload={async () => null} />
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
