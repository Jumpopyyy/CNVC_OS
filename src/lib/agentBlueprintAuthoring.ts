import type { AgentBlueprint } from '../../server/src/contracts/agentBlueprintContract'

export function createMarkdownAgent(markdown: string, modelId: string): AgentBlueprint {
  if (!markdown.trim()) throw new Error('请粘贴 Markdown 提示词或上传 .md 文件')
  if (!modelId) throw new Error('请先选择使用的模型')
  if (markdown.length > 16000) throw new Error('Markdown 最多 16000 字符；较长方法请拆分为多个模块')
  if (markdown.includes('\0')) throw new Error('Markdown 包含无法识别的字符')
  const heading = markdown.match(/^#{1,6}\s+(.+)$/m)?.[1].trim()
  return {
    schemaVersion: 1,
    name: (heading || '我的 Markdown Agent').slice(0, 100),
    description: '从 Markdown 提示词创建，可在高级画布中继续编排。',
    modules: [{ id: 'markdown_agent', name: '按方法处理输入', modelId, prompt: markdown,
      inputTemplate: '{{input}}', skillIds: [], outputFormat: 'markdown', outputInstructions: '' }],
  }
}

export async function readAgentMarkdown(file: File): Promise<string> {
  if (!/\.(md|markdown)$/i.test(file.name)) throw new Error('请选择 Markdown（.md 或 .markdown）文件')
  if (file.size > 128 * 1024) throw new Error('Markdown 文件最多 128 KB')
  try { return new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()) }
  catch { throw new Error('文件必须使用有效的 UTF-8 编码') }
}
