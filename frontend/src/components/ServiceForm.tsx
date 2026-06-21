import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, api, type CheckType, type ServiceData, type ServiceInput } from '../lib/api'
import { Modal } from './Modal'
import { AppIcon } from './AppIcon'

const EMPTY: ServiceInput = {
  name: '',
  category: '',
  icon: '',
  lan_url: '',
  tailscale_url: '',
  check_type: 'none',
  check_target: '',
  expected_status: '',
  interval_seconds: 60,
  timeout_seconds: 10,
  degraded_ms: null,
  verify_tls: false,
  enabled: true,
  sort_order: 0,
}

const CHECK_TYPES: { value: CheckType; label: string; hint: string }[] = [
  { value: 'none', label: 'None (launch tile only)', hint: '' },
  { value: 'http', label: 'HTTP(S)', hint: 'Full URL, e.g. http://192.168.1.250:3000' },
  { value: 'tcp', label: 'TCP port', hint: 'host:port, e.g. 192.168.1.250:443' },
  { value: 'ping', label: 'Ping (ICMP)', hint: 'Hostname or IP, e.g. 192.168.1.250' },
]

export function ServiceForm({
  open,
  existing,
  onClose,
  onSaved,
}: {
  open: boolean
  existing: ServiceData | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<ServiceInput>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (existing) {
      const { id: _id, last_status, last_checked_at, last_response_ms, last_error, uptime_24h, ...rest } =
        existing
      void _id
      void last_status
      void last_checked_at
      void last_response_ms
      void last_error
      void uptime_24h
      setForm(rest)
    } else {
      setForm(EMPTY)
    }
  }, [open, existing])

  const set = <K extends keyof ServiceInput>(k: K, v: ServiceInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (existing) await api.updateService(existing.id, form)
      else await api.createService(form)
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed.')
    } finally {
      setBusy(false)
    }
  }

  const typeHint = CHECK_TYPES.find((t) => t.value === form.check_type)?.hint

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} labelledBy="svc-form-title">
      <form onSubmit={onSubmit} className="max-h-[80vh] space-y-4 overflow-y-auto pr-1">
        <h2 id="svc-form-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {existing ? 'Edit service' : 'Add service'}
        </h2>

        <div className="grid grid-cols-2 gap-3">
          <Text label="Name" value={form.name} onChange={(v) => set('name', v)} required autoFocus />
          <Text label="Category" value={form.category} onChange={(v) => set('category', v)} placeholder="e.g. Media" />
          <div className="col-span-2 flex items-end gap-3">
            <Text
              label="Icon"
              value={form.icon}
              onChange={(v) => set('icon', v)}
              placeholder="https://…/icon.png  or  an emoji 🎬"
              hint="Image URL (CasaOS-style) or an emoji."
              className="flex-1"
            />
            <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
              <AppIcon icon={form.icon} size={28} />
            </div>
          </div>
          <Text label="Sort order" type="number" value={String(form.sort_order)} onChange={(v) => set('sort_order', Number(v) || 0)} />
          <Text label="LAN URL" value={form.lan_url} onChange={(v) => set('lan_url', v)} placeholder="http://192.168.1.250:8096" className="col-span-2" />
          <Text label="Tailscale URL" value={form.tailscale_url} onChange={(v) => set('tailscale_url', v)} placeholder="http://host.tailnet.ts.net:8096" className="col-span-2" />
        </div>

        <fieldset className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Health check
          </legend>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Type</span>
            <select
              value={form.check_type}
              onChange={(e) => set('check_type', e.target.value as CheckType)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {CHECK_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          {form.check_type !== 'none' && (
            <div className="mt-3 space-y-3">
              <Text
                label="Target"
                value={form.check_target}
                onChange={(v) => set('check_target', v)}
                placeholder={typeHint}
                hint={typeHint}
              />
              <div className="grid grid-cols-2 gap-3">
                <Text label="Interval (s)" type="number" value={String(form.interval_seconds)} onChange={(v) => set('interval_seconds', Number(v) || 60)} />
                <Text label="Timeout (s)" type="number" value={String(form.timeout_seconds)} onChange={(v) => set('timeout_seconds', Number(v) || 10)} />
                {form.check_type === 'http' && (
                  <Text label="Expected status" value={form.expected_status} onChange={(v) => set('expected_status', v)} placeholder="blank = 2xx/3xx" />
                )}
                <Text
                  label="Degraded over (ms)"
                  type="number"
                  value={form.degraded_ms == null ? '' : String(form.degraded_ms)}
                  onChange={(v) => set('degraded_ms', v === '' ? null : Number(v))}
                  placeholder="optional"
                />
              </div>
              {form.check_type === 'http' && (
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input type="checkbox" checked={form.verify_tls} onChange={(e) => set('verify_tls', e.target.checked)} />
                  Verify TLS certificate (off is fine for self-signed)
                </label>
              )}
            </div>
          )}
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
            Enabled
          </label>
        </fieldset>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-60"
          >
            {busy ? 'Saving…' : existing ? 'Save changes' : 'Add service'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Text({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
  autoFocus,
  className = '',
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  required?: boolean
  autoFocus?: boolean
  className?: string
  hint?: string
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      />
      {hint && <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}
