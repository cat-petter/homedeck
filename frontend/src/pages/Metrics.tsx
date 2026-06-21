import { useEffect, useRef, useState } from 'react'
import {
  ApiError,
  api,
  type MetricSample,
  type MetricsSnapshot,
  type ProcessGroup,
  type ProcessSort,
} from '../lib/api'
import { wsUrl } from '../lib/ws'
import { formatBytes, formatDuration, formatPercent, formatRate } from '../lib/format'
import { useDockerStatus } from '../lib/useDockerStatus'
import { Meter } from '../components/Meter'
import { ChartLegend, LineChart, type Series } from '../components/LineChart'

function useLiveMetrics() {
  const [snap, setSnap] = useState<MetricsSnapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const closedByUs = useRef(false)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    closedByUs.current = false
    const connect = () => {
      const ws = new WebSocket(wsUrl('/api/metrics/ws'))
      wsRef.current = ws
      ws.onopen = () => setConnected(true)
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'snapshot') setSnap(msg.data)
        } catch {
          /* ignore */
        }
      }
      ws.onclose = () => {
        setConnected(false)
        if (!closedByUs.current) reconnectRef.current = setTimeout(connect, 2000)
      }
      ws.onerror = () => ws.close()
    }
    connect()
    return () => {
      closedByUs.current = true
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      wsRef.current?.close()
    }
  }, [])

  return { snap, connected }
}

export function Metrics() {
  const { snap, connected } = useLiveMetrics()
  const [history, setHistory] = useState<MetricSample[]>([])
  const [histError, setHistError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const load = () =>
      api
        .metricsHistory(24)
        .then((r) => active && setHistory(r.samples))
        .catch((e) => active && setHistError(e instanceof ApiError ? e.message : 'Failed to load history'))
    load()
    const id = setInterval(load, 20000)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [])

  const toMs = (iso: string) => new Date(iso).getTime()
  const cpuSeries: Series[] = [
    { label: 'CPU %', color: '#0ea5e9', points: history.map((s) => ({ t: toMs(s.ts), v: s.cpu_pct })) },
  ]
  const memSeries: Series[] = [
    { label: 'Memory %', color: '#8b5cf6', points: history.map((s) => ({ t: toMs(s.ts), v: s.mem_pct })) },
  ]
  const netSeries: Series[] = [
    { label: 'RX', color: '#10b981', points: history.map((s) => ({ t: toMs(s.ts), v: s.net_rx_rate })) },
    { label: 'TX', color: '#f59e0b', points: history.map((s) => ({ t: toMs(s.ts), v: s.net_tx_rate })) },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">System</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Live host metrics ·{' '}
          <span className={connected ? 'text-emerald-500' : 'text-amber-500'}>
            {connected ? 'live' : 'connecting…'}
          </span>
        </p>
      </div>

      {/* Live cards */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card title="CPU">
          <div className="flex items-end justify-between">
            <span className="text-3xl font-semibold tabular-nums">{formatPercent(snap?.cpu.percent)}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {snap?.cpu.count_logical ?? '—'} cores
            </span>
          </div>
          {snap && (
            <div className="mt-3 flex gap-1">
              {snap.cpu.per_cpu.map((v, i) => (
                <div key={i} className="flex-1" title={`core ${i}: ${v.toFixed(0)}%`}>
                  <div className="flex h-12 items-end rounded bg-slate-200 dark:bg-slate-800">
                    <div
                      className="w-full rounded bg-sky-500"
                      style={{ height: `${Math.max(2, Math.min(100, v))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Memory">
          <div className="mb-3 flex items-end justify-between">
            <span className="text-3xl font-semibold tabular-nums">{formatPercent(snap?.memory.percent)}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {snap ? `${formatBytes(snap.memory.used)} / ${formatBytes(snap.memory.total)}` : '—'}
            </span>
          </div>
          <Meter percent={snap?.memory.percent ?? 0} />
          {snap && snap.swap.total > 0 && (
            <div className="mt-3">
              <Meter
                percent={snap.swap.percent}
                label="Swap"
                sublabel={`${formatBytes(snap.swap.used)} / ${formatBytes(snap.swap.total)}`}
              />
            </div>
          )}
        </Card>

        <Card title="Load & uptime">
          <Row label="Load (1m)" value={snap ? snap.load.load1.toFixed(2) : '—'} />
          <Row label="Load (5m)" value={snap ? snap.load.load5.toFixed(2) : '—'} />
          <Row label="Load (15m)" value={snap ? snap.load.load15.toFixed(2) : '—'} />
          <Row label="Uptime" value={snap ? formatDuration(snap.uptime_seconds) : '—'} />
        </Card>

        <Card title="Network">
          <Row label="↓ Download" value={formatRate(snap?.network.rx_rate)} mono />
          <Row label="↑ Upload" value={formatRate(snap?.network.tx_rate)} mono />
          <Row label="Total in" value={formatBytes(snap?.network.rx_total)} mono />
          <Row label="Total out" value={formatBytes(snap?.network.tx_total)} mono />
        </Card>

        <Card title="Disks" className="sm:col-span-2">
          {!snap ? (
            <p className="text-sm text-slate-400">…</p>
          ) : snap.disks.length === 0 ? (
            <p className="text-sm text-slate-400">No mounted disks detected.</p>
          ) : (
            <div className="space-y-3">
              {snap.disks.map((d) => (
                <Meter
                  key={d.mountpoint}
                  percent={d.percent}
                  label={`${d.mountpoint} (${d.fstype})`}
                  sublabel={`${formatBytes(d.used)} / ${formatBytes(d.total)} · ${formatPercent(d.percent)}`}
                />
              ))}
            </div>
          )}
        </Card>
      </section>

      {/* History charts */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Last 24 hours
        </h2>
        {histError && <p className="text-sm text-red-500">{histError}</p>}
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="CPU usage">
            <LineChart series={cpuSeries} yMax={100} yFormat={(v) => `${Math.round(v)}%`} />
          </ChartCard>
          <ChartCard title="Memory usage">
            <LineChart series={memSeries} yMax={100} yFormat={(v) => `${Math.round(v)}%`} />
          </ChartCard>
          <ChartCard title="Network throughput" legend={netSeries}>
            <LineChart series={netSeries} yFormat={(v) => formatBytes(v)} />
          </ChartCard>
        </div>
      </section>

      <ProcessBreakdown />
      <ContainerBreakdown />
    </div>
  )
}

function ProcessBreakdown() {
  const [sort, setSort] = useState<ProcessSort>('cpu')
  const [procs, setProcs] = useState<ProcessGroup[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const load = () =>
      api
        .metricsProcesses(sort, 10)
        .then((r) => active && setProcs(r.processes))
        .catch((e) => active && setError(e instanceof ApiError ? e.message : 'Failed to load processes'))
    load()
    const id = setInterval(load, 4000)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [sort])

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Top programs (host, by {sort === 'cpu' ? 'CPU' : 'memory'})
        </h2>
        <div className="flex overflow-hidden rounded-lg border border-slate-300 text-xs dark:border-slate-700">
          {(['cpu', 'mem'] as ProcessSort[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              className={
                'px-3 py-1 font-medium ' +
                (sort === s
                  ? 'bg-sky-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800')
              }
            >
              {s === 'cpu' ? 'CPU' : 'Memory'}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2 font-medium">Program</th>
              <th className="px-4 py-2 font-medium">Procs</th>
              <th className="px-4 py-2 font-medium">CPU</th>
              <th className="px-4 py-2 font-medium">Memory</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {procs.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-slate-400">
                  Sampling…
                </td>
              </tr>
            ) : (
              procs.map((p) => (
                <tr key={p.name} className="bg-white dark:bg-slate-950">
                  <td className="truncate px-4 py-2 font-medium text-slate-800 dark:text-slate-100">{p.name}</td>
                  <td className="px-4 py-2 tabular-nums text-slate-500 dark:text-slate-400">{p.count}</td>
                  <td className="px-4 py-2 tabular-nums text-slate-600 dark:text-slate-300">
                    {formatPercent(p.cpu_pct)}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-slate-600 dark:text-slate-300">
                    {formatBytes(p.mem_bytes)}
                    <span className="ml-1 text-xs text-slate-400">({formatPercent(p.mem_pct)})</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ContainerBreakdown() {
  const { containers, stats } = useDockerStatus()
  const rows = (containers ?? [])
    .filter((c) => c.state === 'running')
    .map((c) => ({ c, st: stats[c.id] }))
    .sort((a, b) => (b.st?.cpu_pct ?? 0) - (a.st?.cpu_pct ?? 0))
    .slice(0, 8)

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Per-container (top by CPU)
      </h2>
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2 font-medium">Container</th>
              <th className="px-4 py-2 font-medium">CPU</th>
              <th className="px-4 py-2 font-medium">Memory</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-3 text-slate-400">
                  No running containers.
                </td>
              </tr>
            ) : (
              rows.map(({ c, st }) => (
                <tr key={c.id} className="bg-white dark:bg-slate-950">
                  <td className="truncate px-4 py-2 font-medium text-slate-800 dark:text-slate-100">{c.name}</td>
                  <td className="px-4 py-2 tabular-nums text-slate-600 dark:text-slate-300">
                    {formatPercent(st?.cpu_pct)}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-slate-600 dark:text-slate-300">
                    {formatBytes(st?.mem_used)}
                    {st?.mem_pct != null && (
                      <span className="ml-1 text-xs text-slate-400">({formatPercent(st.mem_pct)})</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Card({
  title,
  children,
  className = '',
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}
    >
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </h3>
      {children}
    </div>
  )
}

function ChartCard({
  title,
  children,
  legend,
}: {
  title: string
  children: React.ReactNode
  legend?: Series[]
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {title}
        </h3>
        {legend && <ChartLegend series={legend} />}
      </div>
      {children}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`text-sm text-slate-800 dark:text-slate-200 ${mono ? 'font-mono' : 'tabular-nums'}`}>
        {value}
      </span>
    </div>
  )
}
