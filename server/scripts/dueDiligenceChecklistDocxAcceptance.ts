import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { buildDueDiligenceQuestionPackDocx, type DueDiligenceQuestionDocumentInput } from '../src/services/dueDiligenceQuestionPackDocxService.js'
import { curateTwinChecklist, expertFocusQuestions } from '../src/services/digitalTwinChecklistService.js'
import { twinFocusRules, dueDiligenceCategories } from '../src/contracts/digitalTwinTemplates.js'

// Pure renderer contract: synthetic fixtures only; no database, API, or model.
// Pass an explicit temporary output directory to retain DOCX files for visual QA.
const output = process.env.DD_TEST_ARTIFACT_DIR ? path.resolve(process.env.DD_TEST_ARTIFACT_DIR) : null
const experts = [
  { id: 'culture', ownerName: '文化专家', version: 3, rules: twinFocusRules(['culture', 'incentives']) },
  { id: 'investment', ownerName: '投资专家', version: 2, rules: twinFocusRules(['product', 'technology', 'business', 'finance', 'legal']) },
  { id: 'growth', ownerName: '增长专家', version: 1, rules: twinFocusRules(['sales', 'channel']) },
]
const questions = curateTwinChecklist([], expertFocusQuestions(experts), experts)
assert.equal(new Set(questions.map(question => question.category)).size, dueDiligenceCategories.length)
const samples: Array<{ name: string; questions: DueDiligenceQuestionDocumentInput['questions'] }> = [
  { name: 'expert-checklist', questions },
  { name: 'long-checklist', questions: Array.from({ length: 30 }, (_, index) => ({
    ...questions[index % questions.length],
    title: `专项${index + 1} ${questions[index % questions.length].title}`,
    rationale: `${questions[index % questions.length].rationale} 对尚未核实的管理层陈述，分别记录已取得证据、相反证据与仍需补证的事项，不提前作出投资结论。`,
    evidenceRequirement: `${questions[index % questions.length].evidenceRequirement}；保留材料版本、访谈日期及口径说明。`,
  })) },
]
for (const sample of samples) {
  const bytes = await buildDueDiligenceQuestionPackDocx({ title: '合成验收 尽调问题清单', projectName: '合成项目', generatedAt: new Date('2026-10-16T00:00:00Z'), questions: sample.questions })
  const zip = await JSZip.loadAsync(bytes)
  const xml = await zip.file('word/document.xml')!.async('string')
  assert.doesNotMatch(xml, /关注来源|本清单由|PRIVATE_CASE/)
  assert.match(xml, /w:tblHeader/)
  assert.match(xml, /<w:tblW w:type="dxa" w:w="10466"/)
  assert.match(xml, /<w:gridCol w:w="1300"/)
  assert.ok((xml.match(/<w:jc w:val="center"/g) || []).length >= sample.questions.length * 3, 'short fields must remain centered')
  assert.equal((xml.match(/<w:tr>/g) || []).length, sample.questions.length + 1)
  for (const category of dueDiligenceCategories) assert.ok(xml.includes(category))
  let position = 0
  for (const question of sample.questions) {
    const next = xml.indexOf(question.title, position)
    assert.ok(next >= position, 'Word must preserve the current checklist order and full question text')
    position = next + question.title.length
  }
  if (output) { await mkdir(output, { recursive: true }); await writeFile(path.join(output, `${sample.name}.docx`), bytes) }
}
console.log(JSON.stringify({ ok: true, fixtures: samples.map(sample => ({ name: sample.name, questions: sample.questions.length })), visualReviewRequired: true, externalModelCalls: 0 }))
