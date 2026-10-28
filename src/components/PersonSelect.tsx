import { Children, cloneElement, isValidElement, useId, useState, type ReactNode, type SelectHTMLAttributes } from 'react'

const normalized = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase()
const optionText = (children: ReactNode): string => Children.toArray(children).map(child => isValidElement<{ children?: ReactNode }>(child) ? optionText(child.props.children) : String(child)).join('')

/** Keep the native change event and selected IDs, including multi-selections outside the search. */
export function PersonSelect({ children, searchLabel, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { searchLabel?: string }) {
  const [query, setQuery] = useState('')
  const searchId = useId()
  const label = searchLabel ?? `搜索${props['aria-label'] ?? '人名'}`
  const selected = new Set((Array.isArray(props.value) ? props.value : [props.value]).map(String))
  const matches = (child: ReactNode): ReactNode => {
    if (!isValidElement<{ children?: ReactNode; value?: string | number; hidden?: boolean }>(child)) return child
    if (child.type === 'optgroup') return cloneElement(child, {}, Children.map(child.props.children, matches))
    if (child.type !== 'option') return child
    const value = String(child.props.value ?? optionText(child.props.children))
    const hidden = Boolean(query.trim()) && value !== '' && !selected.has(value) && !normalized(optionText(child.props.children)).includes(normalized(query))
    return cloneElement(child, { hidden: child.props.hidden || hidden })
  }
  const widthClasses = props.className?.split(/\s+/).filter(value => /^(?:[a-z]+:)?(?:w-|min-w-|max-w-|flex-1)/.test(value)).join(' ')
  return <span className={`inline-flex min-w-0 flex-col gap-1 align-middle ${widthClasses ?? ''}`} data-person-select="true">
    <input id={searchId} type="search" aria-label={label} placeholder={label} className="input min-w-0 w-full text-xs" style={{ minHeight: 32, padding: '5px 9px' }} disabled={props.disabled} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }} autoComplete="off" />
    <select {...props} aria-label={props['aria-label'] ?? '选择人员'} onMouseDown={event => {
      props.onMouseDown?.(event)
      if (!props.multiple || props.disabled || event.defaultPrevented || event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey) return
      const option = event.target instanceof HTMLOptionElement ? event.target : null
      if (!option || option.disabled || option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled) return
      event.preventDefault()
      event.currentTarget.focus()
      // A plain native multi-select click otherwise clears every other selected person.
      option.selected = !option.selected
      event.currentTarget.dispatchEvent(new Event('change', { bubbles: true }))
    }}>{Children.map(children, matches)}</select>
    {props.multiple && <small className="text-xs text-slate-500">点击姓名选择或取消，可选择多人</small>}
  </span>
}

export function PeopleSearch({ children, label = '搜索人名', disabled = false }: {
  children: (matches: (...values: unknown[]) => boolean) => ReactNode
  label?: string
  disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const matches = (...values: unknown[]) => !normalized(query) || values.some(value => normalized(value).includes(normalized(query)))
  return <div className="min-w-0 space-y-2" data-people-search="true">
    <input type="search" aria-label={label} placeholder={label} className="input min-w-0 w-full text-xs" disabled={disabled} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }} autoComplete="off" />
    {children(matches)}
  </div>
}
