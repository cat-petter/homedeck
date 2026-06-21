// A small "ⓘ" affordance with a hover/focus tooltip. Keep it outside
// overflow-clipping containers (e.g. scrollable tables) so the popover shows.

export function InfoTip({ text, label = 'More info' }: { text: string; label?: string }) {
  return (
    <span className="group relative ml-1 inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-semibold leading-none text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        i
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden w-72 rounded-lg border border-slate-200 bg-white p-2.5 text-xs font-normal normal-case leading-snug text-slate-600 shadow-lg group-hover:block group-focus-within:block dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
      >
        {text}
      </span>
    </span>
  )
}
