import type { TwinAssetAdoption, TwinDraft } from './types'

// Staging never marks server materials as processed. The final version save does both.
export function stageTwinAsset(draft: TwinDraft, adoption: TwinAssetAdoption, replacement?: TwinDraft): TwinDraft {
  if (draft.assetAdoptions?.some(item => item.assetId === adoption.assetId)) return draft
  return {
    ...(replacement || { ...draft, rules: [draft.rules, adoption.traits].filter(Boolean).join('\n\n') }),
    assetAdoptions: [...(draft.assetAdoptions || []), adoption],
  }
}
