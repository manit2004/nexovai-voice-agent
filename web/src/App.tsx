import { useCallback, useEffect, useMemo, useState } from 'react'
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
      // Jump the roster to the affected day and light up the slot + ledger row.
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

  const stats = useMemo(() => {
    const now = new Date()
    const openSlots = doctors.flatMap((d) => d.slots).filter((s) => !s.booked && new Date(s.starts_at) > now).length
    return {
      open: openSlots,
      booked: appointments.filter((a) => a.status === 'booked').length,
      cancelled: appointments.filter((a) => a.status === 'cancelled').length,
    }
  }, [doctors, appointments])

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
  const inCall = call.status === 'ringing' || call.status === 'live'

  return (
    <div className="app" data-phone={phoneOpen}>
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden>
            +
          </span>
          <span className="word">Larkspur</span>
          <span className="sep" />
          <span className="desk">Front desk</span>
        </div>
        <div className="top-right">
          <span className="status" data-online={online}>
            <i /> {online === false ? 'Server offline' : 'Agent on duty'}
          </span>
          <span className="date">{today}</span>
        </div>
      </header>

      <main className="main">
        <section className="hero">
          <div>
            <h1>
              Calls in. <em>Bookings out.</em>
            </h1>
            <p>
              The voice agent checks slots, books and cancels, identifying callers by the number they say aloud.
            </p>
          </div>
          <div className="hero-side">
            <dl className="stats">
              <div>
                <dt>Open slots</dt>
                <dd>{stats.open}</dd>
              </div>
              <div>
                <dt>Booked</dt>
                <dd>{stats.booked}</dd>
              </div>
              <div>
                <dt>Cancelled</dt>
                <dd>{stats.cancelled}</dd>
              </div>
            </dl>
            <button className="try" onClick={open} data-live={inCall}>
              <span className="try-ico">
                <Icon name="phone" size={18} />
              </span>
              {inCall ? 'Return to call' : 'Try a call'}
            </button>
          </div>
        </section>

        <div className="grid">
          <Roster doctors={doctors} day={day} onDay={setDay} flash={slotFlash} />
          <div className="stack">
            <Ledger appointments={appointments} flash={rowFlash} />
            <ActivityLog items={call.activity} />
          </div>
        </div>
      </main>

      <div className="phone-dock" data-open={phoneOpen}>
        {call.status !== 'idle' && <Phone call={call} onClose={close} />}
      </div>
    </div>
  )
}
