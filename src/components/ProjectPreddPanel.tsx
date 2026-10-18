import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { apiGet, apiPost } from '../lib/api'
import { extractTextParts, normalizeAgentMessages } from '../lib/aiMessageSafety'
import { formatShanghaiDateTime } from '../lib/dateTime'
import { useJwAgent } from '../hooks/useJwAgent'
import { Button, Modal } from './ui'

type Run = { id: string; agentId: string; status: string; createdAt: string; error: string | null }

const readUpload = (file: File) => new Promise<{ name: string; declaredType?: string; dataBase64: string }>((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(new Error(`附件 ${file.name} 读取失败`))
  reader.onload = () => resolve({ name: file.name, declaredType: file.type || undefined, dataBase64: String(reader.result) })
  reader.readAsDataURL(file)
})

export function ProjectPreddPanel({ lead, onClose }: { lead: { id: string; name: string }; onClose: () => void }) {
  const [runs, setRuns] = useState<Run[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [instructions, setInstructions] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const selected = runs.find((run) => run.id === selectedId)
  const agent = useJwAgent(selected?.agentId)
  const answers = useMemo(() => normalizeAgentMessages(agent.messages)
    .filter((message) => message.role === 'assistant')
    .map((message) => ({ id: message.id, text: extractTextParts(message) })).filter((message) => message.text.trim()), [agent.messages])
  const running = agent.status === 'streaming' || agent.status === 'submitted'
    || (agent.status === 'connecting' && selected?.status === 'streaming')
  const activeRun = runs.some((run) => run.status === 'streaming')

  const loadHistory = useCallback(async () => {
    try {
      const response = await apiGet<{ list: Run[] }>(`/project-discovery/leads/${lead.id}/predd`)
      setRuns(response.list)
      setSelectedId((current) => response.list.some((run) => run.id === current) ? current : response.list[0]?.id || '')
      setHistoryError('')
    } catch (cause) {
      setHistoryError(cause instanceof Error ? cause.message : '历史分析读取失败')
    } finally { setLoading(false) }
  }, [lead.id])

  useEffect(() => {
    void loadHistory()
    const timer = window.setInterval(() => void loadHistory(), 5_000)
    return () => window.clearInterval(timer)
  }, [loadHistory])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    dialog?.querySelector<HTMLElement>('button')?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')]
      const first = focusable[0], last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); previous?.focus() }
  }, [onClose])

  const start = async () => {
    if (submitting || loading || historyError || activeRun) return
    setSubmitting(true)
    setError('')
    try {
      const attachments = await Promise.all(files.map(readUpload))
      const run = await apiPost<Run>(`/project-discovery/leads/${lead.id}/predd`, { instructions, attachments })
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)])
      setSelectedId(run.id)
      setFiles([])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pre-DD 分析启动失败')
      await loadHistory()
    } finally { setSubmitting(false) }
  }

  const stop = async () => {
    try { await agent.abort(); await loadHistory() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '停止分析失败') }
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([answers.map((message) => message.text).join('\n\n')], { type: 'text/markdown;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${lead.name.replace(/[\\/:*?"<>|]/g, '_')} - PreDD.md`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }

  return <Modal open title={`${lead.name} · 项目 PreDD`} onClose={onClose} width="max-w-5xl">
    <div className="project-predd-panel">
      <p className="project-predd-methodology">方法论：早期科技项目 Pre-DD 项目信息分析维度清单与评分方法论.pdf</p>
      <p className="project-predd-hint">后台自动提供方法论 PDF、项目已有信息和你上传的可访问 BP，结合公开调查分析项目及相关行业。</p>
      <label className="project-predd-field">补充分析要求
        <textarea value={instructions} maxLength={2000} rows={3} disabled={submitting} onChange={(event) => setInstructions(event.target.value)} placeholder="例如重点核查技术差异、客户验证和市场替代空间" />
      </label>
      <label className="project-predd-field">补充项目附件（可选，最多两份，每份不超过 20 MB）
        <input type="file" multiple accept=".pdf,.docx,.pptx,.txt,.md,.markdown" disabled={submitting} onChange={(event) => {
          const chosen = Array.from(event.target.files || [])
          event.target.value = ''
          if (chosen.length > 2 || chosen.some((file) => !file.size || file.size > 20 * 1024 * 1024)) {
            setError('请选择最多两份非空附件，每份不超过 20 MB')
            return
          }
          setFiles(chosen); setError('')
        }} />
      </label>
      {files.length > 0 && <ul className="project-predd-files">{files.map((file, index) => <li key={`${file.name}-${index}`}>
        <span>{file.name}</span><button type="button" disabled={submitting} aria-label={`移除附件${file.name}`} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>移除</button>
      </li>)}</ul>}
      <div className="project-predd-actions">
        <Button loading={submitting} disabled={loading || Boolean(historyError) || activeRun} onClick={() => void start()}>{submitting ? '正在准备材料' : activeRun ? '项目正在分析' : runs.length ? '重新分析' : '开始分析'}</Button>
        {running && <Button variant="secondary" onClick={() => void stop()}>停止分析</Button>}
        {answers.length > 0 && <Button variant="secondary" onClick={download}>下载分析 Markdown</Button>}
        {selected && <Link to={`/ai?conversation=${encodeURIComponent(selected.id)}`}>在 AI 助手中继续</Link>}
      </div>
      {error && <p className="project-predd-error" role="alert">{error}</p>}
      {historyError && <p className="project-predd-error" role="alert">{historyError}<button type="button" onClick={() => void loadHistory()}>重新读取</button></p>}
      <label className="project-predd-field">历史分析
        <select value={selectedId} disabled={loading || submitting || !runs.length} onChange={(event) => setSelectedId(event.target.value)}>
          {!runs.length && <option value="">{loading ? '读取中…' : '尚未发起分析'}</option>}
          {runs.map((run) => <option key={run.id} value={run.id}>{formatShanghaiDateTime(run.createdAt)} · {run.status === 'streaming' ? '分析中' : run.error || run.status === 'error' ? '执行异常' : '查看记录'}</option>)}
        </select>
      </label>
      {running && <p role="status" className="project-predd-hint">AI 正在调查和分析。关闭窗口后仍会继续，可稍后返回查看。</p>}
      {agent.interaction && selected && <p role="status">AI 需要补充信息，请<Link to={`/ai?conversation=${encodeURIComponent(selected.id)}`}>前往 AI 助手回答</Link>后继续分析。</p>}
      {(agent.error || selected?.error) && <p role="alert" className="project-predd-error">{agent.error?.message || selected?.error}</p>}
      <section className="project-predd-report" aria-label="PreDD 分析结果" aria-busy={running}>
        {answers.map((message) => <ReactMarkdown key={message.id} remarkPlugins={[remarkGfm]} components={{
          table: (props) => <div className="project-predd-table"><table {...props} /></div>,
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
        }}>{message.text}</ReactMarkdown>)}
        {!answers.length && !loading && !running && !agent.error && <p className="project-predd-hint">分析内容会显示在这里。资料不足或联网失败会在结果中说明。</p>}
      </section>
    </div>
  </Modal>
}
