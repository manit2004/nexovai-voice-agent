export const fmtPhone = (p: string) => (p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p)

export const fmtTime = (iso: string) => {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', ' ')
}

export const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

export const dayKey = (iso: string) => iso.slice(0, 10)

export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export const surname = (name: string) => name.replace(/^Dr\.\s*/, '')

export const initials = (name: string) =>
  surname(name)
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
