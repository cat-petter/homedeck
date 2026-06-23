import { useCallback, useEffect, useState } from 'react'
import { ApiError, api, type InstalledApp, type InstallConfig } from '../lib/api'
import { pickServiceUrl } from '../lib/access'
import { AppIcon } from './AppIcon'
import { InstallConfigForm } from './InstallConfigForm'

// Apps HomeDeck has deployed: start/stop, reconfigure (re-render + recreate),
// open the Web UI, and remove (optionally with data).
export function InstalledApps({ refreshSignal }: { refreshSignal?: number }) {
  const [apps, setApps] = useState<InstalledApp[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [editing, setEditing] = useState<{ id: number; template_id: string; config: InstallConfig } | null>(null)

  const load = useCallback(() => {
    api
      .listApps()
      .then((r) => setApps(r.apps))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load apps'))
  }, [])

  useEffect(load, [load, refreshSignal])

  async function act(id: number, fn: () => Promise<unknown>) {
    setBusy(id)
    setError(null)
    try {
      await fn()
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  async function remove(app: InstalledApp) {
    const deleteData = window.confirm(
      `Remove "${app.title || app.name}"?\n\nClick OK to also delete its named volumes (data is lost), or Cancel to keep them — you'll then be asked to confirm removal.`,
    )
      ? true
      : window.confirm(`Remove "${app.title || app.name}" but keep its data volumes?`)
        ? false
        : null
    if (deleteData === null) return
    await act(app.id, () => api.removeApp(app.id, deleteData))
  }

  async function reconfigure(app: InstalledApp) {
    setBusy(app.id)
    setError(null)
    try {
      const full = await api.getApp(app.id)
      setEditing({ id: app.id, template_id: full.template_id, config: full.config })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load config')
    } finally {
      setBusy(null)
    }
  }

  if (apps !== null && apps.length === 0) return null

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Installed apps {apps && `(${apps.length})`}
      </h2>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(apps ?? []).map((a) => {
          const url = pickServiceUrl(a.web_ui_lan, a.web_ui_tailscale)
          const running = a.status === 'running'
          return (
            <div
              key={a.id}
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
            >
              <AppIcon icon={a.icon} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-slate-900 dark:text-slate-100">{a.title || a.name}</span>
                  <StatusDot status={a.status} />
                </div>
                <div className="truncate font-mono text-xs text-slate-400">{a.image}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg px-2 py-1 text-xs font-medium text-sky-600 hover:bg-slate-100 dark:text-sky-400 dark:hover:bg-slate-800"
                  >
                    Open
                  </a>
                )}
                <button
                  type="button"
                  disabled={busy === a.id}
                  onClick={() => act(a.id, () => (running ? api.stopApp(a.id) : api.startApp(a.id)))}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {running ? 'Stop' : 'Start'}
                </button>
                <button
                  type="button"
                  disabled={busy === a.id}
                  onClick={() => reconfigure(a)}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={busy === a.id}
                  onClick={() => remove(a)}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/40"
                >
                  Remove
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <InstallConfigForm
        template={null}
        editApp={editing}
        open={!!editing}
        onClose={() => setEditing(null)}
        onDeployed={() => {
          setEditing(null)
          load()
        }}
      />
    </section>
  )
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: 'bg-emerald-500',
    stopped: 'bg-slate-400',
    error: 'bg-red-500',
    unknown: 'bg-amber-400',
  }
  return (
    <span className="flex shrink-0 items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
      <span className={`h-2 w-2 rounded-full ${map[status] || 'bg-slate-400'}`} />
      {status}
    </span>
  )
}
