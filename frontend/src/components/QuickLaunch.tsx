import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { ServiceData } from '../lib/api'
import { useHealthStatus } from '../lib/useHealthStatus'
import { getAccessMode, pickServiceUrl } from '../lib/access'
import { StatusDot } from './StatusDot'
import { AppIcon } from './AppIcon'
import { ServiceForm } from './ServiceForm'
import { DiscoverModal } from './DiscoverModal'

export function QuickLaunch() {
  const { services, refresh } = useHealthStatus()
  const [formOpen, setFormOpen] = useState(false)
  const [discoverOpen, setDiscoverOpen] = useState(false)
  const mode = getAccessMode()
  const anyDual = (services ?? []).some((s) => s.lan_url && s.tailscale_url)

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Quick launch
          </h2>
          {anyDual && (
            <span className="text-xs text-slate-400" title="Tiles open the URL matching how you reached this dashboard">
              opens via {mode === 'tailscale' ? 'Tailscale' : 'LAN'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Link to="/health" className="font-medium text-slate-500 hover:underline dark:text-slate-400">
            Manage
          </Link>
          <button
            type="button"
            onClick={() => setDiscoverOpen(true)}
            className="font-medium text-violet-600 hover:underline dark:text-violet-400"
          >
            Discover apps
          </button>
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
            <Tile key={s.id} s={s} mode={mode} />
          ))}
        </div>
      )}

      <ServiceForm open={formOpen} existing={null} onClose={() => setFormOpen(false)} onSaved={refresh} />
      <DiscoverModal open={discoverOpen} onClose={() => setDiscoverOpen(false)} onAdded={refresh} />
    </section>
  )
}

function Tile({ s, mode }: { s: ServiceData; mode: ReturnType<typeof getAccessMode> }) {
  // One click opens the URL matching how the dashboard was reached.
  const url = pickServiceUrl(s.lan_url, s.tailscale_url, mode)

  const header = (
    <>
      <div className="flex items-start justify-between">
        <AppIcon icon={s.icon} size={36} />
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

  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className={cls}>
      {header}
    </a>
  ) : (
    <div className={cls}>{header}</div>
  )
}
