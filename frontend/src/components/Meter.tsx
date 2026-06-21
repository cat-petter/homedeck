// A labeled horizontal usage bar. Color shifts amber/red as it fills up.

export function Meter({
  percent,
  label,
  sublabel,
}: {
  percent: number
  label?: string
  sublabel?: string
}) {
  const pct = Math.max(0, Math.min(100, percent))
  const color =
    pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-sky-500'
  return (
    <div>
      {(label || sublabel) && (
        <div className="mb-1 flex items-baseline justify-between text-sm">
          <span className="text-slate-600 dark:text-slate-300">{label}</span>
          <span className="tabular-nums text-slate-500 dark:text-slate-400">{sublabel}</span>
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
