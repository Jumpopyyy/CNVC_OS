import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { tsImport } from 'tsx/esm/api'

const { TwinVersionDetails } = await tsImport('../../src/components/dueDiligence/TwinVersionDetails.tsx', { parentURL: import.meta.url, tsconfig: new URL('../../tsconfig.app.json', import.meta.url).pathname })
const { ExperienceAssetsWorkspace } = await tsImport('../../src/components/dueDiligence/ExperienceAssetsWorkspace.tsx', { parentURL: import.meta.url, tsconfig: new URL('../../tsconfig.app.json', import.meta.url).pathname })

test('version details stay collapsed and distinguish private and published snapshots', () => {
  const html = renderToStaticMarkup(<TwinVersionDetails name="演示分身" privateVersion={5} publishedVersion={3} />)
  assert.match(html, /^<details\b/)
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:[\s=>])/)
  assert.match(html, /<summary[^>]*aria-label="演示分身的详情"[^>]*>详情<\/summary>/)
  assert.match(html, /<dt>私有版本<\/dt><dd>v5<\/dd>/)
  assert.match(html, /<dt>公开版本<\/dt><dd>v3<\/dd>/)
})

test('public details do not include a private version', () => {
  const html = renderToStaticMarkup(<TwinVersionDetails name="公开分身" publishedVersion={2} />)
  assert.ok(html.includes('公开版本'))
  assert.ok(html.includes('v2'))
  assert.ok(!html.includes('私有版本'))
})

test('workspace shows publication state without a details entry or version labels, retaining delete actions', () => {
  const twin = { id: 'own', name: '本人分身', role: '投资经理', rules: '核验依据', cases: '', activeVersion: 5, updatedAt: '2026-10-20T00:00:00Z' }
  const publication = { id: 'publication', twinId: 'other', twinName: '专家分身', ownerUserId: 'colleague', ownerName: '演示同事', role: '投资总监', department: '投资部', publishedVersion: 3, introduction: '公开偏好', publicRules: '公开内容', publicCases: '', industryTags: [], capabilityTags: [], publishedAt: '2026-10-20T00:00:00Z' }
  const noop = () => {}, asyncNoop = async () => {}
  const base = { preview: true, currentUserId: 'owner', twins: [twin], publicTwins: [publication], selectedTwin: undefined, draft: { ...twin }, isNew: false, dirty: false, saving: false, draftId: 'draft', projects: [], assets: [], candidates: [], skills: [], skillImports: [], sources: [], platformSkills: [], onBuildUploadAdopted: noop, onBuildUpload: async () => null, onNew: noop, onSelect: noop, onDraft: noop, onSave: asyncNoop, onDelete: asyncNoop, onPublish: asyncNoop, onWithdraw: asyncNoop, onImportLocal: asyncNoop, onImportSource: asyncNoop, onParseAsset: async () => null, onAssetDecision: asyncNoop, onUpdateCandidate: asyncNoop, onExcludeImport: asyncNoop, onRefreshLearning: asyncNoop, onDecideCandidates: asyncNoop, onImportSkillFiles: asyncNoop, onImportGithubSkill: asyncNoop, onImportPlatformSkill: asyncNoop, onLearnSkill: asyncNoop, onToggleSkill: asyncNoop }
  const render = (publicTwins = base.publicTwins, selectedTwin?: typeof twin) => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Object.defineProperty(globalThis, 'window', { value: {}, configurable: true })
    try { return renderToStaticMarkup(<ExperienceAssetsWorkspace {...base} selectedTwin={selectedTwin} publicTwins={publicTwins} />) }
    finally { if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window') }
  }
  const html = render(), select = html.match(/<button[^>]*aria-pressed="false"[^>]*>([\s\S]*?)<\/button>/)![1]
  assert.match(select, /本人分身[\s\S]*未公开/)
  assert.doesNotMatch(select, /私有版本|v5|<details|<summary/)
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:[\s=>])/)
  const summary = html.replace(/<details\b[\s\S]*?<\/details>/g, '')
  assert.doesNotMatch(summary, /私有版本|公开版本|v5|v3/)
  assert.match(summary, /公司分身库[\s\S]*已公开/)
  const published = render([...base.publicTwins, { ...publication, id: 'own-publication', twinId: twin.id, ownerUserId: 'owner', ownerName: '本人' }])
  assert.match(published.match(/<button[^>]*aria-pressed="false"[^>]*>([\s\S]*?)<\/button>/)![1], /已公开/)
  assert.match(render([]).match(/<button[^>]*aria-pressed="false"[^>]*>([\s\S]*?)<\/button>/)![1], /未公开/)
  const editing = render(base.publicTwins, twin)
  assert.match(editing, /class="twin-workspace-grid"/)
  assert.match(editing, /aria-label="分身列表"/)
  assert.ok(editing.indexOf('twin-profile-header') < editing.indexOf('对话完善分身'))
  assert.ok(editing.indexOf('对话完善分身') < editing.indexOf('沉淀的 Skill 库'))
  assert.match(editing, /role="tab" aria-selected="true"[^>]*>已沉淀/)
  assert.match(editing, /role="tab" aria-selected="false"[^>]*>待学习/)
  assert.match(editing, /<section role="tabpanel"[^>]*hidden=""/)
  assert.doesNotMatch(editing, /起点场景分类|角色设定|私有案例与适用边界/)
  assert.match(editing, /调用对话/)
  assert.match(editing, /更换数字分身头像/)
  assert.doesNotMatch(editing, /私有版本|公开版本|v5|v3|的详情|>详情</)
  assert.doesNotMatch(editing, /twin-more-actions|>更多</)
  assert.match(editing, /data-variant="danger"[^>]*>[\s\S]*?删除分身<\/button>/)
  assert.doesNotMatch(render(), /删除分身/)
})
