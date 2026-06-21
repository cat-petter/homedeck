import { useEffect, useState } from 'react'
import { ApiError, api, type ServiceData, type ServiceHistory } from '../lib/api'
import { useHealthStatus } from '../lib/useHealthStatus'
import { formatUptime } from '../lib/format'
import { STATUS_LABEL, StatusDot } from '../components/StatusDot'
import { ServiceForm } from '../components/ServiceForm'
import { ConfirmDialog, type ConfirmOptions } from '../components/ConfirmDialog'
import { LineChart, type Series } from '../components/LineChart'

export function Health() {
  const { services, connected, refresh } = useHealthStatus()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ServiceData | null>(null)
  const [confirm, setConfirm] = useState<{ options: ConfirmOptions; run: () => Promise<void> } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)

  const openAdd = () => {
    setEditing(null)
    setFormOpen(true)
  }
  const openEdit = (s: ServiceData) => {
    setEditing(s)
    setFormOpen(true)
  }

  const askDelete = (s: ServiceData) =>
    setConfirm({
      options: {
        title: `Delete ${s.name}?`,
        message: 'This removes the service and its check history. This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      },
      run: async () => {
        setActionError(null)
        try {
          await api.deleteService(s.id)
          refresh()
        } catch (e) {
          setActionError(e instanceof ApiError ? e.message : 'Delete failed')
        }
      },
    })

  const checkNow = async (s: ServiceData) => {
    setActionError(null)
    try {
      await api.checkService(s.id)
      refresh()
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Check failed')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Health</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Service uptime monitoring ·{' '}
            <span className={connected ? 'text-emerald-500' : 'text-amber-500'}>
              {connected ? 'live' : 'connecting…'}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
        >
          + Add service
        </button>
      </div>

      {actionError && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {actionError}
        </div>
      )}

      {!services ? (
        <p className="text-slate-500 dark:text-slate-400">Loading…</p>
      ) : services.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
          <p className="text-slate-500 dark:text-slate-400">No services yet.</p>
          <button type="button" onClick={openAdd} className="mt-2 text-sm font-medium text-sky-600 hover:underline dark:text-sky-400">
            Add your first service →
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {services.map((s) => (
            <ServiceRow
              key={s.id}
              s={s}
              expanded={expanded === s.id}
              onToggle={() => setExpanded((e) => (e === s.id ? null : s.id))}
              onEdit={() => openEdit(s)}
              onDelete={() => askDelete(s)}
              onCheck={() => checkNow(s)}
            />
          ))}
        </div>
      )}

      <ServiceForm open={formOpen} existing={editing} onClose={() => setFormOpen(false)} onSaved={refresh} />
      <ConfirmDialog
        open={!!confirm}
        options={confirm?.options ?? null}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const run = confirm?.run
          setConfirm(null)
          if (run) await run()
        }}
      />
    </div>
  )
}

function ServiceRow({
  s,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onCheck,
}: {
  s: ServiceData
  expanded: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  onCheck: () => void
}) {
  const url = s.lan_url || s.tailscale_url
  return (
    <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <StatusDot status={s.last_status} pulse />
          <span className="text-lg">{s.icon || '🔗'}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-slate-900 dark:text-slate-100">{s.name}</span>
              {s.category && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  {s.category}
                </span>
              )}
              {!s.enabled && <span className="text-xs text-slate-400">(disabled)</span>}
            </div>
            <div className="truncate text-xs text-slate-500 dark:text-slate-400">
              {s.check_type === 'none' ? 'No monitoring' : `${s.check_type.toUpperCase()} · ${s.check_target || url || '—'}`}
              {s.last_error && <span className="ml-1 text-red-500">· {s.last_error}</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-5 text-sm">
          <Metric label="Status" value={STATUS_LABEL[s.last_status]} />
          <Metric label="Uptime 24h" value={s.uptime_24h == null ? '—' : `${s.uptime_24h.toFixed(1)}%`} />
          <Metric
            label="Latency"
            value={s.last_response_ms == null ? '—' : `${Math.round(s.last_response_ms)} ms`}
          />
          <Metric label="Checked" value={s.last_checked_at ? `${formatUptime(s.last_checked_at)} ago` : '—'} />
        </div>

        <div className="flex items-center gap-1">
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="rounded-md px-2 py-1 text-xs font-medium text-sky-600 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-950/40"
            >
              Open ↗
            </a>
          )}
          {s.check_type !== 'none' && (
            <>
              <button type="button" onClick={onCheck} className="rounded-md px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                Check
              </button>
              <button type="button" onClick={onToggle} className="rounded-md px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                {expanded ? 'Hide' : 'History'}
              </button>
            </>
          )}
          <button type="button" onClick={onEdit} className="rounded-md px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
            Edit
          </button>
          <button type="button" onClick={onDelete} className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40">
            Delete
          </button>
        </div>
      </div>

      {expanded && s.check_type !== 'none' && <HistoryPanel serviceId={s.id} />}
    </div>
  )
}

function HistoryPanel({ serviceId }: { serviceId: number }) {
  const [data, setData] = useState<ServiceHistory | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const load = () =>
      api
        .serviceHistory(serviceId, 24)
        .then((d) => active && setData(d))
        .catch((e) => active && setError(e instanceof ApiError ? e.message : 'Failed to load history'))
    load()
    const id = setInterval(load, 15000)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [serviceId])

  const series: Series[] = [
    {
      label: 'Latency (ms)',
      color: '#0ea5e9',
      points: (data?.samples ?? [])
        .filter((s) => s.response_ms != null)
        .map((s) => ({ t: new Date(s.ts).getTime(), v: s.response_ms as number })),
    },
  ]

  return (
    <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-800">
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!data && !error && <p className="text-sm text-slate-400">Loading history…</p>}
      {data && (
        <>
          <div className="mb-2 flex gap-6 text-xs text-slate-500 dark:text-slate-400">
            <span>
              Uptime 24h:{' '}
              <span className="font-medium text-slate-700 dark:text-slate-200">
                {data.uptime_pct == null ? '—' : `${data.uptime_pct.toFixed(2)}%`}
              </span>
            </span>
            <span>
              Checks: <span className="font-medium text-slate-700 dark:text-slate-200">{data.checks}</span>
            </span>
          </div>
          <LineChart series={series} yFormat={(v) => `${Math.round(v)}`} height={120} />
        </>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="hidden text-right sm:block">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="tabular-nums text-slate-700 dark:text-slate-200">{value}</div>
    </div>
  )
}
