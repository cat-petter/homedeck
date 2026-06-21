// A small dependency-free multi-series SVG line chart with a time x-axis.
// Designed for compact "last 24h" trend charts. Renders responsively via a
// fixed viewBox scaled to 100% width.

export interface Series {
  label: string
  color: string
  points: { t: number; v: number }[] // t = epoch ms
}

const W = 600
const H = 160
const PAD = { top: 8, right: 8, bottom: 18, left: 40 }

export function LineChart({
  series,
  yMax,
  yFormat = (v) => String(Math.round(v)),
  height = 160,
}: {
  series: Series[]
  yMax?: number
  yFormat?: (v: number) => string
  height?: number
}) {
  const all = series.flatMap((s) => s.points)
  if (all.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-slate-400"
        style={{ height }}
      >
        Collecting data…
      </div>
    )
  }

  const tMin = Math.min(...all.map((p) => p.t))
  const tMax = Math.max(...all.map((p) => p.t))
  const tSpan = Math.max(tMax - tMin, 1)
  const vMaxRaw = yMax ?? Math.max(...all.map((p) => p.v), 1)
  const vMax = vMaxRaw * (yMax ? 1 : 1.1) || 1

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const xOf = (t: number) => PAD.left + ((t - tMin) / tSpan) * plotW
  const yOf = (v: number) => PAD.top + plotH - (Math.min(v, vMax) / vMax) * plotH

  // Horizontal gridlines at 0, 50%, 100% of vMax.
  const gridVals = [0, vMax / 2, vMax]

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
    >
      {/* gridlines + y labels */}
      {gridVals.map((gv, i) => {
        const y = yOf(gv)
        return (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y}
              y2={y}
              className="stroke-slate-200 dark:stroke-slate-800"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 4}
              y={y + 3}
              textAnchor="end"
              className="fill-slate-400 text-[9px]"
              style={{ fontSize: 9 }}
            >
              {yFormat(gv)}
            </text>
          </g>
        )
      })}

      {/* series */}
      {series.map((s) => {
        const d = s.points
          .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(p.t).toFixed(1)} ${yOf(p.v).toFixed(1)}`)
          .join(' ')
        return (
          <path
            key={s.label}
            d={d}
            fill="none"
            stroke={s.color}
            strokeWidth={1.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )
      })}
    </svg>
  )
}

export function ChartLegend({ series }: { series: Series[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
      {series.map((s) => (
        <span key={s.label} className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  )
}
