import { useState } from 'react'
import { Modal } from './Modal'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
}

export function ConfirmDialog({
  open,
  options,
  onConfirm,
  onCancel,
}: {
  open: boolean
  options: ConfirmOptions | null
  onConfirm: () => Promise<void> | void
  onCancel: () => void
}) {
  const [busy, setBusy] = useState(false)
  if (!options) return null

  async function handleConfirm() {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={busy ? () => {} : onCancel} labelledBy="confirm-title">
      <h2 id="confirm-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
        {options.title}
      </h2>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{options.message}</p>
      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy}
          className={
            'rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ' +
            (options.danger ? 'bg-red-600 hover:bg-red-500' : 'bg-sky-600 hover:bg-sky-500')
          }
        >
          {busy ? 'Working…' : (options.confirmLabel ?? 'Confirm')}
        </button>
      </div>
    </Modal>
  )
}
