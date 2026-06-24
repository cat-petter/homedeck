import { useEffect, useState } from 'react'
import { ApiError, api, type CatalogSource, type SyncSummary } from '../lib/api'
import { InstallPasswordModal } from '../components/InstallPasswordModal'

export function Settings() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      <CatalogSourcesCard />
      <ImageRenamesCard />
      <InstallPasswordCard />
    </div>
  )
}

// --- Image renames ----------------------------------------------------------

function ImageRenamesCard() {
  const [builtin, setBuiltin] = useState<Record<string, string>>({})
  const [user, setUser] = useState<[string, string][]>([])
  const [oldRepo, setOldRepo] = useState('')
  const [newRepo, setNewRepo] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api
      .imageRenames()
      .then((r) => {
        setBuiltin(r.builtin)
        setUser(Object.entries(r.user))
      })
      .catch(() => {})
  }, [])

  function add() {
    const o = oldRepo.trim().toLowerCase()
    const n = newRepo.trim()
    if (!o || !n) return
    setUser((u) => [...u.filter(([k]) => k !== o), [o, n]])
    setOldRepo('')
    setNewRepo('')
    setSaved(false)
  }

  async function save() {
    setBusy(true)
    try {
      await api.saveImageRenames(Object.fromEntries(user))
      setSaved(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title="Image remaps"
      desc="When a catalog image is gone from Docker Hub, HomeDeck substitutes a replacement (with a disclaimer). Add your own old → new remaps here."
    >
      <div className="space-y-3">
        {user.length > 0 && (
          <div className="space-y-1">
            {user.map(([o, n], i) => (
              <div key={o} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate font-mono text-slate-700 dark:text-slate-200">{o}</span>
                <span className="text-slate-400">→</span>
                <span className="flex-1 truncate font-mono text-slate-700 dark:text-slate-200">{n}</span>
                <button
                  type="button"
                  onClick={() => {
                    setUser((u) => u.filter((_, j) => j !== i))
                    setSaved(false)
                  }}
                  className="rounded px-1.5 text-xs text-slate-400 hover:text-red-500"
                  aria-label="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input value={oldRepo} onChange={(e) => setOldRepo(e.target.value)} placeholder="old/image" className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
          <span className="self-center text-slate-400">→</span>
          <input value={newRepo} onChange={(e) => setNewRepo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="new/image" className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
          <button type="button" onClick={add} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
            Add
          </button>
        </div>

        <div className="flex items-center justify-between">
          {Object.keys(builtin).length > 0 ? (
            <span className="text-xs text-slate-400">+ {Object.keys(builtin).length} built-in remap(s)</span>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
            <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-60">
              {busy ? 'Saving…' : 'Save remaps'}
            </button>
          </div>
        </div>
      </div>
    </Card>
  )
}

// --- Catalog sources --------------------------------------------------------

function sourceLabel(s: CatalogSource): string {
  if (s.kind === 'casaos') return 'CasaOS AppStore'
  // github.com/<owner>/<repo>/… → owner/repo
  const m = s.url.match(/github(?:usercontent)?\.com\/([^/]+)\/([^/]+)/i)
  return m ? `${m[1]}/${m[2]}` : s.url
}

function CatalogSourcesCard() {
  const [sources, setSources] = useState<CatalogSource[] | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newUrl, setNewUrl] = useState('')
  const [sync, setSync] = useState<SyncSummary | null>(null)

  useEffect(() => {
    api.catalogSources().then((r) => setSources(r.sources)).catch(() => setError('Failed to load sources'))
  }, [])

  function update(next: CatalogSource[]) {
    setSources(next)
    setDirty(true)
    setSync(null)
  }
  const toggle = (i: number) => update(sources!.map((s, j) => (j === i ? { ...s, enabled: !s.enabled } : s)))
  const remove = (i: number) => update(sources!.filter((_, j) => j !== i))
  function add() {
    const url = newUrl.trim()
    if (!/^https?:\/\//i.test(url)) {
      setError('Enter an http(s) template URL.')
      return
    }
    if (sources!.some((s) => s.kind === 'portainer' && s.url === url)) {
      setError('That source is already in the list.')
      return
    }
    setError(null)
    update([...sources!, { kind: 'portainer', url, enabled: true }])
    setNewUrl('')
  }

  async function save(thenSync: boolean) {
    if (!sources) return
    setBusy(true)
    setError(null)
    setSync(null)
    try {
      const r = await api.saveCatalogSources(sources)
      setSources(r.sources)
      setDirty(false)
      if (thenSync) setSync(await api.catalogSync())
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title="App store sources"
      desc="Where the Docker app store gets its catalog. Toggle, add, or remove sources — overlapping apps are merged automatically."
    >
      {!sources ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="space-y-2">
          {sources.map((s, i) => (
            <div key={`${s.kind}:${s.url}`} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
              <label className="relative inline-flex cursor-pointer items-center">
                <input type="checkbox" checked={s.enabled} onChange={() => toggle(i)} className="peer sr-only" />
                <div className="h-5 w-9 rounded-full bg-slate-300 peer-checked:bg-sky-600 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-4 dark:bg-slate-700" />
              </label>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{sourceLabel(s)}</span>
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {s.kind}
                  </span>
                </div>
                <div className="truncate font-mono text-[11px] text-slate-400">{s.url}</div>
              </div>
              {s.kind !== 'casaos' && (
                <button type="button" onClick={() => remove(i)} className="shrink-0 rounded px-1.5 text-xs text-slate-400 hover:text-red-500" aria-label="Remove">
                  ✕
                </button>
              )}
            </div>
          ))}

          <div className="flex gap-2 pt-1">
            <input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="Add a Portainer-format template URL…"
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <button type="button" onClick={add} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
              Add
            </button>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          {sync && (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
              Synced: {sync.total} apps · {sync.imported} new · {sync.updated} updated
              {sync.errors.length > 0 && <span className="text-red-500"> · {sync.errors.length} source error(s)</span>}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => save(false)}
              disabled={busy || !dirty}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => save(true)}
              disabled={busy}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-60"
            >
              {busy ? 'Working…' : 'Save & re-sync'}
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}

// --- Install password -------------------------------------------------------

function InstallPasswordCard() {
  const [set, setSet] = useState<boolean | null>(null)
  const [modal, setModal] = useState(false)
  const load = () => api.installPasswordStatus().then((r) => setSet(r.set)).catch(() => {})
  useEffect(() => {
    load()
  }, [])

  return (
    <Card
      title="Install password"
      desc="A separate password required before installing, removing, or upgrading system (APT) packages."
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-slate-600 dark:text-slate-300">
          {set === null ? 'Loading…' : set ? '✓ An install password is set.' : 'No install password set yet.'}
        </span>
        <button type="button" onClick={() => setModal(true)} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500">
          {set ? 'Change' : 'Set password'}
        </button>
      </div>
      <InstallPasswordModal open={modal} mode={set ? 'change' : 'create'} onClose={() => setModal(false)} onDone={load} />
    </Card>
  )
}

// --- shared -----------------------------------------------------------------

function Card({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      <p className="mb-4 mt-0.5 text-sm text-slate-500 dark:text-slate-400">{desc}</p>
      {children}
    </section>
  )
}
