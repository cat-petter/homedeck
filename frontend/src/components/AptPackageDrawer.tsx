import { useCallback, useEffect, useState } from 'react'
import { ApiError, api, type AptPackageDetail } from '../lib/api'
import { formatBytes } from '../lib/format'
import { Modal } from './Modal'
import { AptRunModal, type AptVerb } from './AptRunModal'

// APT package detail + install/remove/upgrade (gated by the install password).
export function AptPackageDrawer({
  name,
  open,
  onClose,
  passwordSet,
  onNeedPassword,
  onChanged,
}: {
  name: string | null
  open: boolean
  onClose: () => void
  passwordSet: boolean | null
  onNeedPassword: () => void
  onChanged?: () => void
}) {
  const [pkg, setPkg] = useState<AptPackageDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [run, setRun] = useState<AptVerb | null>(null)

  const load = useCallback(() => {
    if (!name) return
    setPkg(null)
    setError(null)
    api
      .aptPackage(name)
      .then(setPkg)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load package'))
  }, [name])

  useEffect(() => {
    if (!open || !name) return
    let active = true
    setPkg(null)
    setError(null)
    api
      .aptPackage(name)
      .then((p) => active && setPkg(p))
      .catch((e) => active && setError(e instanceof ApiError ? e.message : 'Failed to load package'))
    return () => {
      active = false
    }
  }, [open, name])

  function act(verb: AptVerb) {
    if (passwordSet === false) {
      onNeedPassword()
      return
    }
    setRun(verb)
  }

  return (
    <Modal open={open} onClose={onClose} side labelledBy="apt-title">
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-2xl">📦</span>
            <div className="min-w-0">
              <h2 id="apt-title" className="truncate font-semibold text-slate-900 dark:text-slate-100">
                {pkg?.name ?? name ?? 'Loading…'}
              </h2>
              <div className="truncate text-xs text-slate-500 dark:text-slate-400">{pkg?.summary}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 text-sm">
          {error && <p className="text-red-500">{error}</p>}
          {!pkg && !error && <p className="text-slate-400">Loading…</p>}
          {pkg && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                {pkg.installed ? (
                  <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">installed</Badge>
                ) : (
                  <Badge className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">not installed</Badge>
                )}
                {pkg.upgradable && (
                  <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">upgrade available</Badge>
                )}
                {pkg.section && <Badge className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{pkg.section}</Badge>}
              </div>

              {pkg.homepage && (
                <a
                  href={pkg.homepage}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-sky-600 hover:bg-slate-50 dark:border-slate-700 dark:text-sky-400 dark:hover:bg-slate-800"
                >
                  🌐 Homepage <span aria-hidden className="text-xs">↗</span>
                </a>
              )}

              {pkg.description && (
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700 dark:text-slate-300">{pkg.description}</pre>
              )}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <KV k="Installed version" v={pkg.installed_version ?? '—'} />
                <KV k="Latest version" v={pkg.candidate_version} />
                <KV k="Install size" v={formatBytes(pkg.installed_size)} />
                <KV k="Download size" v={formatBytes(pkg.download_size)} />
                <KV k="Origin" v={pkg.origin || '—'} />
                <KV k="Priority" v={pkg.priority || '—'} />
              </dl>
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-slate-200 p-4 dark:border-slate-800">
          {passwordSet === false && (
            <p className="text-xs text-amber-600 dark:text-amber-400">Set an install password to manage packages.</p>
          )}
          {pkg && (
            <div className="flex gap-2">
              {pkg.installed ? (
                <>
                  {pkg.upgradable && (
                    <button
                      type="button"
                      onClick={() => act('upgrade')}
                      className="flex-1 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-500"
                    >
                      Upgrade
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => act('remove')}
                    className="flex-1 rounded-lg border border-red-300 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    Remove
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => act('install')}
                  className="flex-1 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-500"
                >
                  Install
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {pkg && (
        <AptRunModal
          open={run !== null}
          verb={run ?? 'install'}
          pkg={pkg.name}
          onClose={() => setRun(null)}
          onDone={() => {
            load()
            onChanged?.()
          }}
        />
      )}
    </Modal>
  )
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
      <dd className="font-mono text-slate-800 dark:text-slate-200">{v}</dd>
    </div>
  )
}
function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{children}</span>
}
