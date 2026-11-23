import { useEffect, useRef, useState } from 'react'
import type { CallApi } from '../useCall'
import type { Appointment } from '../types'
import { fmtClock, fmtPhone, fmtTime, fmtDay } from '../format'
import { Waveform } from './Waveform'
import { Icon } from './Icon'

const STATUS_LABEL = { idle: '', ringing: 'Calling…', live: '', ended: 'Call ended', failed: 'Call failed' }

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
  const cards = lines.filter((l) => l.kind === 'card')
  const clock = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })

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
            <span>L</span>
            <i className="ring r1" />
            <i className="ring r2" />
            <i className="ring r3" />
          </div>
          <div className="callee-name">Larkspur Clinic</div>
          <div className="callee-sub">
            {status === 'live' ? (
              <>
                <span className="live-dot" /> {fmtClock(elapsed)}
              </>
            ) : status === 'ended' ? (
              <>Call ended · {fmtClock(elapsed)}</>
            ) : (
              STATUS_LABEL[status]
            )}
          </div>
        </header>

        {status === 'live' && <Waveform analysers={call.analysers} active={speaking !== null} />}

        <div className="transcript" ref={scroller}>
          {status === 'ringing' && <p className="hint">Front desk assistant · usually answers in a ring or two</p>}
          {status === 'failed' && (
            <p className="hint err">{error ?? 'The line dropped before the clinic picked up.'} Is the voice server running?</p>
          )}
          {lines.map((l) =>
            l.kind === 'card' ? (
              <Ticket key={l.id} action={l.action} a={l.appointment} />
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
                      {s.rest && <span className="unsaid">{s.spoken ? ' ' : ''}{s.rest}</span>}{' '}
                    </span>
                  ))
                )}
              </div>
            ),
          )}
          {status === 'live' && speaking === 'user' && <div className="bubble user typing"><i /><i /><i /></div>}
        </div>

        {status === 'ended' || status === 'failed' ? (
          <div className="after">
            {status === 'ended' && cards.length > 0 && (
              <p className="after-sum">
                {cards.length} change{cards.length > 1 ? 's' : ''} made on this call
              </p>
            )}
            <div className="after-actions">
              <button className="pill ghost" onClick={onClose}>
                Close
              </button>
              <button className="pill go" onClick={call.start}>
                <Icon name="phone" /> Call again
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
              <span>{muted ? 'Muted' : 'Mute'}</span>
            </button>
            <button className="ctl end" onClick={call.hangup} aria-label="End call">
              <Icon name="phone-down" />
            </button>
            <button className="ctl" disabled aria-hidden tabIndex={-1}>
              <Icon name="keypad" />
              <span>Keypad</span>
            </button>
          </div>
        )}
        <div className="homebar" />
      </div>
    </div>
  )
}

function Ticket({ action, a }: { action: 'booked' | 'cancelled'; a: Appointment }) {
  return (
    <div className={`ticket ${action}`}>
      <div className="ticket-head">
        <span>{action === 'booked' ? 'Appointment confirmed' : 'Appointment cancelled'}</span>
        <span className="mono">#{String(a.id).padStart(4, '0')}</span>
      </div>
      <div className="ticket-body">
        <div className="ticket-when">
          <b>{fmtTime(a.starts_at)}</b>
          <span>{fmtDay(a.starts_at)}</span>
        </div>
        <div className="ticket-who">
          <b>{a.doctor}</b>
          <span>
            {a.specialty} · {a.room}
          </span>
        </div>
      </div>
      <div className="ticket-foot mono">
        {a.patient_name} · {fmtPhone(a.phone)}
      </div>
    </div>
  )
}
