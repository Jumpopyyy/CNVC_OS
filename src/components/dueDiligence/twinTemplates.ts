import { summarizeTwinFocus } from '../../../server/src/contracts/digitalTwinTemplates'
export { twinFocusOptions, twinTemplates, twinTemplateGroups, type TwinTemplateGroupId, twinFocusRules, splitTwinFocusRules, replaceTwinFocusRules, summarizeTwinFocus, dueDiligenceCategory, dueDiligenceCategories } from '../../../server/src/contracts/digitalTwinTemplates'

// A populated description is a saved note, even for older auto-mode twins.
export function resolveTwinDescription(twin: { rules: string; description?: string | null; descriptionMode?: string | null }) {
  const saved = twin.description ?? ''
  return saved.trim() || twin.descriptionMode === 'manual' ? saved : summarizeTwinFocus(twin.rules)
}
