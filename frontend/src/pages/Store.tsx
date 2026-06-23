import { useEffect, useState } from 'react'
import { ApiError, api, type CatalogApp, type CatalogStatus } from '../lib/api'
import { formatUptime } from '../lib/format'
import { AppIcon } from '../components/AppIcon'
import { TemplateDetailDrawer } from '../components/TemplateDetailDrawer'

export function Store() {
  const [status, setStatus] = useState<CatalogStatus | null>(null)
  const [cats, setCats] = useState<{ name: string; count: number }[]>([])
  const [items, setItems] = useState<CatalogApp[] | null>(null)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<CatalogApp | null>(null)

  const loadMeta = () => {
    api.catalogStatus().then(setStatus).catch(() => {})
    api.catalogCategories().then((r) => setCats(r.categories)).catch(() => {})
  }
  useEffect(loadMeta, [])

  // Load templates on filter change (debounced search).
  useEffect(() => {
    let active = true
    const handle = setTimeout(() => {
      api
        .catalogTemplates({ search, category })
        .then((r) => {
          if (!active) return
          setItems(r.items)
          setTotal(r.total)
        })
        .catch((e) => active && setError(e instanceof ApiError ? e.message : 'Failed to load templates'))
    }, 200)
    return () => {
      active = false
      clearTimeout(handle)
    }
  }, [search, category])

  async function sync() {
    setSyncing(true)
    setError(null)
    try {
      const summary = await api.catalogSync()
      if (summary.errors.length) {
        setError(summary.errors.map((e) => `${e.url}: ${e.error}`).join('; '))
      }
      loadMeta()
      const r = await api.catalogTemplates({ search, category })
      setItems(r.items)
      setTotal(r.total)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const empty = status && status.total === 0

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">App store</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {status ? `${status.total} templates` : 'Loading…'}
            {status?.last_synced && ` · synced ${formatUptime(status.last_synced)} ago`}
          </p>
        </div>
        <button
          type="button"
          onClick={sync}
          disabled={syncing}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-60"
        >
          {syncing ? 'Syncing…' : 'Sync catalog'}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {empty ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
          <p className="text-slate-500 dark:text-slate-400">The catalog is empty.</p>
          <button type="button" onClick={sync} disabled={syncing} className="mt-2 text-sm font-medium text-sky-600 hover:underline dark:text-sky-400">
            {syncing ? 'Syncing…' : 'Sync now →'}
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search apps…"
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="">All categories</option>
              {cats.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.count})
                </option>
              ))}
            </select>
          </div>

          {!items ? (
            <p className="text-slate-400">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-slate-400">No apps match.</p>
          ) : (
            <>
              <p className="text-xs text-slate-400">{total} result{total === 1 ? '' : 's'}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((a) => (
                  <button
                    key={a.app_group}
                    type="button"
                    onClick={() => setSelected(a)}
                    className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-sky-400 hover:shadow dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-600"
                  >
                    <AppIcon icon={a.logo} size={40} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-slate-900 dark:text-slate-100">{a.name}</span>
                        {a.variant_count > 1 && (
                          <span className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                            {a.variant_count} variants
                          </span>
                        )}
                        {a.kind === 'stack' && (
                          <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                            stack
                          </span>
                        )}
                      </div>
                      <p className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{a.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <TemplateDetailDrawer app={selected} open={!!selected} onClose={() => setSelected(null)} />
    </div>
  )
}
