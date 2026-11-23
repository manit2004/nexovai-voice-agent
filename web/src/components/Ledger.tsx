import { useState } from 'react'
import type { Appointment } from '../types'
import { fmtDay, fmtPhone, fmtTime } from '../format'

type Props = { appointments: Appointment[]; flash: Map<number, 'booked' | 'cancelled'> }

const TABS = [
  ['booked', 'Upcoming'],
  ['cancelled', 'Cancelled'],
  ['all', 'All'],
] as const

export function Ledger({ appointments, flash }: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('booked')
  const rows = appointments.filter((a) => tab === 'all' || a.status === tab)
  const count = (t: string) => appointments.filter((a) => t === 'all' || a.status === t).length

  return (
    <section className="panel ledger">
      <div className="panel-head">
        <h2>Appointments</h2>
        <div className="seg" role="tablist">
          {TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {label} <span>{count(k)}</span>
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          {tab === 'booked' ? 'No bookings yet. Place a call and ask for a slot.' : 'Nothing here.'}
        </div>
      ) : (
        <ol className="rows">
          {rows.map((a) => (
            <li key={a.id} className="row" data-status={a.status} data-flash={flash.get(a.id)}>
              <div className="r-when">
                <b>{fmtTime(a.starts_at)}</b>
                <span>{fmtDay(a.starts_at)}</span>
              </div>
              <div className="r-who">
                <b>{a.patient_name}</b>
                <span className="mono">{fmtPhone(a.phone)}</span>
              </div>
              <div className="r-doc">
                <b>{a.doctor}</b>
                <span>{a.specialty}</span>
              </div>
              <div className="r-status">
                <span className="tag" data-status={a.status}>
                  {a.status === 'booked' ? 'Booked' : 'Cancelled'}
                </span>
                <span className="mono r-id">#{String(a.id).padStart(4, '0')}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
