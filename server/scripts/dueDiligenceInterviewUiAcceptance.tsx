import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { InterviewsWorkspace } from '../../src/components/dueDiligence/InterviewsWorkspace.js'
import type { Interview, TranscriptionJob } from '../../src/components/dueDiligence/types.js'

// SSR does not run effects or start a microphone. Supply only the browser
// capability surface read during rendering; no API, database or model is used.
Object.assign(globalThis, { React, window: {} })

const interview: Interview = {
  id: 'interview-synthetic', projectId: 'project-synthetic', title: '合成验收访谈',
  mode: '现场', status: '筹备中', scheduledAt: null, agenda: null,
  notes: null, summary: null, version: 1,
}
const callbacks = {
  onSelect: () => {}, onCreate: () => {}, onRecordingState: () => {},
  onSave: async () => null, onDelete: async () => {}, onReorder: async () => {},
  onRemoveMaterial: async () => {}, onUploadSummary: async () => {},
  onSaveTranscript: async () => null, onUploadRecording: async () => null,
  onUploadRecordingFile: async () => null, onStartAsr: async () => null,
  onRetryAsr: async () => {}, onGenerateSummary: async () => null,
  onArchiveText: async () => {}, onSendPrompt: async () => {},
  onConfirmPrompt: async () => {}, onDeletePrompt: async () => {},
  onRefreshLive: async () => {},
}
type Props = Parameters<typeof InterviewsWorkspace>[0]
const base: Props = {
  projectId: interview.projectId, interviews: [interview], selected: interview,
  prompts: [], artifacts: [], transcriptionJobs: [], writeReady: true,
  asrConfigured: false, ...callbacks,
}
const render = (patch: Partial<Props> = {}) => renderToStaticMarkup(React.createElement(InterviewsWorkspace, { ...base, ...patch }))
const button = (html: string, label: string) => {
  const markup = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
    .map(match => match[0]).find(value => value.replace(/<[^>]+>/g, '').trim() === label)
  assert.ok(markup, `missing button: ${label}`)
  return markup
}

const available = render()
for (const label of ['提交录音', '开始录入', '保存草稿', '生成纪要']) button(available, label)
assert.doesNotMatch(button(available, '提交录音'), /\bdisabled=/, 'ASR missing must not prevent retaining original recordings')
assert.match(button(available, '生成纪要'), /\bdisabled=/, 'empty transcript must not generate invented minutes')

const writeBlocked = render({ writeReady: false, writeError: '合成写入校验错误' })
for (const label of ['提交录音', '开始录入', '保存草稿', '生成纪要']) {
  assert.match(button(writeBlocked, label), /\bdisabled=/, `write unavailable must disable ${label}`)
}

const missingAsr: TranscriptionJob = {
  id: 'job-synthetic', interviewId: interview.id, recordingFileId: 'recording-synthetic',
  status: '未配置', provider: null, browserText: '', providerText: null,
  mergedText: null, sourceTranscriptVersion: null, attempts: 0,
  errorMessage: '后台语音识别服务尚未配置，录音已保留。', createdAt: '2026-10-09T00:00:00.000Z',
}
const unconfigured = render({ transcriptionJobs: [missingAsr] })
assert.match(unconfigured, /后台转写：未配置/)
assert.match(unconfigured, /后台语音识别服务尚未配置/)
assert.match(button(unconfigured, '重试转写'), /\bdisabled=/, 'missing ASR configuration must not invite repeated retries')
assert.doesNotMatch(unconfigured, /后台转写完成|自动转写成功/)
assert.doesNotMatch(unconfigured, /采用后台转写|采用并生成纪要/, 'no provider text must not expose a successful adoption flow')

const ready = render({
  asrConfigured: true,
  transcriptionJobs: [{ ...missingAsr, status: '待合并', provider: 'synthetic-asr', providerText: '仅供合成验收的访谈文字', errorMessage: null }],
})
assert.match(ready, /仅供合成验收的访谈文字/)
assert.match(ready, /采用.*转写/)
const providerWriteBlocked = render({
  writeReady: false,
  transcriptionJobs: [{ ...missingAsr, status: '待合并', providerText: '仅供合成验收的访谈文字', errorMessage: null }],
})
for (const label of ['采用并保存转写', '采用并生成纪要']) {
  assert.match(button(providerWriteBlocked, label), /\bdisabled=/, `write unavailable must disable ${label}`)
}

const unselected = render({ selected: undefined })
assert.match(unselected, /请选择或新建一场访谈/)
assert.doesNotMatch(unselected, /提交录音|生成纪要|保存草稿/)

console.log(JSON.stringify({ ok: true, checks: ['persistent-actions', 'write-unavailable', 'honest-asr-unconfigured', 'provider-adoption', 'no-selected-interview'] }))
