import { useEffect, useId, useRef, useState } from 'react'
import { Check, Pencil, SlidersHorizontal, Sparkles } from 'lucide-react'
import { Button, Modal } from '../ui'
import type { TwinBuildProposal, TwinDraft } from './types'

export function TwinPreferenceEditor({ draft, proposal, outdated, busy, active, onDraft, onProposal, onAdopt, onDiscard }: {
  draft: TwinDraft; proposal: TwinBuildProposal | null; outdated: boolean; busy: boolean; active: boolean
  onDraft: (draft: TwinDraft) => void; onProposal: (proposal: TwinBuildProposal) => void
  onAdopt: (review?: { currentRules: string; suggestionRules: string }) => void; onDiscard: () => void
}) {
  const [reviewing, setReviewing] = useState(Boolean(proposal))
  const [discardOpen, setDiscardOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const contentId = useId(), hasProposal = Boolean(proposal)
  useEffect(() => { setReviewing(Boolean(proposal)) }, [proposal])
  useEffect(() => { setEditing(false) }, [hasProposal])
  useEffect(() => { if (!active || busy) setEditing(false) }, [active, busy])
  const reviewingProposal = reviewing && proposal
  const current = useRef({ draft, proposal, reviewing, outdated, busy }); current.current = { draft, proposal, reviewing, outdated, busy }
  const updateRules = (rules: string) => onDraft({ ...current.current.draft, rules })
  const changeView = (next: boolean) => { setReviewing(next); setEditing(false) }
  const rules = reviewingProposal ? proposal.rules : draft.rules
  return <section className="twin-preference-editor" aria-label="分身偏好结果">
    <div className="twin-section-heading"><h3><SlidersHorizontal className="h-4 w-4" aria-hidden="true" />分身偏好</h3>
      <Button size="sm" variant="secondary" className="twin-inline-action" disabled={busy || !active} aria-expanded={editing} aria-controls={contentId} onClick={() => setEditing(value => !value)}>{editing ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Pencil className="h-3.5 w-3.5" aria-hidden="true" />}{editing ? '完成编辑' : '手动编辑'}</Button>
    </div>
    {proposal ? <><div className="mt-2"><span className="twin-status-chip"><Sparkles className="h-3 w-3" aria-hidden="true" />{outdated ? '建议需核对' : '有待采纳建议'}</span></div><div className="twin-editor-switch" role="group" aria-label="偏好内容切换"><button type="button" aria-pressed={!reviewing} onClick={() => changeView(false)}>当前偏好</button><button type="button" aria-pressed={reviewing} onClick={() => changeView(true)}>待采纳建议</button></div></> : <p className="twin-section-hint mt-2">当前偏好</p>}
    <div className="twin-preference-body" data-reviewing={Boolean(reviewingProposal)}>
      {reviewingProposal && <p className="twin-preference-note" role="status">{outdated ? '偏好或对话已变化，采纳前请核对当前偏好；需要时可手动编辑建议。' : '核对建议后采纳，或点击“手动编辑”调整；采纳后仍需保存分身。'}</p>}
      {editing ? <label className="block"><span className="sr-only">{reviewingProposal ? '编辑待采纳建议' : '编辑当前偏好'}</span><textarea id={contentId} autoFocus className="textarea twin-preference-input" rows={6} value={rules} disabled={busy || !active} onChange={event => reviewingProposal ? onProposal({ ...proposal, rules: event.target.value }) : updateRules(event.target.value)} placeholder="例如：优先核验收入真实性，通过合同、验收、发票与回款交叉验证。" /></label>
        : <div id={contentId} className="twin-preference-result" role="region" aria-label={reviewingProposal ? '待采纳建议内容' : '当前偏好内容'} tabIndex={0}>{rules || <span className="twin-section-hint">暂无偏好，可通过对话补充需求，或点击“手动编辑”。</span>}</div>}
      {editing && <p className="mt-2 text-xs text-slate-500">{reviewingProposal ? '修改的是待采纳建议，确认后采纳并保存分身。' : '编辑后需点击“保存分身”才会生效。'}</p>}
      {reviewingProposal && <div className="twin-preference-actions"><Button size="sm" variant="secondary" disabled={busy || !active} onClick={() => setDiscardOpen(true)}>放弃建议</Button><Button size="sm" disabled={busy || !active} onClick={() => { if (current.current.outdated) setReviewOpen(true); else onAdopt() }}><Check className="h-3.5 w-3.5" aria-hidden="true" />采纳到当前偏好</Button></div>}
    </div>
    <Modal open={discardOpen} title="放弃这份建议？" onClose={() => setDiscardOpen(false)} footer={<><Button variant="secondary" onClick={() => setDiscardOpen(false)}>继续查看</Button><Button disabled={busy || !active} onClick={() => { onDiscard(); setDiscardOpen(false) }}>放弃建议</Button></>}><p>当前偏好保持不变，需要时可从对话记录中重新查看建议。</p></Modal>
    <Modal open={reviewOpen} title="核对后采纳这份建议" onClose={() => setReviewOpen(false)} footer={<><Button variant="secondary" onClick={() => setReviewOpen(false)}>继续修改</Button><Button disabled={busy || !active || !proposal} onClick={() => { const state = current.current; if (!state.proposal || state.busy) return; onAdopt({ currentRules: state.draft.rules, suggestionRules: state.proposal.rules }); setReviewOpen(false) }}>确认采纳到偏好草稿</Button></>}><p className="text-sm text-slate-600">这份建议对应的偏好或对话已有变化。确认后，将用下方建议替换偏好草稿；保存分身后才生效。</p><div className="mt-4 grid gap-4 md:grid-cols-2"><section><h4 className="text-sm font-semibold">当前偏好草稿</h4><p className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm">{draft.rules || '暂无内容'}</p></section><section><h4 className="text-sm font-semibold">本次手动调整的建议</h4><p className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-blue-50 p-3 text-sm">{proposal?.rules || '暂无内容'}</p></section></div></Modal>
  </section>
}
