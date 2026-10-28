export function TwinVersionDetails({ name, privateVersion, publishedVersion }: { name: string; privateVersion?: number; publishedVersion?: number }) {
  return <details className="mt-3 text-xs text-slate-500">
    <summary aria-label={`${name}的详情`} className="cursor-pointer py-1 text-brand-700">详情</summary>
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      {privateVersion !== undefined && <><dt>私有版本</dt><dd>v{privateVersion}</dd></>}
      {publishedVersion !== undefined && <><dt>公开版本</dt><dd>v{publishedVersion}</dd></>}
    </dl>
  </details>
}
