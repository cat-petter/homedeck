// Lightweight pulse placeholders to avoid "Loading…" text flashes and layout
// shift while card grids load.

export function SkeletonCard() {
  return (
    <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="h-10 w-10 shrink-0 animate-pulse rounded-md bg-slate-200 dark:bg-slate-800" />
      <div className="min-w-0 flex-1 space-y-2 py-0.5">
        <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-3 w-full animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
      </div>
    </div>
  )
}

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}

// A full-width row placeholder (for stacked lists like the Health services list).
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="h-9 w-9 shrink-0 animate-pulse rounded-md bg-slate-200 dark:bg-slate-800" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-1/3 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
      </div>
      <div className="hidden gap-2 sm:flex">
        <div className="h-7 w-14 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-7 w-14 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
      </div>
    </div>
  )
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  )
}

// In-card line placeholders (for content inside an already-rendered Card).
export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2 py-1" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-4 animate-pulse rounded bg-slate-200 dark:bg-slate-800"
          style={{ width: `${92 - i * 14}%` }}
        />
      ))}
    </div>
  )
}
