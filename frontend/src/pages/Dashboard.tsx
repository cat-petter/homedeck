import { useEffect, useState } from 'react'
import { ApiError, api, type SystemInfo } from '../lib/api'
import { QuickLaunch } from '../components/QuickLaunch'

// Build a LAN URL using the current origin's protocol/port (the UI is served by
// the backend on the same port), swapping in the detected LAN IP as the host.
function lanUrl(lanIp: string): string {
  const port = window.location.port ? `:${window.location.port}` : ''
  return `${window.location.protocol}//${lanIp}${port}`
}

export function Dashboard() {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .systemInfo()
      .then(setInfo)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load system info.'),
      )
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Homelab control center.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card title="Host">
          <Row label="Hostname" value={info?.hostname} />
          <Row label="Platform" value={info?.platform} />
          <Row label="Python" value={info?.python_version} />
          <Row label="HomeDeck" value={info ? `v${info.app_version}` : undefined} />
        </Card>

        <Card title="LAN access">
          <Row label="LAN IP" value={info?.connectivity.lan_ip ?? '—'} mono />
          {info?.connectivity.lan_ip && (
            <a
              className="mt-1 inline-block text-sm text-sky-600 hover:underline dark:text-sky-400"
              href={lanUrl(info.connectivity.lan_ip)}
            >
              {lanUrl(info.connectivity.lan_ip)}
            </a>
          )}
        </Card>

        <Card title="Tailscale access">
          {info && !info.connectivity.tailscale_available ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Tailscale CLI not detected on this host.
            </p>
          ) : (
            <>
              <Row label="Tailscale IP" value={info?.connectivity.tailscale_ip ?? '—'} mono />
              <Row label="MagicDNS" value={info?.connectivity.tailscale_dns ?? '—'} mono />
            </>
          )}
        </Card>
      </section>

      <QuickLaunch />
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </h3>
      {children}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`text-sm text-slate-800 dark:text-slate-200 ${mono ? 'font-mono' : ''}`}>
        {value === undefined ? (
          <span className="inline-block h-3 w-16 animate-pulse rounded bg-slate-200 align-middle dark:bg-slate-800" />
        ) : (
          value
        )}
      </span>
    </div>
  )
}
