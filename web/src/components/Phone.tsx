import { useEffect, useRef, useState } from 'react'
import type { CallApi } from '../useCall'
import type { Appointment, Line } from '../types'
import { fmtClock, fmtDay, fmtPhone, fmtTime } from '../format'
import { Waveform } from './Waveform'
import { Icon } from './Icon'

export function Phone({ call, onClose }: { call: CallApi; onClose: () => void }) {
  const { status, lines, muted, startedAt, endedAt, speaking, error } = call
  const [now, setNow] = useState(Date.now())
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (status !== 'live') return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [status])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [lines])

  const elapsed = startedAt ? (endedAt ?? now) - startedAt : 0
  const clock = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const sub =
    status === 'ringing' ? 'Calling…'
    : status === 'live' ? fmtClock(elapsed)
    : status === 'ended' ? `Call ended · ${fmtClock(elapsed)}`
    : 'Call failed'

  return (
    <div className="phone" data-state={status} role="dialog" aria-label="Call with Larkspur Clinic">
      <div className="phone-screen">
        <div className="statusbar">
          <span>{clock}</span>
          <span className="island" />
          <span className="sb-icons">
            <Icon name="signal" />
            <Icon name="battery" />
          </span>
        </div>

        <header className="callee">
          <div className="avatar" data-speaking={speaking === 'bot'}>
            <span>LC</span>
            <i className="ring r1" />
            <i className="ring r2" />
            <i className="ring r3" />
          </div>
          <div className="callee-name">Larkspur Clinic</div>
          <div className="callee-sub">
            {status === 'live' && <span className="live-dot" />}
            {sub}
          </div>
        </header>

        {status === 'live' && <Waveform analysers={call.analysers} active={speaking !== null} />}

        <div className="transcript" ref={scroller}>
          {status === 'failed' && <p className="hint">{error ?? "Couldn't connect."} Is the server running?</p>}
          {lines.map((l) =>
            l.kind === 'card' ? (
              <Receipt key={l.id} action={l.action} a={l.appointment} />
            ) : (
              <div key={l.id} className={`bubble ${l.kind}`}>
                {l.kind === 'user' ? (
                  <>
                    {l.text}
                    {l.pending && <span className="pending"> {l.pending}</span>}
                  </>
                ) : (
                  l.segs.map((s) => (
                    <span key={s.id}>
                      {s.spoken}
                      {s.rest && (
                        <span className="unsaid">
                          {s.spoken ? ' ' : ''}
                          {s.rest}
                        </span>
                      )}{' '}
                    </span>
                  ))
                )}
              </div>
            ),
          )}
          {status === 'live' && speaking === 'user' && (
            <div className="bubble user typing">
              <i />
              <i />
              <i />
            </div>
          )}
        </div>

        {status === 'ended' || status === 'failed' ? (
          <div className="after">
            {status === 'ended' && <p className="after-sum">{summary(lines)}</p>}
            <div className="after-actions">
              <button className="pill ghost" onClick={onClose}>
                Close
              </button>
              <button className="pill go" onClick={call.start}>
                <Icon name="phone" size={18} /> Call again
              </button>
            </div>
          </div>
        ) : (
          <div className="controls">
            <button
              className="ctl"
              data-on={muted}
              onClick={call.toggleMute}
              disabled={status !== 'live'}
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              <Icon name={muted ? 'mic-off' : 'mic'} />
              <span>{muted ? 'Unmute' : 'Mute'}</span>
            </button>
            <button className="ctl end" onClick={call.hangup} aria-label="End call">
              <Icon name="phone-down" />
              <span>End</span>
            </button>
          </div>
        )}
        <div className="homebar" />
      </div>
    </div>
  )
}

function summary(lines: Line[]) {
  const n = (action: string) => lines.filter((l) => l.kind === 'card' && l.action === action).length
  const parts = [n('booked') && `${n('booked')} booked`, n('cancelled') && `${n('cancelled')} cancelled`].filter(Boolean)
  return parts.length ? `Appointments: ${parts.join(', ')}` : 'No changes made'
}

function Receipt({ action, a }: { action: 'booked' | 'cancelled'; a: Appointment }) {
  return (
    <div className="receipt" data-action={action}>
      <div className="receipt-head">
        <span>{action === 'booked' ? 'Booked' : 'Cancelled'}</span>
        <span>#{String(a.id).padStart(4, '0')}</span>
      </div>
      <div className="receipt-when">
        {fmtDay(a.starts_at)}, {fmtTime(a.starts_at)}
      </div>
      <div className="receipt-line">
        {a.doctor} · {a.room}
      </div>
      <div className="receipt-line muted">
        {a.patient_name} · {fmtPhone(a.phone)}
      </div>
    </div>
  )
}
