import { useEffect, useState } from 'react'
import { ApiError, api, type AptPackage, type AptStatus } from '../lib/api'
import { AptPackageDrawer } from './AptPackageDrawer'
import { AptRunModal } from './AptRunModal'
import { InstallPasswordModal } from './InstallPasswordModal'
import { SkeletonGrid } from './Skeleton'

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
  const [pwSet, setPwSet] = useState<boolean | null>(null)
  const [pwModal, setPwModal] = useState<'create' | 'change' | null>(null)
  const [upgradeAll, setUpgradeAll] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const reload = () => setRefreshKey((n) => n + 1)
  const refreshAll = () => {
    api.aptStatus().then(setStatus).catch(() => {})
    reload()
  }

  useEffect(() => {
    api.aptStatus().then(setStatus).catch(() => {})
  }, [])

  const loadPwStatus = () => api.installPasswordStatus().then((r) => setPwSet(r.set)).catch(() => {})
  useEffect(() => {
    loadPwStatus()
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
  }, [search, filter, refreshKey])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {status
            ? `${status.installed.toLocaleString()} installed · ${status.upgradable} upgradable · ${status.total.toLocaleString()} available`
            : 'Loading APT…'}
        </p>
        {status && status.upgradable > 0 && (
          <button
            type="button"
            onClick={() => (pwSet === false ? setPwModal('create') : setUpgradeAll(true))}
            className="shrink-0 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
          >
            Upgrade all ({status.upgradable})
          </button>
        )}
      </div>

      {pwSet === false ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
          <span>Set an install password to enable installing, removing &amp; upgrading packages.</span>
          <button
            type="button"
            onClick={() => setPwModal('create')}
            className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500"
          >
            Set password
          </button>
        </div>
      ) : pwSet === true ? (
        <button
          type="button"
          onClick={() => setPwModal('change')}
          className="text-xs font-medium text-slate-500 hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-400"
        >
          Change install password
        </button>
      ) : null}

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
        <SkeletonGrid />
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

      <AptPackageDrawer
        name={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
        passwordSet={pwSet}
        onNeedPassword={() => setPwModal('create')}
        onChanged={() => {
          api.aptStatus().then(setStatus).catch(() => {})
          reload()
        }}
      />
      <InstallPasswordModal
        open={pwModal !== null}
        mode={pwModal ?? 'create'}
        onClose={() => setPwModal(null)}
        onDone={loadPwStatus}
      />
      <AptRunModal
        open={upgradeAll}
        verb="upgrade-all"
        pkg=""
        onClose={() => setUpgradeAll(false)}
        onDone={refreshAll}
      />
    </div>
  )
}
