/** Shared, browser-safe setup options. Templates are preferences, never project facts. */
export const twinFocusOptions = [
  { id: 'culture', label: '文化与价值观', category: '团队', rule: '通过管理层与一线员工的具体决策案例交叉核验企业文化、价值观及言行一致性。', question: '管理层如何在增长、客户利益与合规发生冲突时作出决策？请提供实际案例并与员工交叉核验。', evidence: '管理层和一线访谈、实际决策记录及员工反馈' },
  { id: 'incentives', label: '激励机制', category: '团队', rule: '关注激励指标、兑现机制、公平性与长期目标是否一致，核查激励的实际效果及潜在逆向选择。', question: '核心团队及一线员工的激励如何计算和兑现？是否诱发短期冲量、隐瞒风险或人才流失？', evidence: '激励制度、实际发放记录、绩效数据及离职访谈' },
  { id: 'product', label: '产品与客户价值', category: '业务', rule: '验证产品解决的真实需求、客户付费意愿、产品竞争力与可持续复购。', question: '客户为何选择并持续使用该产品？请用付费、续约、流失及竞品替代案例验证产品价值。', evidence: '客户访谈、订单、续约和流失数据、产品演示' },
  { id: 'technology', label: '技术与研发', category: '技术', rule: '区分技术演示与可交付能力，核查技术壁垒、研发效率、知识产权及关键人员依赖。', question: '核心技术的可复现效果、研发投入与商业交付之间是否一致，关键能力能否脱离个别人员持续迭代？', evidence: '独立测试、研发记录、技术架构、交付与知识产权资料' },
  { id: 'business', label: '业务与竞争', category: '业务', rule: '核验商业模式、客户获取与竞争优势，区分行业增长与企业自身竞争力。', question: '公司增长来自行业红利还是可持续竞争优势？请核验客户获取成本、留存和竞品替代情况。', evidence: '业务明细、客户访谈、市场数据及竞争案例' },
  { id: 'finance', label: '财务与估值', category: '财务', rule: '将收入、利润与现金流交叉核验，区分预测与已实现业绩，并记录估值口径、谈判时间和条件。', question: '收入、利润和回款能否闭环核验，融资估值依据及关键假设在不同经营情景下是否成立？', evidence: '合同、验收、发票、银行流水、估值模型及融资条款' },
  { id: 'legal', label: '法务与合规', category: '法务', rule: '关注股权、重大合同、资质、知识产权与合规红线，明确法律问题对交易的实质影响。', question: '股权、重大合同、资质或知识产权是否存在影响交易完成及持续经营的实质障碍？', evidence: '股权及合同原件、资质证照、诉讼记录和法律意见' },
  { id: 'sales', label: '销售团队与激励', category: '团队', rule: '分析销售组织、人才梯队、目标分解与佣金激励是否支持可持续回款，关注业绩对少数个人的依赖。', question: '销售目标、佣金和回款如何联动，团队业绩是否依赖少数人员，人员流动对客户与收入有何影响？', evidence: '销售组织、人员与业绩明细、佣金规则、回款及客户归属记录' },
  { id: 'channel', label: '渠道建设', category: '业务', rule: '核查渠道招募、覆盖、终端动销、返利与利益冲突，区分压货与真实客户需求。', question: '渠道增长是否对应终端动销与真实回款，返利、库存和区域冲突如何控制？', evidence: '渠道合同、进销存、终端订单、返利和退货记录' },
] as const
export const twinTemplates = [
  { id: 'culture', name: '组织文化型', description: '文化价值观、管理方式与激励机制', focusIds: ['culture', 'incentives'], avatar: 'robot-navy' },
  { id: 'investment', name: '综合投资型', description: '产品、技术、业务、财务与法务', focusIds: ['product', 'technology', 'business', 'finance', 'legal'], avatar: 'robot-blue' },
  { id: 'growth', name: '销售增长型', description: '销售团队、激励与渠道建设', focusIds: ['sales', 'incentives', 'channel'], avatar: 'robot-teal' },
] as const
export function twinFocusRules(ids: string[]) { return twinFocusOptions.filter(item => ids.includes(item.id)).map(item => `• ${item.rule}`).join('\n') }

/** Only the leading, exact generated option block is managed by the checkbox UI.
 * Once free text begins, preserve the whole remaining block: a later template
 * sentence may be quoted, negated or qualified by the employee's preceding text.
 */
export function splitTwinFocusRules(rules: string) {
  const focusIds: string[] = []
  let end = 0
  for (const match of rules.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    if (!match[0]) continue
    const line = match[0].trim()
    if (!line) { end = match.index + match[0].length; continue }
    const option = twinFocusOptions.find(item => line === `• ${item.rule}`)
    if (!option) break
    if (!focusIds.includes(option.id)) focusIds.push(option.id)
    end = match.index + match[0].length
  }
  return { focusIds, customRules: focusIds.length ? rules.slice(end) : rules }
}

export function replaceTwinFocusRules(rules: string, ids: string[]) {
  const { customRules } = splitTwinFocusRules(rules)
  const selected = twinFocusRules(ids)
  return selected ? `${selected}${customRules.trim() ? `\n\n${customRules}` : ''}` : customRules
}
export const dueDiligenceCategories = ['业务与市场', '产品与技术', '团队与治理', '财务与估值', '法务与合规'] as const
export function dueDiligenceCategory(value: string) {
  const categories: Record<string, string> = { 业务: '业务与市场', 技术: '产品与技术', 团队: '团队与治理', 财务: '财务与估值', 法务: '法务与合规', 合规: '法务与合规' }
  return categories[value] || (dueDiligenceCategories.includes(value as typeof dueDiligenceCategories[number]) ? value : '业务与市场')
}
export function summarizeTwinFocus(rules: string) {
  // Only exact, standalone template rules can be replaced with their labels.
  // Free text is an excerpt, not a semantic inference (especially for negation).
  const lines = rules.split(/\r?\n/).map(line => line.replace(/^\s*(?:[•*]\s*|-\s+|\d+[.)、]\s*)/, '').trim()).filter(Boolean)
  if (!lines.length) return ''
  const options = lines.map(line => twinFocusOptions.find(item => line === item.rule))
  if (options.every(option => option !== undefined)) return `关注${[...new Set(options.map(option => option.label))].join('、')}。`
  // A free-form preface may negate rules on following lines, so mixed content
  // must retain its original order and wording rather than infer topic labels.
  const excerpts = new Set<string>()
  for (const text of lines) {
    for (const sentence of text.match(/[^。！？]+[。！？]?/gu) || []) {
      const value = sentence.replace(/\s+/g, ' ').trim()
      if (value) excerpts.add(value)
    }
  }
  const summary = excerpts.size ? `偏好摘录：${[...excerpts].join(' ')}` : ''
  const characters = Array.from(summary)
  return characters.length > 180 ? `${characters.slice(0, 179).join('')}…` : summary
}

/** Recompute private auto descriptions without rewriting stored history or public snapshots. */
export function resolveTwinDescription(twin: { rules: string; description?: string | null; descriptionMode?: string | null }) {
  return twin.descriptionMode === 'manual' ? twin.description ?? '' : summarizeTwinFocus(twin.rules)
}
