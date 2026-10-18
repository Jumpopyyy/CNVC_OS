import { useEffect } from 'react'

// Browser unloads and sidebar links must not silently discard a pending suggestion.
export function useTwinLeaveGuard(pending: boolean, message = '分身有尚未保存的内容，确定离开吗？请确认恢复草稿已暂存；下次进入后可选择恢复。') {
  useEffect(() => {
    if (!pending) return
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const leave = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') as HTMLAnchorElement | null : null
      if (!link || link.target === '_blank' || link.hasAttribute('download') || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return
      const url = new URL(link.href, window.location.href)
      if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search) return
      if (!window.confirm(message)) { event.preventDefault(); event.stopPropagation() }
    }
    window.addEventListener('beforeunload', unload)
    document.addEventListener('click', leave, true)
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', leave, true) }
  }, [pending, message])
}
