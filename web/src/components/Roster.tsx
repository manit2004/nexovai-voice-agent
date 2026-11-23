import { useMemo } from 'react'
import type { Doctor } from '../types'
import { dayKey, fmtTime, initials } from '../format'

type Props = {
  doctors: Doctor[]
  day: string | null
  onDay: (d: string) => void
  flash: Map<number, 'booked' | 'cancelled'>
}

export function Roster({ doctors, day, onDay, flash }: Props) {
  const days = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of doctors)
      for (const s of d.slots) {
        const k = dayKey(s.starts_at)
        m.set(k, (m.get(k) ?? 0) + (!s.booked && s.starts_at > localIso() ? 1 : 0))
      }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [doctors])

  const active = day ?? days[0]?.[0]

  return (
    <section className="panel roster">
      <div className="panel-head">
        <h2>Doctors</h2>
        <span className="legend">
          <i className="sw open" /> open <i className="sw taken" /> booked
        </span>
      </div>

      <div className="days" role="tablist">
        {days.map(([k, open]) => {
          const d = new Date(`${k}T00:00`)
          return (
            <button key={k} role="tab" aria-selected={k === active} className="day" onClick={() => onDay(k)}>
              <span className="dow">{d.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
              <span className="dom">{d.getDate()}</span>
              <span className="cnt">{open || '—'}</span>
            </button>
          )
        })}
      </div>

      <ul className="docs">
        {doctors.map((doc) => {
          const slots = doc.slots.filter((s) => dayKey(s.starts_at) === active)
          return (
            <li key={doc.id} className="doc">
              <div className="doc-id">
                <span className="mono-badge">{initials(doc.name)}</span>
                <div>
                  <div className="doc-name">{doc.name}</div>
                  <div className="doc-meta">
                    {doc.specialty} · {doc.room}
                  </div>
                </div>
              </div>
              <div className="slots">
                {slots.length === 0 && <span className="off">Not in clinic</span>}
                {slots.map((s) => {
                  const past = s.starts_at.slice(0, 16) <= localIso()
                  const f = flash.get(s.id)
                  return (
                    <span
                      key={s.id}
                      className="slot"
                      data-state={past ? 'past' : s.booked ? 'taken' : 'open'}
                      data-flash={f}
                      title={past ? 'Past' : s.booked ? 'Booked' : 'Open'}
                    >
                      {fmtTime(s.starts_at)}
                    </span>
                  )
                })}
              </div>
            </li>
          )
        })}
        {doctors.length === 0 && <li className="empty">Waiting for the clinic server…</li>}
      </ul>
    </section>
  )
}

/** Local wall-clock 'YYYY-MM-DDTHH:MM', comparable with slot strings. */
function localIso() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
