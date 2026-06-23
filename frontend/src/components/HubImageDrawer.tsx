import { useEffect, useState } from 'react'
import { ApiError, api, type HubInspect } from '../lib/api'
import { formatUptime } from '../lib/format'
import { Modal } from './Modal'
import { AppIcon } from './AppIcon'
import { InstallConfigForm, blankInstallConfig } from './InstallConfigForm'

// Docker Hub image detail: README, stats, tag selector, then "Configure &
// install" feeds a seeded config into the same install form.
export function HubImageDrawer({
  repo,
  open,
  onClose,
  onDeployed,
}: {
  repo: string | null
  open: boolean
  onClose: () => void
  onDeployed?: () => void
}) {
  const [info, setInfo] = useState<HubInspect | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tag, setTag] = useState('latest')
  const [configuring, setConfiguring] = useState(false)

  useEffect(() => {
    if (!open || !repo) return
    setInfo(null)
    setError(null)
    setTag('latest')
    api
      .hubInspect(repo)
      .then((i) => {
        setInfo(i)
        // Prefer "latest" if present, else the most recently pushed tag.
        const names = i.tags.map((t) => t.name)
        setTag(names.includes('latest') ? 'latest' : names[0] || 'latest')
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load image'))
  }, [open, repo])

  const seed = info
    ? blankInstallConfig({
        title: info.suggested.title,
        image: info.repo,
        tag,
        icon: info.suggested.icon,
        webPort: info.suggested.web_port,
      })
    : null

  return (
    <Modal open={open} onClose={onClose} side labelledBy="hub-title">
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-3">
            <AppIcon icon={info?.suggested.icon ?? ''} size={36} />
            <div className="min-w-0">
              <h2 id="hub-title" className="truncate font-semibold text-slate-900 dark:text-slate-100">
                {info?.suggested.title ?? repo ?? 'Loading…'}
              </h2>
              <div className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">{repo}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 text-sm">
          {error && <p className="text-red-500">{error}</p>}
          {!info && !error && <p className="text-slate-400">Loading…</p>}
          {info && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                {info.is_official && (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
                    official
                  </span>
                )}
                <span>★ {info.stars.toLocaleString()}</span>
                {info.pulls != null && <span>{info.pulls.toLocaleString()} pulls</span>}
                {info.last_updated && <span>updated {formatUptime(info.last_updated)} ago</span>}
              </div>

              {info.description && <p className="text-slate-600 dark:text-slate-300">{info.description}</p>}

              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Tag ({info.tags.length})
                </span>
                <select
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {!info.tags.some((t) => t.name === tag) && <option value={tag}>{tag}</option>}
                  {info.tags.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                      {t.architectures.length ? ` — ${t.architectures.join(', ')}` : ''}
                    </option>
                  ))}
                </select>
              </label>

              {info.readme && (
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    README
                  </h3>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-3 text-xs leading-relaxed text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                    {info.readme}
                    {info.readme_truncated ? '\n\n… (truncated)' : ''}
                  </pre>
                </div>
              )}

              <div className="text-xs text-slate-400">
                Source: Docker Hub ·{' '}
                <a
                  href={`https://hub.docker.com/r/${info.repo}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-600 hover:underline dark:text-sky-400"
                >
                  view on Docker Hub
                </a>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 p-4 dark:border-slate-800">
          <button
            type="button"
            disabled={!info}
            onClick={() => setConfiguring(true)}
            className="w-full rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-slate-700 dark:disabled:text-slate-300"
          >
            Configure &amp; install
          </button>
        </div>
      </div>

      <InstallConfigForm
        template={null}
        seed={seed}
        open={configuring}
        onClose={() => setConfiguring(false)}
        onDeployed={() => {
          setConfiguring(false)
          onClose()
          onDeployed?.()
        }}
      />
    </Modal>
  )
}
