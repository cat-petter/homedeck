import { useEffect, useState } from 'react'
import { ApiError, api, type AptPackage, type AptStatus } from '../lib/api'
import { AptPackageDrawer } from './AptPackageDrawer'

type Filter = 'installed' | 'upgradable' | 'all'

// APT app store (browse half): defaults to installed packages for management,
// with search across the whole app-like package universe.
export function AptStore() {
  const [status, setStatus] = useState<AptStatus | null>(null)
  const [filter, setFilter] = useState<Filter>('installed')
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<AptPackage[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    api.aptStatus().then(setStatus).catch(() => {})
  }, [])

  useEffect(() => {
    let active = true
    setItems(null)
    const handle = setTimeout(() => {
      api
        .aptPackages({
          search,
          installed: filter === 'installed',
          upgradable: filter === 'upgradable',
          limit: 90,
        })
        .then((r) => {
          if (!active) return
          setItems(r.items)
          setTotal(r.total)
        })
        .catch((e) => active && setError(e instanceof ApiError ? e.message : 'Failed to load packages'))
    }, 250)
    return () => {
      active = false
      clearTimeout(handle)
    }
  }, [search, filter])

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {status
          ? `${status.installed.toLocaleString()} installed · ${status.upgradable} upgradable · ${status.total.toLocaleString()} available`
          : 'Loading APT…'}
      </p>

      <div className="flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search APT packages… (e.g. htop, web server)"
          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm dark:border-slate-800">
          {(['installed', 'upgradable', 'all'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={
                'rounded-md px-3 py-1 font-medium capitalize ' +
                (filter === f
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800')
              }
            >
              {f}
              {f === 'upgradable' && status?.upgradable ? ` (${status.upgradable})` : ''}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {!items ? (
        <p className="text-slate-400">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-slate-400">
          {filter === 'installed' && !search ? 'No app-like installed packages.' : 'No packages match.'}
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-400">
            {total.toLocaleString()} result{total === 1 ? '' : 's'}
            {total > items.length && ` · showing ${items.length}`}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => setSelected(p.name)}
                className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-sky-400 hover:shadow dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-600"
              >
                <span className="text-2xl">📦</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-sm font-medium text-slate-900 dark:text-slate-100">{p.name}</span>
                    {p.installed && (
                      <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                        installed
                      </span>
                    )}
                    {p.upgradable && (
                      <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                        upgrade
                      </span>
                    )}
                  </div>
                  <p className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{p.summary}</p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      <AptPackageDrawer name={selected} open={!!selected} onClose={() => setSelected(null)} />
    </div>
  )
}
