import { useEffect, type ReactNode } from 'react'

// A simple centered/side modal overlay. Closes on Escape and backdrop click.
export function Modal({
  open,
  onClose,
  children,
  side = false,
  labelledBy,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  side?: boolean
  labelledBy?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className={'fixed inset-0 z-50 flex bg-black/50 backdrop-blur-sm ' + (side ? '' : 'p-4')}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
        className={
          side
            ? 'ml-auto h-full w-full max-w-2xl overflow-hidden border-l border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900'
            : 'm-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900'
        }
      >
        {children}
      </div>
    </div>
  )
}
