import { useEffect, useState } from 'react'
import { ApiError, api, type DiscoverySuggestion, type ServiceInput } from '../lib/api'
import { Modal } from './Modal'
import { AppIcon } from './AppIcon'

// Scans existing containers and proposes quick-launch tiles. Adding a suggestion
// creates a monitored tile (HTTP check against the discovered URL).
export function DiscoverModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean
  onClose: () => void
  onAdded: () => void
}) {
  const [list, setList] = useState<DiscoverySuggestion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setList(null)
    setError(null)
    setAdded(new Set())
    api
      .discoverySuggestions()
      .then((r) => setList(r.suggestions))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Discovery failed.'))
  }, [open])

  async function add(s: DiscoverySuggestion) {
    setBusy(s.container_id)
    setError(null)
    const body: ServiceInput = {
      name: s.name,
      category: s.category || '',
      icon: s.icon_url,
      lan_url: s.url,
      tailscale_url: '',
      check_type: 'http',
      check_target: s.url,
      expected_status: '',
      interval_seconds: 60,
      timeout_seconds: 10,
      degraded_ms: null,
      verify_tls: false,
      enabled: true,
      sort_order: 0,
    }
    try {
      await api.createService(body)
      setAdded((a) => new Set(a).add(s.container_id))
      onAdded()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `Failed to add ${s.name}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} side labelledBy="discover-title">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div>
            <h2 id="discover-title" className="font-semibold text-slate-900 dark:text-slate-100">
              Discover apps
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Web UIs detected on your containers. Adding creates a monitored tile.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
          {!list && !error && <p className="text-sm text-slate-400">Scanning containers (probing for web UIs)…</p>}
          {list && list.length === 0 && <p className="text-sm text-slate-400">No web UIs detected on running containers.</p>}

          <div className="space-y-2">
            {(list ?? []).map((s) => {
              const isAdded = s.already_added || added.has(s.container_id)
              return (
                <div
                  key={s.container_id}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800"
                >
                  <AppIcon icon={s.icon_url} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-slate-900 dark:text-slate-100">{s.name}</span>
                      {s.source === 'label' && (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                          label
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-sky-600 dark:text-sky-400">{s.url}</div>
                    <div className="truncate font-mono text-[11px] text-slate-400">{s.image}</div>
                  </div>
                  {isAdded ? (
                    <span className="shrink-0 text-xs font-medium text-slate-400">✓ Added</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => add(s)}
                      disabled={busy === s.container_id}
                      className="shrink-0 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-60"
                    >
                      {busy === s.container_id ? 'Adding…' : 'Add'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Modal>
  )
}
