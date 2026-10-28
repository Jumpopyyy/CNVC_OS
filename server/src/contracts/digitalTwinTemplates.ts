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
  { id: 'customers', label: '客户质量与集中度', category: '业务', rule: '按客户、产品及期间拆分收入与回款，交叉核验客户集中度、关联关系、续约和流失，避免以单次大单推断持续需求。', question: '主要客户的收入、回款、续约与流失如何变化，是否存在关联交易或对单一客户的实质依赖？', evidence: '客户分层明细、合同、回款记录、关联方清单及客户访谈' },
  { id: 'supply', label: '供应链与交付', category: '业务', rule: '沿采购、产能、库存、交付和售后核验履约能力，识别单一供应商依赖、质量损失与规模扩张约束。', question: '订单增长能否被产能、关键供应和交付质量支持，供应中断与质量问题如何影响现金占用？', evidence: '采购合同、供应商结构、产能利用率、库存和交付质量记录' },
  { id: 'earnings', label: '盈利质量与现金流', category: '财务', rule: '拆分经常性与非经常性损益，交叉核验收入确认、毛利、应收账龄及经营现金流，对异常变化追溯原始凭证。', question: '账面利润能否转化为经营现金流，收入确认、费用资本化、应收和存货减值是否影响盈利质量？', evidence: '财务报表、凭证、合同履约记录、应收账龄和银行流水' },
  { id: 'transactions', label: '股权与交易条件', category: '法务', rule: '梳理股权沿革、实际控制、关联关系及交易先决条件，区分商业诉求与专业法律结论，未核实事项提交专业人员复核。', question: '股权权属、历史出资、特殊权利与交割条件之间是否存在冲突，哪些事项需在交易前由专业人员复核？', evidence: '工商档案、出资凭证、股东协议、交易条款及专业法律意见' },
  { id: 'security', label: '数据与系统安全', category: '技术', rule: '关注数据来源及授权、访问控制、关键系统依赖和故障恢复，用实际记录验证安全措施，不以制度文件代替运行证据。', question: '关键数据是否有合法来源和使用授权，权限、系统稳定性及故障恢复措施是否经过实际验证？', evidence: '授权记录、权限清单、系统架构、故障及恢复演练记录' },
  { id: 'market', label: '行业空间与产业链', category: '业务', rule: '明确市场定义、统计时点和产业链位置，自上而下与自下而上交叉估算市场空间，区分总市场与可实际触达市场。', question: '市场空间的口径、时点和来源是否一致，公司可触达市场与收入预测之间有哪些待验证假设？', evidence: '有日期和口径的行业资料、客户数量与单价测算、产业链访谈' },
  { id: 'competition', label: '竞争格局与替代风险', category: '业务', rule: '比较同类产品与替代方案的价格、效果和切换成本，以赢单及丢单案例验证竞争优势，主动寻找相反证据。', question: '公司在真实竞标及客户替换中为何赢单或丢单，差异化是否足以抵御替代方案和价格竞争？', evidence: '竞标记录、客户访谈、可比产品参数与价格、替换成本资料' },
  { id: 'valuation', label: '估值假设与敏感性', category: '财务', rule: '统一估值时点、股权口径与可比对象，分情景检验增长、利润和退出假设，明确估值区间与关键敏感因素，不把预测当事实。', question: '在增长、利润和退出条件变化时估值区间如何变化，可比对象及关键假设是否具有解释力？', evidence: '估值模型、可比口径、经营假设、敏感性测算和交易条件' },
  { id: 'sources', label: '信息来源与反证', category: '业务', rule: '为核心判断保留来源、日期、口径和原文依据，分开记录事实、推断与未知信息；对矛盾来源和反例先核实再下结论。', question: '支撑核心经营判断的资料能否追溯原始来源，冲突数据和反例是否已经核实？', evidence: '原始材料、出处与日期、口径说明及交叉验证记录' },
  { id: 'meeting', label: '纪要与决策记录', category: '办公', rule: '整理会议时区分讨论、提议、已确认决策和待确认事项，保留关键分歧；仅按实际确认记录负责人及时间，不臆造承诺。', question: '', evidence: '' },
  { id: 'writing', label: '结构化写作与汇报', category: '办公', rule: '先明确受众与目的，按结论、依据、影响和下一步组织报告；标明数据来源和未确认项，压缩重复内容，保持用语与数字口径一致。', question: '', evidence: '' },
  { id: 'data', label: '数据核对与分析', category: '办公', rule: '分析表格前核对单位、币种、期间、维度、缺失值与重复记录，保留计算过程并检查异常；不把相关性直接解释为因果关系。', question: '', evidence: '' },
  { id: 'execution', label: '计划与协作推进', category: '办公', rule: '把目标拆为可验收的交付物、依赖与检查节点，区分已承诺安排和建议计划，及时暴露阻塞；未经确认不代替他人承诺或变更任务。', question: '', evidence: '' },
  { id: 'knowledge', label: '知识整理与复用', category: '办公', rule: '整理知识时保留原始出处、版本、适用场景和例外，合并重复内容但不抹去冲突；把一次性事实与可复用方法分开，未经确认不写成通用规则。', question: '', evidence: '' },
  { id: 'confidentiality', label: '保密与对外沟通', category: '办公', rule: '按接收对象检查材料可见范围，对外表达前复核事实、敏感信息及授权；不擅自披露项目资料或代替负责人作出承诺。', question: '', evidence: '' },
] as const
export const twinTemplateGroups = [
  { id: 'investment', name: '投资尽调', description: '围绕证据、风险和交易判断' },
  { id: 'research', name: '研究分析', description: '从信息核验到形成研究观点' },
  { id: 'office', name: '办公协作', description: '让表达、记录和执行更高效' },
] as const
export type TwinTemplateGroupId = typeof twinTemplateGroups[number]['id']
export const twinTemplates = [
  { id: 'investment', group: 'investment', name: '综合投资尽调', description: '贯通商业、技术、财务和法务，形成证据链与待核验事项。', focusIds: ['product', 'technology', 'business', 'finance', 'legal'], avatar: 'robot-blue' },
  { id: 'commercial', group: 'investment', name: '商业与客户尽调', description: '从客户需求、收入结构到供应交付，检验增长的可持续性。', focusIds: ['product', 'business', 'customers', 'supply'], avatar: 'robot-blue' },
  { id: 'financial', group: 'investment', name: '财务质量尽调', description: '核验盈利、回款和现金占用，定位异常与财务假设。', focusIds: ['finance', 'earnings', 'customers'], avatar: 'robot-blue' },
  { id: 'legal', group: 'investment', name: '法务与交易核查', description: '关注权属、重大合同和交割条件，列出专业复核事项。', focusIds: ['legal', 'transactions'], avatar: 'robot-navy' },
  { id: 'technology', group: 'investment', name: '产品与技术尽调', description: '验证产品价值、技术交付与研发效率，兼顾系统和数据安全。', focusIds: ['product', 'technology', 'security'], avatar: 'robot-blue' },
  { id: 'culture', group: 'investment', name: '组织与治理尽调', description: '以实际决策核验文化、管理一致性与团队激励。', focusIds: ['culture', 'incentives'], avatar: 'robot-navy' },
  { id: 'industry', group: 'research', name: '行业与产业链研究', description: '拆解产业链、市场口径和需求驱动，保留来源与反证。', focusIds: ['market', 'business', 'sources'], avatar: 'robot-teal' },
  { id: 'competitive', group: 'research', name: '竞争与商业模式分析', description: '比较替代方案、客户选择和切换成本，检验竞争优势。', focusIds: ['competition', 'product', 'customers', 'sources'], avatar: 'robot-teal' },
  { id: 'valuation', group: 'research', name: '估值与投资研判', description: '对齐可比口径，用多情景与敏感性分析审视定价假设。', focusIds: ['finance', 'valuation', 'sources'], avatar: 'robot-navy' },
  { id: 'growth', group: 'research', name: '销售增长与投后支持', description: '分析销售组织、激励和渠道，区分真实动销与短期冲量。', focusIds: ['sales', 'incentives', 'channel'], avatar: 'robot-teal' },
  { id: 'meetings', group: 'office', name: '会议纪要与复盘', description: '厘清决策、分歧和待确认事项，整理可跟进的会议记录。', focusIds: ['meeting', 'execution', 'confidentiality'], avatar: 'robot-teal' },
  { id: 'reporting', group: 'office', name: '报告写作与汇报', description: '围绕受众组织结论与依据，输出简洁、准确的表达。', focusIds: ['writing', 'confidentiality'], avatar: 'robot-blue' },
  { id: 'data-analysis', group: 'office', name: '表格核对与数据分析', description: '先检查口径和数据质量，再解释差异、异常与趋势。', focusIds: ['data', 'writing'], avatar: 'robot-blue' },
  { id: 'project-execution', group: 'office', name: '项目推进与协作', description: '梳理交付物、依赖和阻塞，让计划与实际承诺保持一致。', focusIds: ['execution', 'meeting'], avatar: 'robot-teal' },
  { id: 'knowledge', group: 'office', name: '知识整理与经验复用', description: '保留出处、合并重复、标记冲突，沉淀可复用工作方法。', focusIds: ['knowledge', 'confidentiality'], avatar: 'robot-navy' },
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
