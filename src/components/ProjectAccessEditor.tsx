import { useEffect, useMemo, useState } from 'react'
import { Search, ShieldCheck } from 'lucide-react'
import { apiGet, apiPut } from '../lib/api'
import type { User } from '../types'
import { useToast } from './Toast'
import { Button, Drawer } from './ui'

type Scope = 'none' | 'own' | 'all'
type Grant = { projectId: string; projectName: string; canView: boolean; canEdit: boolean }
type Access = { mode: 'inherit' | 'custom'; version: number | null; readScope: Scope; editScope: Scope; grants: Grant[] }
type ProjectOption = { id: string; name: string; companyName: string }

const scopeLabels: Record<Scope, string> = { none: '无', own: '自己负责或参与', all: '全部项目' }
const scopeRanks: Record<Scope, number> = { none: 0, own: 1, all: 2 }

export function ProjectAccessEditor({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: () => Promise<void> }) {
  const { showToast } = useToast()
  const [access, setAccess] = useState<Access | null>(null)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<ProjectOption[]>([])
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    void apiGet<Access>(`/system-administration/users/${user.id}/project-access`)
      .then((result) => { if (current) setAccess(result) })
      .catch((reason: Error) => { if (current) setError(reason.message) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [user.id])

  useEffect(() => {
    let current = true
    const timer = window.setTimeout(() => {
      setSearching(true)
      void apiGet<ProjectOption[]>(`/system-administration/project-access/projects?keyword=${encodeURIComponent(query.trim())}`)
        .then((result) => { if (current) setOptions(result) })
        .catch((reason: Error) => { if (current) setError(reason.message) })
        .finally(() => { if (current) setSearching(false) })
    }, 250)
    return () => { current = false; window.clearTimeout(timer) }
  }, [query])

  const selectedIds = useMemo(() => new Set(access?.grants.map((grant) => grant.projectId) ?? []), [access?.grants])
  const unselectedOptions = options.filter((option) => !selectedIds.has(option.id))

  function setReadScope(readScope: Scope) {
    setAccess((current) => current && ({
      ...current, readScope,
      editScope: scopeRanks[current.editScope] > scopeRanks[readScope] ? readScope : current.editScope,
    }))
  }

  function setGrant(projectId: string, projectName: string, capability: 'view' | 'edit', checked: boolean) {
    setAccess((current) => {
      if (!current) return current
      const prior = current.grants.find((grant) => grant.projectId === projectId)
      const next = capability === 'view'
        ? { projectId, projectName, canView: checked, canEdit: checked ? Boolean(prior?.canEdit) : false }
        : { projectId, projectName, canView: checked || Boolean(prior?.canView), canEdit: checked }
      return {
        ...current,
        grants: [...current.grants.filter((grant) => grant.projectId !== projectId), ...(next.canView ? [next] : [])]
          .sort((left, right) => left.projectName.localeCompare(right.projectName, 'zh-CN')),
      }
    })
  }

  async function save() {
    if (!access) return
    setSaving(true)
    try {
      const body = access.mode === 'inherit'
        ? { mode: 'inherit', expectedVersion: access.version }
        : {
          mode: 'custom', expectedVersion: access.version,
          readScope: access.readScope, editScope: access.editScope,
          grants: access.grants.map(({ projectId, canView, canEdit }) => ({ projectId, canView, canEdit })),
        }
      await apiPut(`/system-administration/users/${user.id}/project-access`, body)
      showToast('项目权限已保存，目标成员需重新登录。')
      await onSaved()
      onClose()
    } catch (reason) { setError((reason as Error).message) }
    finally { setSaving(false) }
  }

  const projectRow = (projectId: string, projectName: string, companyName: string, grant?: Grant) => (
    <div key={projectId} className="grid grid-cols-[minmax(0,1fr)_56px_56px] items-center gap-3 border-b border-slate-100 py-2.5 text-sm">
      <span className="min-w-0"><span className="block truncate font-medium text-slate-700">{projectName}</span>{companyName && <span className="block truncate text-xs text-slate-400">{companyName}</span>}</span>
      <label className="flex justify-center" title={`查看 ${projectName}`}><input type="checkbox" aria-label={`查看 ${projectName}`} checked={Boolean(grant?.canView)} onChange={(event) => setGrant(projectId, projectName, 'view', event.target.checked)} /></label>
      <label className="flex justify-center" title={`编辑 ${projectName}`}><input type="checkbox" aria-label={`编辑 ${projectName}`} checked={Boolean(grant?.canEdit)} onChange={(event) => setGrant(projectId, projectName, 'edit', event.target.checked)} /></label>
    </div>
  )

  return <Drawer open title={`项目权限：${user.name}`} width="w-[min(720px,100vw)]" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>取消</Button><Button loading={saving} disabled={!access || loading} onClick={() => void save()}>保存权限</Button></>}>
    {loading ? <p className="py-8 text-sm text-slate-500">正在读取权限…</p> : error && !access ? <p role="alert" className="text-sm text-rose-600">{error}</p> : access && <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-700"><ShieldCheck className="h-4 w-4 text-brand-600" />项目管理权限</div>
      <div className="inline-flex max-w-full rounded-md border border-slate-200 p-1" role="group" aria-label="权限模式">
        {([{ value: 'inherit', label: '沿用现有规则' }, { value: 'custom', label: '自定义' }] as const).map((item) => <button key={item.value} type="button" aria-pressed={access.mode === item.value} className={`rounded px-3 py-1.5 text-sm ${access.mode === item.value ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`} onClick={() => setAccess({ ...access, mode: item.value })}>{item.label}</button>)}
      </div>
      {access.mode === 'custom' && <>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label><span className="label">可查看</span><select className="input w-full" value={access.readScope} onChange={(event) => setReadScope(event.target.value as Scope)}>{(Object.keys(scopeLabels) as Scope[]).map((scope) => <option key={scope} value={scope}>{scopeLabels[scope]}</option>)}</select></label>
          <label><span className="label">可编辑</span><select className="input w-full" value={access.editScope} onChange={(event) => setAccess({ ...access, editScope: event.target.value as Scope })}>{(Object.keys(scopeLabels) as Scope[]).map((scope) => <option key={scope} value={scope} disabled={scopeRanks[scope] > scopeRanks[access.readScope]}>{scopeLabels[scope]}</option>)}</select></label>
        </div>
        <section aria-label="单个项目授权">
          <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-800">单个项目</h3><span className="text-xs text-slate-500">已授权 {access.grants.length}</span></div>
          <label className="relative block"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input className="input w-full pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目名称或公司" aria-label="搜索项目" /></label>
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_56px_56px] gap-3 border-b border-slate-200 pb-2 text-xs font-medium text-slate-500"><span>项目</span><span className="text-center">查看</span><span className="text-center">编辑</span></div>
          <div className="max-h-[340px] overflow-y-auto">
            {access.grants.map((grant) => projectRow(grant.projectId, grant.projectName, '', grant))}
            {unselectedOptions.map((option) => projectRow(option.id, option.name, option.companyName))}
            {!searching && !access.grants.length && !unselectedOptions.length && <p className="py-5 text-center text-sm text-slate-500">没有匹配的项目</p>}
          </div>
          {searching && <p className="pt-2 text-xs text-slate-500">正在搜索…</p>}
        </section>
      </>}
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
    </div>}
  </Drawer>
}
