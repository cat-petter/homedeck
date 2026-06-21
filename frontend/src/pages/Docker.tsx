import { useCallback, useState } from 'react'
import { ApiError, api, type ContainerSummary, type DockerAction } from '../lib/api'
import { formatBytes, formatPercent, formatUptime } from '../lib/format'
import { useDockerStatus } from '../lib/useDockerStatus'
import { ConfirmDialog, type ConfirmOptions } from '../components/ConfirmDialog'
import { LogsDrawer } from '../components/LogsDrawer'
import { InspectDrawer } from '../components/InspectDrawer'

const STATE_STYLES: Record<string, string> = {
  running: 'bg-emerald-500',
  paused: 'bg-amber-500',
  restarting: 'bg-sky-500',
  exited: 'bg-slate-400',
  created: 'bg-slate-400',
  dead: 'bg-red-500',
}

export function Docker() {
  const { containers, stats, wsState, error } = useDockerStatus()
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [actionError, setActionError] = useState<string | null>(null)
  const [logsFor, setLogsFor] = useState<ContainerSummary | null>(null)
  const [inspectFor, setInspectFor] = useState<ContainerSummary | null>(null)
  const [confirm, setConfirm] = useState<{ options: ConfirmOptions; run: () => Promise<void> } | null>(null)

  const setContainerBusy = useCallback((id: string, v: boolean) => {
    setBusy((b) => ({ ...b, [id]: v }))
  }, [])

  const doAction = useCallback(
    async (c: ContainerSummary, action: DockerAction) => {
      setActionError(null)
      setContainerBusy(c.id, true)
      try {
        await api.containerAction(c.id, action)
      } catch (e) {
        setActionError(e instanceof ApiError ? e.message : `Failed to ${action} ${c.name}`)
      } finally {
        setContainerBusy(c.id, false)
      }
    },
    [setContainerBusy],
  )

  const askRemove = useCallback(
    (c: ContainerSummary) => {
      const running = c.state === 'running' || c.state === 'paused' || c.state === 'restarting'
      setConfirm({
        options: {
          title: `Remove ${c.name}?`,
          message: running
            ? `This container is ${c.state}. It will be force-removed and deleted. This cannot be undone.`
            : `This will permanently remove the container "${c.name}". This cannot be undone.`,
          confirmLabel: 'Remove',
          danger: true,
        },
        run: async () => {
          setActionError(null)
          setContainerBusy(c.id, true)
          try {
            await api.removeContainer(c.id, { force: running })
          } catch (e) {
            setActionError(e instanceof ApiError ? e.message : `Failed to remove ${c.name}`)
          } finally {
            setContainerBusy(c.id, false)
          }
        },
      })
    },
    [setContainerBusy],
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Docker</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {containers ? `${containers.length} containers` : 'Loading…'}
            {' · '}
            <span className={wsState === 'open' ? 'text-emerald-500' : 'text-amber-500'}>
              {wsState === 'open' ? 'live' : wsState === 'connecting' ? 'connecting…' : 'reconnecting…'}
            </span>
          </p>
        </div>
      </div>

      {error && <Banner tone="warn">{error}</Banner>}
      {actionError && (
        <Banner tone="error" onClose={() => setActionError(null)}>
          {actionError}
        </Banner>
      )}

      {!containers ? (
        <p className="text-slate-500 dark:text-slate-400">Connecting to Docker…</p>
      ) : containers.length === 0 ? (
        <p className="text-slate-500 dark:text-slate-400">No containers found.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="hidden bg-slate-50 text-xs uppercase tracking-wide text-slate-500 sm:table-header-group dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Container</th>
                <th className="px-4 py-2 font-medium">Ports</th>
                <th className="px-4 py-2 font-medium">CPU</th>
                <th className="px-4 py-2 font-medium">Memory</th>
                <th className="px-4 py-2 font-medium">Uptime</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {containers.map((c) => {
                const st = stats[c.id]
                const isBusy = !!busy[c.id]
                const running = c.state === 'running'
                const paused = c.state === 'paused'
                return (
                  <tr key={c.id} className="bg-white align-top dark:bg-slate-950">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${STATE_STYLES[c.state] ?? 'bg-slate-400'}`}
                          title={c.status_text || c.state}
                        />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-900 dark:text-slate-100">{c.name}</div>
                          <div className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                            {c.image}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <PortList ports={c.ports} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700 dark:text-slate-300">
                      {running ? formatPercent(st?.cpu_pct) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700 dark:text-slate-300">
                      {running ? (
                        <>
                          {formatBytes(st?.mem_used)}
                          {st?.mem_pct != null && (
                            <span className="ml-1 text-xs text-slate-400">({formatPercent(st.mem_pct)})</span>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700 dark:text-slate-300">
                      {running ? formatUptime(c.started_at) : c.state}
                    </td>
                    <td className="px-4 py-3">
                      <div className="ml-auto flex w-24 flex-col items-stretch gap-1">
                        {running ? (
                          <>
                            <ActionBtn onClick={() => doAction(c, 'stop')} busy={isBusy}>Stop</ActionBtn>
                            <ActionBtn onClick={() => doAction(c, 'restart')} busy={isBusy}>Restart</ActionBtn>
                            <ActionBtn onClick={() => doAction(c, 'pause')} busy={isBusy}>Pause</ActionBtn>
                          </>
                        ) : paused ? (
                          <ActionBtn onClick={() => doAction(c, 'unpause')} busy={isBusy}>Unpause</ActionBtn>
                        ) : (
                          <ActionBtn onClick={() => doAction(c, 'start')} busy={isBusy}>Start</ActionBtn>
                        )}
                        <ActionBtn onClick={() => setLogsFor(c)}>Logs</ActionBtn>
                        <ActionBtn onClick={() => setInspectFor(c)}>Inspect</ActionBtn>
                        <ActionBtn onClick={() => askRemove(c)} danger busy={isBusy}>Remove</ActionBtn>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {logsFor && (
        <LogsDrawer
          open={!!logsFor}
          containerId={logsFor.id}
          containerName={logsFor.name}
          onClose={() => setLogsFor(null)}
        />
      )}
      {inspectFor && (
        <InspectDrawer
          open={!!inspectFor}
          containerId={inspectFor.id}
          containerName={inspectFor.name}
          onClose={() => setInspectFor(null)}
        />
      )}
      <ConfirmDialog
        open={!!confirm}
        options={confirm?.options ?? null}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const run = confirm?.run
          setConfirm(null)
          if (run) await run()
        }}
      />
    </div>
  )
}

function PortList({ ports }: { ports: ContainerSummary['ports'] }) {
  const published = ports.filter((p) => p.host_port)
  if (published.length === 0) return <span className="text-slate-400">—</span>
  return (
    <div className="flex flex-col gap-0.5 font-mono text-xs text-slate-600 dark:text-slate-300">
      {published.slice(0, 4).map((p, i) => (
        <span key={i}>
          {p.host_port}→{p.container_port}/{p.protocol}
        </span>
      ))}
      {published.length > 4 && <span className="text-slate-400">+{published.length - 4} more</span>}
    </div>
  )
}

function ActionBtn({
  children,
  onClick,
  busy,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  busy?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={
        'whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium disabled:opacity-50 ' +
        (danger
          ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40'
          : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800')
      }
    >
      {children}
    </button>
  )
}

function Banner({
  children,
  tone,
  onClose,
}: {
  children: React.ReactNode
  tone: 'warn' | 'error'
  onClose?: () => void
}) {
  const styles =
    tone === 'error'
      ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
      : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
  return (
    <div className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${styles}`}>
      <span className="break-all">{children}</span>
      {onClose && (
        <button type="button" onClick={onClose} className="shrink-0 opacity-70 hover:opacity-100" aria-label="Dismiss">
          ✕
        </button>
      )}
    </div>
  )
}
