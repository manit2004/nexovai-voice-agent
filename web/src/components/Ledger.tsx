import { useState } from 'react'
import type { Appointment } from '../types'
import { fmtDay, fmtPhone, fmtTime } from '../format'

type Props = { appointments: Appointment[]; flash: Map<number, 'booked' | 'cancelled'> }

const TABS = [
  ['booked', 'Upcoming'],
  ['cancelled', 'Cancelled'],
  ['all', 'All'],
] as const

const EMPTY = { booked: 'No upcoming appointments.', cancelled: 'No cancelled appointments.', all: 'No appointments.' }

export function Ledger({ appointments, flash }: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('booked')
  const rows = appointments.filter((a) => tab === 'all' || a.status === tab)
  const count = (t: string) => appointments.filter((a) => t === 'all' || a.status === t).length

  return (
    <section className="card appts">
      <div className="card-head">
        <h2>Appointments</h2>
        <div className="tabs" role="tablist">
          {TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {label} <span>{count(k)}</span>
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="empty">{EMPTY[tab]}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Patient</th>
                <th className="col-doc">Doctor</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} data-status={a.status} data-flash={flash.get(a.id)}>
                  <td>
                    <b>{fmtTime(a.starts_at)}</b>
                    <span>{fmtDay(a.starts_at)}</span>
                  </td>
                  <td>
                    <b>{a.patient_name}</b>
                    <span>{fmtPhone(a.phone)}</span>
                  </td>
                  <td className="col-doc">
                    <b>{a.doctor}</b>
                    <span>{a.specialty}</span>
                  </td>
                  <td>
                    <span className="tag" data-status={a.status}>
                      {a.status === 'booked' ? 'Booked' : 'Cancelled'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
