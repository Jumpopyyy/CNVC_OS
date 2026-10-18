import { dueDiligenceCategories, dueDiligenceCategory, twinFocusOptions } from '../contracts/digitalTwinTemplates.js'
import { combineGeneratedQuestions, normalizeQuestionTitle, type GeneratedQuestionDraft, type ExpertQuestionReference } from './dueDiligenceQuestionMergeService.js'

export type ChecklistExpert = { id:string; ownerName:string; version:number; rules:string; boundaries?:string | null }
const focusAliases: Record<string, string[]> = {
  culture: ['文化', '企业文化', '价值观', '文化价值观', '企业文化价值观'], incentives: ['激励', '绩效', '期权'],
  product: ['产品', '客户价值'], technology: ['技术', '研发', '技术及研发'], business: ['业务', '商业模式', '竞争'],
  finance: ['财务', '估值', '现金流'], legal: ['法务', '法律', '合规'], sales: ['销售', '销售团队', '销售团队建设', '销售团队建设及激励'], channel: ['渠道'],
}
export function matchExpertFocus(expert: ChecklistExpert) {
  const boundary = expert.boundaries?.trim() || ''
  if (boundary && boundary !== '仅提供辅助建议，结论须依据项目证据核验。') return { options: [], warning: `${expert.ownerName}分身设有自定义适用边界，标准模式未自动套用，需智能分析核验适用性。` }
  const lines = expert.rules.split(/\r?\n/).map(line => line.replace(/^\s*(?:[•*]\s*|-\s+|\d+[.)、]\s*)/, '').trim()).filter(Boolean)
  const matched = new Set<string>()
  for (const line of lines) {
    const exact = twinFocusOptions.find(option => option.rule === line)
    if (exact) { matched.add(exact.id); continue }
    const topics = line.replace(/^(?:重点关注|优先关注|关注|优先核验|重点核验|核验)\s*[:：]?\s*/, '').replace(/[。.]$/, '').split(/[、，,；;]/).map(value => value.trim()).filter(Boolean)
    for (const topic of topics) {
      const option = twinFocusOptions.find(item => item.label === topic || focusAliases[item.id].includes(topic))
      // Never detach a positive keyword from a negation, condition or exception.
      if (!option) return { options: [], warning: `${expert.ownerName}分身含自定义判断或限制，标准模式未推断其含义，需智能分析。` }
      matched.add(option.id)
    }
  }
  return { options: twinFocusOptions.filter(option => matched.has(option.id)), warning: lines.length ? '' : `${expert.ownerName}分身尚未设置公开关注点。` }
}
export function expertFocusQuestions(experts: ChecklistExpert[]): GeneratedQuestionDraft[] {
  return experts.flatMap(expert => {
    const { options } = matchExpertFocus(expert)
    if (!options.length) return []
    return options.map(option => ({ title: option.question, category: dueDiligenceCategory(option.category), priority: '高' as const, evidenceRequirement: option.evidence, rationale: `核查${option.label}，对应${expert.ownerName}已发布的关注点。`, publicationIds: [expert.id], sourceNames: [], sourceKind: '专家关注规则匹配', templateItemId: `expert-focus-${option.id}`, attentionSource: `${expert.ownerName}分身 v${expert.version} 关注：${option.label}`, evidence: [] }))
  })
}

/** An expert name/ID alone is not evidence of using that expert's published rules. */
export function validateExpertQuestionReferences(question: { publicationIds: string[]; expertReferences?: Array<{publicationId:string;ruleExcerpt:string}> }, experts: ChecklistExpert[]): ExpertQuestionReference[] {
  const references = question.expertReferences || []
  const ids = [...new Set([...question.publicationIds, ...references.map(item => item.publicationId)])]
  return ids.map(id => {
    const expert = experts.find(item => item.id === id)
    const reference = references.find(item => item.publicationId === id)
    const excerpt = reference?.ruleExcerpt.trim() || ''
    const statements = expert?.rules.split(/\r?\n|(?<=[。！？])/u).map(line => line.replace(/^\s*[•*-]\s*/, '').trim()).filter(Boolean) || []
    if (!expert || !excerpt || !statements.includes(excerpt) || references.filter(item => item.publicationId === id).length !== 1) throw new Error('专家问题缺少有效的完整公开规则依据，未采用本轮智能清单')
    return { publicationId: id, publishedVersion: expert.version, ruleExcerpt: excerpt }
  })
}

export function expertQuestionAttention(references: ExpertQuestionReference[], experts: ChecklistExpert[]) {
  // The question column is varchar(512); full IDs, versions and excerpts remain in the pack snapshot.
  const short = (text: string, length: number) => Array.from(text).length > length ? `${Array.from(text).slice(0, length - 1).join('')}…` : text
  return references.map(reference => {
    const expert = experts.find(item => item.id === reference.publicationId)!
    return `${short(expert.ownerName, 24)}分身 v${reference.publishedVersion} 关注：${short(reference.ruleExcerpt, 48)}`
  }).join('；')
}

/** The AI returns a complete short list. Baseline questions only fill missing broad categories. */
export function curateTwinChecklist(baseline: GeneratedQuestionDraft[], enhanced: GeneratedQuestionDraft[], experts: ChecklistExpert[]) {
  const output = combineGeneratedQuestions(enhanced).map(item => ({ ...item, category: dueDiligenceCategory(item.category) }))
  for (const category of dueDiligenceCategories) if (!output.some(item => item.category === category)) output.push(...baseline.filter(item => dueDiligenceCategory(item.category) === category).slice(0, 2).map(item => ({ ...item, category })))
  // A selected expert must contribute a traceable question, not merely appear in the prompt.
  for (const expert of experts) {
    if (output.some(item => item.publicationIds.includes(expert.id))) continue
    const matched = expertFocusQuestions([expert]).slice(0, 2)
    if (!matched.length) continue // Caller reports unapplied experts; never force an unverified attribution.
    for (const question of matched) {
      const existing = output.find(item => normalizeQuestionTitle(item.title) === normalizeQuestionTitle(question.title))
      if (existing) { existing.publicationIds = [...new Set([...existing.publicationIds, expert.id])]; existing.attentionSource = [existing.attentionSource, question.attentionSource].filter(Boolean).join('；') }
      else output.push(question)
    }
  }
  const merged = combineGeneratedQuestions(output)
  const required = new Set<GeneratedQuestionDraft>()
  for (const category of dueDiligenceCategories) { const item = merged.find(item => item.category === category); if (item) required.add(item) }
  for (const expert of experts) { const item = merged.find(item => item.publicationIds.includes(expert.id)); if (item) required.add(item) }
  for (const item of merged) { if (required.size >= 30) break; required.add(item) }
  return merged.filter(item => required.has(item))
}
