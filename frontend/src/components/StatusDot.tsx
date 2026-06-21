import type { HealthStatus } from '../lib/api'

export const STATUS_COLOR: Record<HealthStatus, string> = {
  up: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  down: 'bg-red-500',
  unknown: 'bg-slate-400',
}

export const STATUS_LABEL: Record<HealthStatus, string> = {
  up: 'Up',
  degraded: 'Degraded',
  down: 'Down',
  unknown: 'Unknown',
}

export function StatusDot({ status, pulse }: { status: HealthStatus; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      {pulse && status === 'up' && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
      )}
      <span
        className={`relative inline-flex h-2.5 w-2.5 rounded-full ${STATUS_COLOR[status]}`}
        title={STATUS_LABEL[status]}
      />
    </span>
  )
}
