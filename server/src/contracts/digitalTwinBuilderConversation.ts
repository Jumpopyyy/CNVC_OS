export type TwinBuilderMessage = { id: string; role: string; content: string; metadata?: Record<string, unknown> }
export type TwinBuilderMessageEdit = { messageId: string; expectedContent: string; expectedLastMessageId: string }
export type TwinBuilderTurn<T extends TwinBuilderMessage = TwinBuilderMessage> = { id: string; messages: T[] }

export function twinBuilderTurns<T extends TwinBuilderMessage>(messages: T[]): TwinBuilderTurn<T>[] {
  const turns: TwinBuilderTurn<T>[] = []
  for (const message of messages) {
    if (message.role === 'user' || !turns.length) turns.push({ id: typeof message.metadata?.twinBuildTurnId === 'string' ? message.metadata.twinBuildTurnId : message.id, messages: [] })
    turns.at(-1)!.messages.push(message)
  }
  return turns
}

export const twinBuilderRevision = (messages: TwinBuilderMessage[]) => messages.at(-1)?.id ?? null

export function requireTwinBuilderRevision(messages: TwinBuilderMessage[], expected: string | null) {
  if (twinBuilderRevision(messages) !== expected) throw Object.assign(new Error('对话已在其他页面更新，当前输入已保留；请重新加载后核对'), { status: 409 })
}

// Edits create a new conversation branch. Original messages remain in storage
// for audit, but superseded turns must not re-enter the UI or model context.
export function visibleTwinBuilderMessages<T extends TwinBuilderMessage>(messages: T[]): T[] {
  let visible: T[] = []
  for (const message of messages) {
    const deletedTurnId = message.metadata?.twinBuildDeletedTurnId
    if (typeof deletedTurnId === 'string') {
      const turn = twinBuilderTurns(visible).find(item => item.id === deletedTurnId)
      if (!turn) continue // Idempotent audit replay; never show an operation as a chat message.
      const ids = new Set(turn.messages.map(item => item.id))
      const index = visible.findIndex(item => ids.has(item.id))
      visible = visible.flatMap((item, position) => ids.has(item.id) ? [] : [position > index && item.role === 'assistant' ? { ...item, metadata: { ...item.metadata, twinBuildProposalInvalidated: true } } : item])
      continue
    }
    const replacedId = message.role === 'user' && message.metadata?.twinBuildReplacesMessageId
    if (typeof replacedId === 'string') {
      const index = visible.findIndex(item => item.id === replacedId && item.role === 'user')
      if (index < 0) throw Object.assign(new Error('构建对话历史已变化，请刷新后重试'), { status: 409 })
      visible = visible.slice(0, index)
    }
    visible.push(message)
  }
  return visible
}

// Replies downstream of a deleted turn may quote it. Keep them visible for the
// employee, but do not feed them (or their proposal snapshots) back to the model.
export function twinBuilderContext<T extends TwinBuilderMessage>(messages: T[]): T[] {
  return messages.filter(message => !message.metadata?.twinBuildProposalInvalidated)
}

export function historyBeforeTwinBuilderEdit<T extends TwinBuilderMessage>(messages: T[], edit: TwinBuilderMessageEdit): T[] {
  const index = messages.findIndex(item => item.id === edit.messageId)
  if (index < 0 || messages[index].role !== 'user') throw Object.assign(new Error('只能编辑当前构建对话中本人发送的消息'), { status: 400 })
  if (messages[index].content !== edit.expectedContent || messages.at(-1)?.id !== edit.expectedLastMessageId) {
    throw Object.assign(new Error('对话已在其他页面更新，编辑文字已保留；请刷新后核对再提交'), { status: 409 })
  }
  return messages.slice(0, index)
}
