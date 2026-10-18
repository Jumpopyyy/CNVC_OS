import { createHash } from 'node:crypto'
import type { TwinRuntimeSnapshot } from './dueDiligenceTwinRuntimeService.js'

// Publishing can replace public rules without creating a new private version.
// Bind public history and in-flight replies to the actual authorized context.
// Keep private keys compatible; no raw public/private text is stored in this key.
export function twinDialogueContextKey(snapshot: TwinRuntimeSnapshot, publicPrompt?: string, knowledgeFingerprint?: string) {
  if (snapshot.visibility === 'public' && !publicPrompt) throw new Error('公开分身上下文缺失')
  return createHash('sha256').update(JSON.stringify({
    ...snapshot,
    excludedSkillIds: undefined,
    ...(snapshot.visibility === 'public' ? { publicContextHash: createHash('sha256').update(publicPrompt!).digest('hex') } : {}),
    ...(knowledgeFingerprint ? { knowledge: knowledgeFingerprint } : {}),
  })).digest('hex')
}
