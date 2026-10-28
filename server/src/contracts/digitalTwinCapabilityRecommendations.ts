import { twinFocusOptions } from './digitalTwinTemplates.js'
import { LibraryReferenceSchema, libraryKey, type LibraryItem, type LibraryReference, type LibrarySelection } from './dueDiligenceLibrary.js'

// Match only metadata returned by the permission-filtered catalogue. This is a
// transparent rule recommendation, never a claim that a workflow has executed.
const focusTerms: Record<string, string[]> = {
  culture: ['组织文化', '组织治理', '公司治理', '管理层', '治理结构'],
  incentives: ['激励', '薪酬', '组织', '人力资源'],
  product: ['产品', '商业尽调', '商业模式'],
  technology: ['技术', 'trl', '研发', '专利', '复现'],
  business: ['商业模式', '产业链', '商业尽调', '尽调资料', '投资访谈'],
  finance: ['财务', '三表', '现金流', '年报', '对账'],
  legal: ['法务', '法律', '合同', '法规', '合规', '监管'],
  sales: ['销售', '增长', '回款', '营销'],
  channel: ['渠道', '营销', '销售'],
  customers: ['客户', '回款', '访谈', '应收'],
  supply: ['供应商', '供应链', '产业链', '采购'],
  earnings: ['盈利质量', '营运资本', '现金流', '收入确认', '利润质量'],
  transactions: ['交易', '条款', '合同', '股权', '融资公告'],
  security: ['数据安全', '网络安全', '系统可靠性', '信息安全', '隐私'],
  market: ['行业', '赛道', '市场', '产业链'],
  competition: ['竞争', '竞品', '技术路线', '替代'],
  valuation: ['估值', '投资研判', '投资建议', '投资备忘录', '融资公告'],
  sources: ['交叉核验', '交叉验证', '多源', '事实核验', '证据', '文献'],
  meeting: ['会议', '纪要', '访谈', '决议'],
  writing: ['写作', '报告', '汇报', '周报', '回信', '备忘录'],
  data: ['数据分析', '表格', '对账', '金额核对', '勾稽', '差异归因'],
  execution: ['项目推进', '任务跟进', '待办', '协作', '追踪'],
  knowledge: ['知识', '资料归纳', '文档版本', '经验', '检索'],
  confidentiality: ['保密', '脱敏', '权限', '机密', '隐私'],
}

export type TwinCapabilityRequest = { id: string; focusIds: string[] }
export type TwinCapabilityRecommendation = { selection: LibrarySelection; reasons: Array<{ key: string; focuses: string[] }> }
export const twinLibrarySelectionIdentity = (value: LibrarySelection) => JSON.stringify({
  skills: value.skills.map(item => `${libraryKey(item)}:${item.version}:${item.hash}`).sort(),
  agent: value.agent ? `${libraryKey(value.agent)}:${value.agent.version}:${value.agent.hash}` : null,
})

export function recommendTwinCapabilities(ids: string[], catalog: LibraryItem[]): TwinCapabilityRecommendation {
  const focuses = twinFocusOptions.filter(item => ids.includes(item.id))
  const unique = new Map<string, LibraryItem>()
  for (const item of catalog) {
    const agentSource = item.source === 'workflow' || item.source === 'prompt-agent'
    if (!LibraryReferenceSchema.safeParse(item).success || item.kind !== (agentSource ? 'agent' : 'skill')) continue
    const old = unique.get(libraryKey(item))
    if (!old || item.version > old.version || item.version === old.version && item.hash < old.hash) unique.set(libraryKey(item), item)
  }
  const candidates = [...unique.values()].map(item => {
    const name = item.name.toLocaleLowerCase(), description = item.description.slice(0, 6000).toLocaleLowerCase()
    const matches = focuses.flatMap(focus => {
      const terms = focusTerms[focus.id] || []
      const score = terms.some(term => name.includes(term)) ? 4 : terms.some(term => description.includes(term)) ? 1 : 0
      return score ? [{ id: focus.id, label: focus.label, score }] : []
    })
    return { item, matches, score: matches.reduce((sum, match) => sum + match.score, 0) }
  }).filter(item => item.score > 0)
  const skills: typeof candidates = [], covered = new Set<string>()
  // Prefer useful topic coverage over four near-identical methods.
  while (skills.length < 4) {
    const remaining = candidates.filter(candidate => candidate.item.kind === 'skill' && !skills.includes(candidate))
    remaining.sort((a, b) => {
      const marginal = (candidate: typeof a) => candidate.matches.reduce((sum, match) => sum + match.score * (covered.has(match.id) ? 1 : 3), 0)
      return marginal(b) - marginal(a) || b.score - a.score || libraryKey(a.item).localeCompare(libraryKey(b.item))
    })
    if (!remaining.length) break
    skills.push(remaining[0]); remaining[0].matches.forEach(match => covered.add(match.id))
  }
  const agent = candidates.filter(candidate => candidate.item.kind === 'agent').sort((a, b) => b.score - a.score || libraryKey(a.item).localeCompare(libraryKey(b.item)))[0]
  const reference = (item: LibraryItem): LibraryReference => ({ source: item.source, id: item.id, version: item.version, hash: item.hash })
  return {
    selection: { skills: skills.map(candidate => reference(candidate.item)), agent: agent ? reference(agent.item) : null, replaceBindings: true },
    reasons: [...skills, ...(agent ? [agent] : [])].map(candidate => ({ key: libraryKey(candidate.item), focuses: candidate.matches.map(match => match.label) })),
  }
}

// Existing common/manual choices need an explicit decision. Subsequent changes
// may replace only a recommendation that the employee has not manually altered.
export function mayApplyTwinRecommendation(current: LibrarySelection, explicit: boolean, lastAutomatic?: string) {
  return twinLibrarySelectionIdentity(current) === lastAutomatic || !explicit && !current.skills.length && !current.agent
}

export function twinInitialDraftMessage(rules: string, supplement: string) {
  // Managed focus rules live at the start of the draft; custom prose is never
  // interpreted as an instruction to select or execute additional capabilities.
  const message = [
    '请根据当前已选专业起点、判断偏好和本次辅助能力，生成一份可编辑的数字分身初稿。',
    '保留已有手写偏好；将工作关注点整理为具体核查方式、证据要求和判断习惯。模板仅作建议，不虚构我的经历、技能、项目事实或已完成的核查。需要澄清的地方通过追问确认，结果不自动保存或发布。',
    rules.trim() ? '当前偏好草稿已随本次请求提供，请在其基础上整理。' : '',
    supplement.trim() ? `我的补充要求：\n${supplement.trim()}` : '',
  ].filter(Boolean).join('\n\n')
  if (message.length > 8000) throw new Error('补充内容过长，请适当缩短后生成初稿；原文仍保留在输入框中。')
  return message
}
