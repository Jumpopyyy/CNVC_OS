import { twinTemplates } from './twinTemplates'

export type StartingPointSelection = { templateIds: string[]; extraFocusIds: string[] }
const template = (id: string) => twinTemplates.find(item => item.id === id)
const union = (ids: string[], extra: string[] = []) => [...new Set([...extra, ...ids.flatMap(id => [...(template(id)?.focusIds || [])])])]
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id))

// Old versions store only focus rules. Infer a combination only when there is
// exactly one smallest cover; ambiguous combinations remain standalone focuses.
export function selectionFromFocuses(focusIds: string[]): StartingPointSelection {
  const focuses = [...new Set(focusIds)]
  if (!focuses.length) return { templateIds: [], extraFocusIds: [] }
  const candidates = twinTemplates.filter(item => item.focusIds.every(id => focuses.includes(id)))
  let best = Infinity, matches: string[][] = []
  const search = (index: number, chosen: string[], covered: string[]) => {
    if (chosen.length > best) return
    if (sameSet(covered, focuses)) {
      if (chosen.length < best) { best = chosen.length; matches = [] }
      matches.push(chosen)
      return
    }
    if (index >= candidates.length || chosen.length >= best) return
    search(index + 1, [...chosen, candidates[index].id], union([candidates[index].id], covered))
    search(index + 1, chosen, covered)
  }
  search(0, [], [])
  return matches.length === 1 ? { templateIds: matches[0], extraFocusIds: [] } : { templateIds: [], extraFocusIds: focuses }
}

export function selectedFocuses(selection: StartingPointSelection) { return union(selection.templateIds, selection.extraFocusIds) }

export function toggleStartingPoint(selection: StartingPointSelection, id: string): StartingPointSelection {
  if (!template(id)) return selection
  return { ...selection, templateIds: selection.templateIds.includes(id) ? selection.templateIds.filter(value => value !== id) : [...selection.templateIds, id] }
}

export function toggleStartingFocus(selection: StartingPointSelection, id: string): StartingPointSelection {
  const current = selectedFocuses(selection)
  if (!current.includes(id)) return { ...selection, extraFocusIds: [...selection.extraFocusIds, id] }
  const remaining = current.filter(value => value !== id)
  const templateIds = selection.templateIds.filter(value => template(value)?.focusIds.every(focus => focus !== id))
  const covered = union(templateIds)
  return { templateIds, extraFocusIds: remaining.filter(value => !covered.includes(value)) }
}

export function sameStartingFocuses(a: string[], b: string[]) { return sameSet([...new Set(a)], [...new Set(b)]) }
