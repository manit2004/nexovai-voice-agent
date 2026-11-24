import { useCallback, useEffect, useState } from 'react'
import type { Appointment, Doctor, ServerEvent } from './types'
import { useCall } from './useCall'
import { Phone } from './components/Phone'
import { Roster } from './components/Roster'
import { Ledger } from './components/Ledger'
import { ActivityLog } from './components/ActivityLog'
import { Icon } from './components/Icon'
import { dayKey } from './format'

type Flash = Map<number, 'booked' | 'cancelled'>

export default function App() {
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [online, setOnline] = useState<boolean | null>(null)
  const [day, setDay] = useState<string | null>(null)
  const [slotFlash, setSlotFlash] = useState<Flash>(new Map())
  const [rowFlash, setRowFlash] = useState<Flash>(new Map())
  const [phoneOpen, setPhoneOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([fetch('/api/schedule'), fetch('/api/appointments')])
      if (!s.ok || !a.ok) throw new Error()
      setDoctors(await s.json())
      setAppointments(await a.json())
      setOnline(true)
    } catch {
      setOnline(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = setInterval(refresh, 15000)
    return () => clearInterval(id)
  }, [refresh])

  const onEvent = useCallback(
    (e: ServerEvent) => {
      if (e.type !== 'appointment') return
      const { appointment: a, action } = e
      // Jump the schedule to the affected day and highlight the slot and the table row.
      setDay(dayKey(a.starts_at))
      const mark = (set: React.Dispatch<React.SetStateAction<Flash>>, id: number) => {
        set((m) => new Map(m).set(id, action))
        setTimeout(() => set((m) => (m.delete(id), new Map(m))), 2600)
      }
      mark(setSlotFlash, a.slot_id)
      mark(setRowFlash, a.id)
      void refresh()
    },
    [refresh],
  )

  const call = useCall({ onEvent })

  const open = () => {
    setPhoneOpen(true)
    if (call.status === 'idle' || call.status === 'ended' || call.status === 'failed') void call.start()
  }
  const close = () => {
    setPhoneOpen(false)
    setTimeout(call.reset, 350) // let the phone slide out first
  }

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  const inCall = call.status === 'ringing' || call.status === 'live'

  return (
    <div className="app" data-phone={phoneOpen}>
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>
            L
          </span>
          <span className="clinic">Larkspur Clinic</span>
          <span className="section">Front desk</span>
        </div>
        <div className="top-right">
          <span className="date">{today}</span>
          <span className="status" data-online={online}>
            <i /> {online === null ? 'Connecting' : online ? 'Connected' : 'Server offline'}
          </span>
          <button className="btn primary" onClick={open} data-live={inCall}>
            <Icon name="phone" size={16} />
            {inCall ? 'Back to call' : 'Start call'}
          </button>
        </div>
      </header>

      <main className="main">
        <Roster doctors={doctors} day={day} onDay={setDay} flash={slotFlash} online={online} />
        <div className="side">
          <Ledger appointments={appointments} flash={rowFlash} />
          <ActivityLog items={call.activity} />
        </div>
      </main>

      <div className="phone-dock" data-open={phoneOpen}>
        {call.status !== 'idle' && <Phone call={call} onClose={close} />}
      </div>
    </div>
  )
}
