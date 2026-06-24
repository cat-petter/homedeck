// Side drawer showing a container's full `docker inspect` (state, env, mounts,
// networks, ports).
import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { ApiError, api, type ContainerInspect } from '../lib/api'

export function InspectDrawer({
  containerId,
  containerName,
  open,
  onClose,
}: {
  containerId: string
  containerName: string
  open: boolean
  onClose: () => void
}) {
  const [data, setData] = useState<ContainerInspect | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setData(null)
    setError(null)
    api
      .inspectContainer(containerId)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to inspect container.'))
  }, [open, containerId])

  return (
    <Modal open={open} onClose={onClose} side labelledBy="inspect-title">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 id="inspect-title" className="truncate font-semibold text-slate-900 dark:text-slate-100">
            Inspect — {containerName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close inspect"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 text-sm text-slate-700 dark:text-slate-200">
          {error && <p className="text-red-500">{error}</p>}
          {!data && !error && <p className="text-slate-500">Loading…</p>}
          {data && (
            <div className="space-y-6">
              <Section title="General">
                <KV k="Image" v={data.image} mono />
                <KV k="Working dir" v={data.working_dir || '—'} mono />
                <KV k="Command" v={(data.command ?? []).join(' ') || '—'} mono />
                <KV k="Entrypoint" v={(data.entrypoint ?? []).join(' ') || '—'} mono />
                <KV k="Restart policy" v={String(data.restart_policy?.Name ?? '—')} />
              </Section>

              <Section title={`Ports (${data.ports.length})`}>
                {data.ports.length === 0 ? (
                  <Empty />
                ) : (
                  data.ports.map((p, i) => (
                    <div key={i} className="font-mono text-xs">
                      {p.host_port ? `${p.host_ip ?? '0.0.0.0'}:${p.host_port} → ` : ''}
                      {p.container_port}/{p.protocol}
                    </div>
                  ))
                )}
              </Section>

              <Section title={`Networks (${data.networks.length})`}>
                {data.networks.length === 0 ? (
                  <Empty />
                ) : (
                  data.networks.map((n) => (
                    <div key={n.name} className="mb-1">
                      <span className="font-medium">{n.name}</span>
                      <span className="ml-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                        {n.ip_address ?? '—'}
                        {n.mac_address ? ` · ${n.mac_address}` : ''}
                      </span>
                    </div>
                  ))
                )}
              </Section>

              <Section title={`Mounts (${data.mounts.length})`}>
                {data.mounts.length === 0 ? (
                  <Empty />
                ) : (
                  data.mounts.map((m, i) => (
                    <div key={i} className="mb-1 font-mono text-xs">
                      <span className="text-slate-500 dark:text-slate-400">[{m.type}]</span> {m.source ?? m.name}{' '}
                      → {m.destination} <span className="text-slate-400">({m.rw ? 'rw' : 'ro'})</span>
                    </div>
                  ))
                )}
              </Section>

              <Section title={`Environment (${data.env.length})`}>
                {data.env.length === 0 ? (
                  <Empty />
                ) : (
                  data.env.map((e, i) => (
                    <div key={i} className="break-all font-mono text-xs">
                      <span className="text-sky-600 dark:text-sky-400">{e.key}</span>=
                      <span className="text-slate-600 dark:text-slate-300">{e.value}</span>
                    </div>
                  ))
                )}
              </Section>

              <Section title={`Labels (${Object.keys(data.labels).length})`}>
                {Object.keys(data.labels).length === 0 ? (
                  <Empty />
                ) : (
                  Object.entries(data.labels).map(([k, v]) => (
                    <div key={k} className="break-all font-mono text-xs">
                      <span className="text-sky-600 dark:text-sky-400">{k}</span>=
                      <span className="text-slate-600 dark:text-slate-300">{v}</span>
                    </div>
                  ))
                )}
              </Section>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </h3>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex gap-3">
      <span className="w-28 shrink-0 text-slate-500 dark:text-slate-400">{k}</span>
      <span className={`break-all ${mono ? 'font-mono text-xs' : ''}`}>{v}</span>
    </div>
  )
}

function Empty() {
  return <span className="text-slate-400">None</span>
}
