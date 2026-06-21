import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ApiError,
  api,
  type DirBreakdown,
  type DockerUsage,
  type FilesystemInfo,
} from '../lib/api'
import { formatBytes, formatPercent } from '../lib/format'
import { Meter } from '../components/Meter'
import { InfoTip } from '../components/InfoTip'

const RECLAIMABLE_HELP =
  'Reclaimable = space you would free by deleting unused Docker objects (what `docker system prune` recovers): ' +
  'images with no container, volumes with no references, stopped containers’ writable layers, and build cache. ' +
  'The “Active” column counts objects currently in use; the rest are unused. Image layers shared with an in-use ' +
  'image are not counted, since they would stay on disk.'

const PARTIAL_HELP =
  'Partial = this size is incomplete. HomeDeck runs unprivileged, so it could not read some files inside this ' +
  'folder (e.g. root-only paths like /var/lib/docker). The real size is at least this — usually more. Docker’s own ' +
  'data is accounted for accurately in the Docker storage section above.'

export function Storage() {
  return (
    <div className="space-y-8">
      <div>
        <Link to="/system" className="text-sm text-sky-600 hover:underline dark:text-sky-400">
          ← Back to System
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Storage</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Where disk space is going — by Docker object, filesystem, and directory.
        </p>
      </div>

      <DockerSection />
      <FilesystemsSection />
      <DirectoriesSection />
    </div>
  )
}

// --- Docker ----------------------------------------------------------------

function DockerSection() {
  const [data, setData] = useState<DockerUsage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .storageDocker()
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load Docker usage'))
  }, [])

  return (
    <Section
      title="Docker storage"
      subtitle={
        data ? (
          <>
            {formatBytes(data.total_size)} used · {formatBytes(data.total_reclaimable)} reclaimable
            <InfoTip text={RECLAIMABLE_HELP} label="What does reclaimable mean?" />
          </>
        ) : undefined
      }
    >
      {error && <Err>{error}</Err>}
      {!data && !error && <Loading />}
      {data && (
        <div className="space-y-6">
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Items</th>
                  <th className="px-4 py-2 font-medium">Active</th>
                  <th className="px-4 py-2 font-medium">Size</th>
                  <th className="px-4 py-2 font-medium">Reclaimable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.categories.map((c) => (
                  <tr key={c.type} className="bg-white dark:bg-slate-950">
                    <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-100">{c.type}</td>
                    <td className="px-4 py-2 tabular-nums text-slate-600 dark:text-slate-300">{c.count}</td>
                    <td className="px-4 py-2 tabular-nums text-slate-600 dark:text-slate-300">{c.active}</td>
                    <td className="px-4 py-2 tabular-nums text-slate-700 dark:text-slate-200">{formatBytes(c.size)}</td>
                    <td className="px-4 py-2 tabular-nums text-slate-500 dark:text-slate-400">
                      {formatBytes(c.reclaimable)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <RankedList
              title="Largest images"
              rows={data.largest_images.map((i) => ({
                key: i.name,
                label: i.name,
                size: i.size,
                note: i.containers > 0 ? `${i.containers} in use` : 'unused',
              }))}
              empty="No images."
            />
            <RankedList
              title="Largest volumes"
              rows={data.largest_volumes.map((v) => ({
                key: v.name,
                label: v.name,
                size: v.size,
                note: v.refcount > 0 ? `${v.refcount} ref` : 'unused',
              }))}
              empty="No volumes with measurable size."
            />
          </div>
        </div>
      )}
    </Section>
  )
}

function RankedList({
  title,
  rows,
  empty,
}: {
  title: string
  rows: { key: string; label: string; size: number; note?: string }[]
  empty: string
}) {
  const max = Math.max(...rows.map((r) => r.size), 1)
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">{empty}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.key}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate font-mono text-xs text-slate-700 dark:text-slate-300" title={r.label}>
                  {r.label}
                </span>
                <span className="shrink-0 tabular-nums text-slate-600 dark:text-slate-300">
                  {formatBytes(r.size)}
                  {r.note && <span className="ml-1 text-xs text-slate-400">· {r.note}</span>}
                </span>
              </div>
              <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div className="h-full rounded-full bg-sky-500" style={{ width: `${(r.size / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Filesystems ------------------------------------------------------------

function FilesystemsSection() {
  const [data, setData] = useState<FilesystemInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .storageFilesystems()
      .then((r) => setData(r.filesystems))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load filesystems'))
  }, [])

  return (
    <Section title="Filesystems">
      {error && <Err>{error}</Err>}
      {!data && !error && <Loading />}
      {data && (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((f) => (
            <div
              key={f.mountpoint}
              className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="mb-1 flex items-baseline justify-between">
                <span className="font-medium text-slate-800 dark:text-slate-100">{f.mountpoint}</span>
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{f.fstype}</span>
              </div>
              <div className="mb-2 font-mono text-xs text-slate-500 dark:text-slate-400">{f.device}</div>
              <Meter
                percent={f.percent}
                label="Disk"
                sublabel={`${formatBytes(f.used)} / ${formatBytes(f.total)} · ${formatPercent(f.percent)}`}
              />
              {f.inodes && (
                <div className="mt-2">
                  <Meter
                    percent={f.inodes.percent}
                    label="Inodes"
                    sublabel={`${f.inodes.used.toLocaleString()} / ${f.inodes.total.toLocaleString()} · ${formatPercent(f.inodes.percent)}`}
                  />
                </div>
              )}
              <div className="mt-2 truncate text-xs text-slate-400" title={f.opts}>
                {f.opts}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

// --- Largest directories (drill-in) -----------------------------------------

function DirectoriesSection() {
  const [path, setPath] = useState('/')
  const [data, setData] = useState<DirBreakdown | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    api
      .storageDirectories(path, 40)
      .then((d) => active && setData(d))
      .catch((e) => active && setError(e instanceof ApiError ? e.message : 'Failed to scan directory'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [path])

  const max = Math.max(...(data?.entries.map((e) => e.size) ?? [1]), 1)

  return (
    <Section
      title="Largest directories"
      subtitle={
        <>
          Scans one filesystem level at a time. Click a folder to drill in. Paths the service can't
          read are flagged <span className="text-amber-500">partial</span>
          <InfoTip text={PARTIAL_HELP} label="What does partial mean?" />.
        </>
      }
    >
      <div className="mb-3 flex items-center gap-2 text-sm">
        <button
          type="button"
          disabled={!data?.parent}
          onClick={() => data?.parent != null && setPath(data.parent)}
          className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium disabled:opacity-40 dark:border-slate-700"
        >
          ↑ Up
        </button>
        <span className="truncate font-mono text-xs text-slate-600 dark:text-slate-300">
          {data?.path ?? path}
        </span>
        {loading && <span className="text-xs text-slate-400">scanning…</span>}
      </div>

      {error && <Err>{error}</Err>}
      {data && (
        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
          {data.entries.length === 0 && !loading ? (
            <p className="px-4 py-3 text-sm text-slate-400">Empty.</p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {data.entries.map((e) => {
                const drillable = e.is_dir && !e.is_mount
                return (
                  <li key={e.name}>
                    <button
                      type="button"
                      disabled={!drillable}
                      onClick={() =>
                        drillable && setPath(`${data.path === '/' ? '' : data.path}/${e.name}`)
                      }
                      className={
                        'flex w-full items-center gap-3 px-4 py-2 text-left text-sm ' +
                        (drillable ? 'hover:bg-slate-50 dark:hover:bg-slate-900' : 'cursor-default')
                      }
                    >
                      <span className="w-5 shrink-0 text-center">
                        {e.is_mount ? '🔌' : e.is_dir ? '📁' : e.is_link ? '🔗' : '📄'}
                      </span>
                      <span className="w-28 shrink-0 tabular-nums text-slate-700 dark:text-slate-200">
                        {formatBytes(e.size)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                          <div
                            className={`h-full rounded-full ${e.is_mount ? 'bg-slate-400' : 'bg-sky-500'}`}
                            style={{ width: `${(e.size / max) * 100}%` }}
                          />
                        </div>
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">
                        {e.name}
                        {e.is_mount && <span className="ml-1 text-slate-400">(mount)</span>}
                        {!e.accessible && (
                          <span className="ml-1 text-amber-500" title={`${e.errors ?? 0} unreadable paths`}>
                            partial
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </Section>
  )
}

// --- Shared bits ------------------------------------------------------------

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}

function Loading() {
  return <p className="text-sm text-slate-400">Loading…</p>
}

function Err({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      {children}
    </div>
  )
}
