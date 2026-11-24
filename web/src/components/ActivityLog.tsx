import type { Activity } from '../types'

const LABEL: Record<string, [running: string, done: string]> = {
  check_doctor_availability: ['Checking availability', 'Checked availability'],
  book_appointment: ['Booking', 'Booking'],
  cancel_appointment: ['Cancelling', 'Cancellation'],
  end_call: ['Hanging up', 'Call ended'],
}

/** Tool calls the agent made during calls: what it asked for and what came back. */
export function ActivityLog({ items }: { items: Activity[] }) {
  return (
    <section className="card activity">
      <div className="card-head">
        <h2>Activity</h2>
      </div>
      {items.length === 0 ? (
        <p className="empty">Tool calls from the agent show up here during a call.</p>
      ) : (
        <ol className="log">
          {items.map((a) => {
            const [running, done] = LABEL[a.name] ?? [a.name, a.name]
            return (
              <li key={a.id} data-status={a.status}>
                <time>{a.at.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}</time>
                <div>
                  <div className="log-title">{a.status === 'running' ? `${running}…` : done}</div>
                  {a.summary && <div className="log-res">{a.summary}</div>}
                  <code className="log-args">
                    {a.name}({fmtArgs(a.args)})
                  </code>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

function fmtArgs(args: Record<string, unknown>) {
  return Object.entries(args)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v}"` : String(v)}`)
    .join(', ')
}
