import { useId, useState } from 'react'

const PRESETS = ['robot-blue', 'robot-navy', 'robot-teal', 'robot-slate', 'robot-indigo', 'robot-gold'] as const
const PALETTES = ['#2563A9', '#263D59', '#197D85', '#526779', '#5558A2', '#9B7B35']
export const twinAvatarPresets = PRESETS
export function defaultTwinAvatar(value: string) { return PRESETS[[...value].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7) % PRESETS.length] }
export function TwinAvatar({ id, name, preset, kind, size = 'md', previewUrl }: { id: string; name: string; preset?: string | null; kind?: string | null; size?: 'sm' | 'md' | 'lg'; previewUrl?: string | null }) {
  const gradient = useId().replace(/:/g, '')
  const [failedImage, setFailedImage] = useState('')
  const selected = PRESETS.includes(preset as typeof PRESETS[number]) ? preset! : defaultTwinAvatar(id || name)
  const color = PALETTES[PRESETS.indexOf(selected as typeof PRESETS[number])]
  const dimension = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-20 w-20' : 'h-12 w-12'
  const imageUrl = previewUrl || (kind === 'upload' ? `/api/due-diligence/twins/${id}/avatar` : '')
  if (imageUrl && failedImage !== imageUrl) return <img className={`${dimension} shrink-0 rounded-2xl object-cover ring-1 ring-slate-200`} src={imageUrl} alt={`${name}头像`} onError={() => setFailedImage(imageUrl)} />
  return <svg viewBox="0 0 100 100" role="img" aria-label={`${name}头像`} className={`${dimension} shrink-0 rounded-2xl ring-1 ring-slate-200`}>
    <defs><linearGradient id={gradient} x2="0.8" y2="1"><stop stopColor="#F3F8FC" /><stop offset="1" stopColor="#DBE8F2" /></linearGradient><linearGradient id={`${gradient}face`} x2="0" y2="1"><stop stopColor={color} /><stop offset="1" stopColor="#183957" /></linearGradient></defs>
    <rect width="100" height="100" rx="20" fill={`url(#${gradient})`} />
    <path d="M22 100v-13q0-17 18-21h20q18 4 18 21v13" fill="#263F52" />
    <path d="M37 69l13 24 13-24-13 3z" fill="#F8FBFD" /><path d="M47 75h6l2 14-5 5-5-5z" fill={color} />
    <path d="M35 69l-6 12 12-1-1 10 10 8zM65 69l6 12-12-1 1 10-10 8z" fill="#35586C" />
    <rect x="10" y="32" width="12" height="24" rx="6" fill="#B8CBD9" /><rect x="78" y="32" width="12" height="24" rx="6" fill="#B8CBD9" />
    <path d="M50 21v-8" stroke="#7E9BAD" strokeWidth="3" /><circle cx="50" cy="10" r="4" fill="#E5BE55" />
    <rect x="17" y="22" width="66" height="47" rx="20" fill="#FDFEFF" stroke="#C1D1DC" strokeWidth="1.5" />
    <rect x="24" y="28" width="52" height="33" rx="13" fill={`url(#${gradient}face)`} />
    <rect x="34" y="37" width="5" height="11" rx="2.5" fill="#B9EBFF" /><rect x="61" y="37" width="5" height="11" rx="2.5" fill="#B9EBFF" />
    <path d="M44 51q6 6 12 0" fill="none" stroke="#B9EBFF" strokeWidth="2.5" strokeLinecap="round" />
    <circle cx="66" cy="89" r="4" fill="#73BDD1" /><circle cx="66" cy="89" r="2" fill="#E2F8FF" />
  </svg>
}
