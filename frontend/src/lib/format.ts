// Small display formatters shared across the UI.

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let val = bytes / 1024
  let i = 0
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024
    i++
  }
  return `${val.toFixed(val < 10 ? 1 : 0)} ${units[i]}`
}

export function formatPercent(pct: number | null | undefined): string {
  if (pct == null) return '—'
  return `${pct.toFixed(1)}%`
}

// Compact relative duration since an ISO timestamp (e.g. "3d 4h", "12m").
export function formatUptime(startedAt: string | null | undefined): string {
  if (!startedAt) return '—'
  const start = new Date(startedAt).getTime()
  if (Number.isNaN(start)) return '—'
  let secs = Math.floor((Date.now() - start) / 1000)
  if (secs < 0) secs = 0
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${secs}s`
}
