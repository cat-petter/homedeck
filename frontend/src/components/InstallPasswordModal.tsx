import { useEffect, useState } from 'react'
import { ApiError, api } from '../lib/api'
import { Modal } from './Modal'

// Create or change the app-level install password that gates APT
// install/remove/upgrade. Separate from the login password.
export function InstallPasswordModal({
  open,
  mode,
  onClose,
  onDone,
}: {
  open: boolean
  mode: 'create' | 'change'
  onClose: () => void
  onDone?: () => void
}) {
  const [current, setCurrent] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setCurrent('')
      setPw('')
      setConfirm('')
      setError(null)
    }
  }, [open])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (pw.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (pw !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      await api.setInstallPassword(pw, mode === 'change' ? current : undefined)
      onDone?.()
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="ipw-title">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 p-5">
        <h2 id="ipw-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {mode === 'create' ? 'Set install password' : 'Change install password'}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Required before installing, removing, or upgrading system packages. This is separate
          from your login password.
        </p>

        {mode === 'change' && (
          <Field label="Current install password">
            <input type="password" autoComplete="off" value={current} onChange={(e) => setCurrent(e.target.value)} className={inp} />
          </Field>
        )}
        <Field label={mode === 'create' ? 'Install password' : 'New password'}>
          <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className={inp} />
        </Field>
        <Field label="Confirm password">
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inp} />
        </Field>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-60">
            {busy ? 'Saving…' : mode === 'create' ? 'Set password' : 'Change password'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

const inp =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {children}
    </label>
  )
}
