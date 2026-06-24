import { useEffect, useState } from 'react'
import { ApiError, api, type CatalogApp, type CatalogStatus, type HubSearchResult } from '../lib/api'
import { formatUptime } from '../lib/format'
import { AppIcon } from '../components/AppIcon'
import { TemplateDetailDrawer } from '../components/TemplateDetailDrawer'
import { HubImageDrawer } from '../components/HubImageDrawer'
import { InstalledApps } from '../components/InstalledApps'
import { AptStore } from '../components/AptStore'

type Source = 'catalog' | 'hub' | 'apt'

const SOURCE_LABELS: Record<Source, string> = {
  catalog: 'Catalog',
  hub: 'Docker Hub',
  apt: 'APT (system)',
}

export function Store() {
  const [source, setSource] = useState<Source>('catalog')
  const [status, setStatus] = useState<CatalogStatus | null>(null)
  const [cats, setCats] = useState<{ name: string; count: number }[]>([])
  const [items, setItems] = useState<CatalogApp[] | null>(null)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<CatalogApp | null>(null)
  const [appsRefresh, setAppsRefresh] = useState(0)
  // Docker Hub search.
  const [hubResults, setHubResults] = useState<HubSearchResult[] | null>(null)
  const [hubLoading, setHubLoading] = useState(false)
  const [hubRepo, setHubRepo] = useState<string | null>(null)

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

  // Docker Hub live search (only while that source is active).
  useEffect(() => {
    if (source !== 'hub') return
    const q = search.trim()
    if (!q) {
      setHubResults(null)
      return
    }
    let active = true
    setHubLoading(true)
    const handle = setTimeout(() => {
      api
        .hubSearch(q)
        .then((r) => active && setHubResults(r.results))
        .catch((e) => active && setError(e instanceof ApiError ? e.message : 'Docker Hub search failed'))
        .finally(() => active && setHubLoading(false))
    }, 350)
    return () => {
      active = false
      clearTimeout(handle)
    }
  }, [source, search])

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
  const onDeployed = () => setAppsRefresh((n) => n + 1)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">App store</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {source === 'catalog' ? (
              <>
                {status ? `${status.total} templates` : 'Loading…'}
                {status?.last_synced && ` · synced ${formatUptime(status.last_synced)} ago`}
              </>
            ) : source === 'hub' ? (
              'Search any image on Docker Hub'
            ) : (
              'Browse & manage system (APT) packages'
            )}
          </p>
        </div>
        {source === 'catalog' && (
          <button
            type="button"
            onClick={sync}
            disabled={syncing}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-60"
          >
            {syncing ? 'Syncing…' : 'Sync catalog'}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      <InstalledApps refreshSignal={appsRefresh} />

      {/* Source toggle */}
      <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm dark:border-slate-800">
        {(['catalog', 'hub', 'apt'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSource(s)}
            className={
              'rounded-md px-3 py-1 font-medium ' +
              (source === s
                ? 'bg-sky-600 text-white'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800')
            }
          >
            {SOURCE_LABELS[s]}
          </button>
        ))}
      </div>

      {source === 'apt' && <AptStore />}

      {source !== 'apt' && (
      <>
      <div className="flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={source === 'catalog' ? 'Search apps…' : 'Search Docker Hub… (e.g. filebrowser)'}
          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        {source === 'catalog' && (
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
        )}
      </div>

      {source === 'catalog' ? (
        empty ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
            <p className="text-slate-500 dark:text-slate-400">The catalog is empty.</p>
            <button type="button" onClick={sync} disabled={syncing} className="mt-2 text-sm font-medium text-sky-600 hover:underline dark:text-sky-400">
              {syncing ? 'Syncing…' : 'Sync now →'}
            </button>
          </div>
        ) : !items ? (
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
        )
      ) : !search.trim() ? (
        <p className="text-slate-400">Type to search Docker Hub.</p>
      ) : hubLoading && !hubResults ? (
        <p className="text-slate-400">Searching…</p>
      ) : hubResults && hubResults.length === 0 ? (
        <p className="text-slate-400">No images match.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(hubResults ?? []).map((r) => (
            <button
              key={r.repo}
              type="button"
              onClick={() => setHubRepo(r.repo)}
              className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-sky-400 hover:shadow dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-600"
            >
              <AppIcon icon={r.icon} size={40} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-sm font-medium text-slate-900 dark:text-slate-100">{r.repo}</span>
                  {r.is_official && (
                    <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
                      official
                    </span>
                  )}
                </div>
                <p className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{r.description}</p>
                <p className="mt-1 text-[10px] text-slate-400">★ {r.stars.toLocaleString()}</p>
              </div>
            </button>
          ))}
        </div>
      )}
      </>
      )}

      <TemplateDetailDrawer
        app={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
        onDeployed={onDeployed}
      />
      <HubImageDrawer
        repo={hubRepo}
        open={!!hubRepo}
        onClose={() => setHubRepo(null)}
        onDeployed={onDeployed}
      />
    </div>
  )
}
