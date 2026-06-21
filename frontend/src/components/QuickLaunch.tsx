import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { ServiceData } from '../lib/api'
import { useHealthStatus } from '../lib/useHealthStatus'
import { StatusDot } from './StatusDot'
import { ServiceForm } from './ServiceForm'

export function QuickLaunch() {
  const { services, refresh } = useHealthStatus()
  const [formOpen, setFormOpen] = useState(false)

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Quick launch
        </h2>
        <div className="flex items-center gap-3 text-xs">
          <Link to="/health" className="font-medium text-slate-500 hover:underline dark:text-slate-400">
            Manage
          </Link>
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="font-medium text-sky-600 hover:underline dark:text-sky-400"
          >
            + Add tile
          </button>
        </div>
      </div>

      {services && services.length === 0 ? (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="w-full rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-900"
        >
          No tiles yet — add a service to launch it from here.
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {(services ?? []).map((s) => (
            <Tile key={s.id} s={s} />
          ))}
        </div>
      )}

      <ServiceForm open={formOpen} existing={null} onClose={() => setFormOpen(false)} onSaved={refresh} />
    </section>
  )
}

function Tile({ s }: { s: ServiceData }) {
  const both = !!(s.lan_url && s.tailscale_url)
  // Whole-card link only when there's a single URL — avoids nesting the LAN/TS
  // chip anchors inside a card-level anchor (invalid HTML) when both exist.
  const singleUrl = both ? null : s.lan_url || s.tailscale_url

  const header = (
    <>
      <div className="flex items-start justify-between">
        <span className="text-2xl">{s.icon || '🔗'}</span>
        <StatusDot status={s.last_status} pulse />
      </div>
      <div className="mt-2 min-w-0">
        <div className="truncate font-medium text-slate-900 dark:text-slate-100">{s.name}</div>
        {s.category && <div className="truncate text-xs text-slate-500 dark:text-slate-400">{s.category}</div>}
      </div>
    </>
  )

  const cls =
    'flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-sky-400 hover:shadow dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-600'

  if (singleUrl) {
    return (
      <a href={singleUrl} target="_blank" rel="noreferrer" className={cls}>
        {header}
      </a>
    )
  }

  return (
    <div className={cls}>
      {header}
      {both && (
        <div className="mt-2 flex gap-2 text-[10px] font-medium">
          <a href={s.lan_url} target="_blank" rel="noreferrer" className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">
            LAN
          </a>
          <a href={s.tailscale_url} target="_blank" rel="noreferrer" className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">
            TS
          </a>
        </div>
      )}
    </div>
  )
}
