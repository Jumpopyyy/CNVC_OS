import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuestionDeleteDialog } from '../../src/components/dueDiligence/QuestionDeleteDialog.js'
import type { Question } from '../../src/components/dueDiligence/types.js'

// Static contract only; the development fixture separately tests async interaction.
Object.assign(globalThis, { React })
let deletes = 0
const question: Question = { id: 'synthetic', projectId: 'synthetic', title: '<script>合成问题</script>', category: '业务', priority: '中', evidenceRequirement: '', status: '待核查', assigneeName: '', fileId: null, source: '合成验收', version: 1, createdAt: '2026-10-17T00:00:00Z' }
const html = renderToStaticMarkup(<QuestionDeleteDialog question={question} onDelete={async () => { deletes += 1 }} onClose={() => {}} />)
assert.match(html, /role="dialog" aria-modal="true" aria-label="删除核查问题"/)
for (const label of ['取消', '确认删除', '不删除关联项目材料']) assert.ok(html.includes(label))
assert.match(html, /&lt;script&gt;合成问题&lt;\/script&gt;/)
assert.equal(deletes, 0)
const page = readFileSync(new URL('../../src/pages/DueDiligencePage.tsx', import.meta.url), 'utf8')
const deletion = page.slice(page.indexOf('const deleteQuestion ='), page.indexOf('const updateQuestion ='))
assert.ok(deletion.includes('apiDelete'))
assert.ok(deletion.includes('核查问题已删除'))
assert.ok(!deletion.includes('window.confirm'))
console.log(JSON.stringify({ ok: true, checks: ['named-confirmation-and-safe-cancel', 'escaped-title-and-no-render-side-effect', 'parent-deletes-only-after-page-confirmation'], browserInteractionTest: false }))
