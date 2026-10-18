import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TwinBuilder } from '../../src/components/dueDiligence/TwinBuilder.js'
import { TwinAvatar, defaultTwinAvatar, twinAvatarPresets } from '../../src/components/dueDiligence/TwinAvatar.js'
import { twinFocusRules } from '../src/contracts/digitalTwinTemplates.js'
import { TwinInquiryPanel } from '../../src/components/dueDiligence/TwinInquiryInbox.js'

// Component contract only: effects, network requests and microphones are not run.
Object.assign(globalThis, { React, window: {} })
const draft = { id: '', name: '合成文化分身', role: '投资经理', rules: twinFocusRules(['culture', 'incentives']), cases: '' }
const html = renderToStaticMarkup(<TwinBuilder draft={draft} draftId="00000000-0000-4000-8000-000000000001" preview onDraft={() => {}} onUpload={async () => null} />)
for (const label of ['组织文化型', '综合投资型', '销售增长型', '语音补充', '上传材料解析', '补充你的需求']) assert.ok(html.includes(label), `missing ${label}`)
assert.match(html, /aria-pressed="true"[^>]*>文化与价值观/)
assert.match(html, /aria-pressed="true"[^>]*>激励机制/)
assert.equal((html.match(/aria-pressed="true"/g) || []).length, 2)
const quotedRules = renderToStaticMarkup(<TwinBuilder draft={{ ...draft, rules: `不要采用以下规则：\n${draft.rules}` }} draftId="00000000-0000-4000-8000-000000000002" preview onDraft={() => {}} onUpload={async () => null} />)
assert.equal((quotedRules.match(/aria-pressed="true"/g) || []).length, 0, '引用或否定的模板原文不能被误选为关注点')
assert.equal(defaultTwinAvatar('stable-owner'), defaultTwinAvatar('stable-owner'))
assert.ok(twinAvatarPresets.every(value => value.startsWith('robot-')))
const avatar = renderToStaticMarkup(<TwinAvatar id="same-owner" name="合成分身" preset="owl" size="lg" />)
assert.match(avatar, /<svg/); assert.match(avatar, /aria-label="合成分身头像"/)
assert.doesNotMatch(avatar, /🦉|🐱|🐼|🦊/)
const recovered = renderToStaticMarkup(<TwinBuilder draft={draft} draftId="00000000-0000-4000-8000-000000000001" preview onDraft={() => {}} onUpload={async () => null} initialState={{ message: '恢复后的未发送文字', proposal: { reply: '', rules: '恢复后的员工修订建议', cases: '', description: '恢复后的备注', followUps: [] }, proposalAsset: null }} />)
assert.match(recovered, /恢复后的未发送文字/)
assert.match(recovered, /恢复后的员工修订建议/)
assert.match(recovered, /采纳到偏好草稿/)
assert.match(recovered, /案例与适用边界建议/)
const inquiries = [{ id: 'synthetic', twinId: 'synthetic-twin', twinName: '合成分身', projectName: '合成项目', callerName: '合成领导', question: '估值及后续处理？', status: '待补充', reply: null, createdAt: '2026-10-16T00:00:00Z' }]
const inbox = renderToStaticMarkup(<TwinInquiryPanel list={inquiries} onReply={async () => { throw new Error('SSR must never submit') }} />)
assert.match(inbox, /分身收到的询问/)
assert.match(inbox, /合成领导 询问了 合成分身/)
assert.match(inbox, /aria-live="polite"/)
assert.match(inbox, /补充信息/)
assert.equal(renderToStaticMarkup(<TwinInquiryPanel list={[]} onReply={async () => {}} />), '')
const failedInbox = renderToStaticMarkup(<TwinInquiryPanel list={[]} loadError="合成刷新错误" onReply={async () => {}} />)
assert.match(failedInbox, /role="alert"/)
assert.match(failedInbox, /合成刷新错误/)
console.log(JSON.stringify({ ok: true, checks: ['three-templates', 'restored-focus-selection', 'quoted-rules-not-selected', 'voice-and-upload-actions', 'stable-professional-robot-legacy-fallback', 'restored-unconfirmed-builder-inputs', 'inquiry-pending-empty-and-load-error'], browserInteractionTest: false }))
