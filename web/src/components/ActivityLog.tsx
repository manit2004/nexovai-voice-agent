import type { Activity } from '../types'

const LABEL: Record<string, string> = {
  check_doctor_availability: 'availability',
  book_appointment: 'book',
  cancel_appointment: 'cancel',
}

/** Every tool call the agent makes, as it happens: what it asked for and what came back. */
export function ActivityLog({ items }: { items: Activity[] }) {
  return (
    <section className="panel activity">
      <div className="panel-head">
        <h2>Agent log</h2>
        <span className="muted mono">{items.length} calls</span>
      </div>
      {items.length === 0 ? (
        <div className="empty">Tool calls appear here live during a call.</div>
      ) : (
        <ol className="log">
          {items.map((a) => (
            <li key={a.id} data-status={a.status}>
              <time className="mono">{a.at.toLocaleTimeString('en-IN', { hour12: false })}</time>
              <div>
                <div className="log-fn mono">
                  <span className="fn">{LABEL[a.name] ?? a.name}</span>
                  <span className="args">({fmtArgs(a.args)})</span>
                </div>
                {a.summary && <div className="log-res">{a.summary}</div>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function fmtArgs(args: Record<string, unknown>) {
  return Object.entries(args)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? `"${v}"` : String(v)}`)
    .join(', ')
}
