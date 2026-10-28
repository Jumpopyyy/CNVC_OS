import type { TwinAssetAdoption, TwinDraft } from './types'
import { summarizeTwinFocus } from './twinTemplates'

// Generate a missing initial note only at save time, after the employee has
// finished typing. Existing notes and intentionally cleared notes stay fixed.
export function prepareTwinDraftForSave(draft: TwinDraft): TwinDraft {
  const description = draft.description?.trim() || draft.descriptionMode === 'manual'
    ? draft.description ?? ''
    : summarizeTwinFocus(draft.rules)
  return { ...draft, description, descriptionMode: description.trim() || draft.descriptionMode === 'manual' ? 'manual' : 'auto' }
}

// Staging never marks server materials as processed. The final version save does both.
export function stageTwinAsset(draft: TwinDraft, adoption: TwinAssetAdoption, replacement?: TwinDraft): TwinDraft {
  if (draft.assetAdoptions?.some(item => item.assetId === adoption.assetId)) return draft
  return {
    ...(replacement || { ...draft, rules: [draft.rules, adoption.traits].filter(Boolean).join('\n\n') }),
    assetAdoptions: [...(draft.assetAdoptions || []), adoption],
  }
}
