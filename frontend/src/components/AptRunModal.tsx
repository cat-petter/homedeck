import { useEffect, useRef, useState } from 'react'
import { wsUrl } from '../lib/ws'
import { Modal } from './Modal'

export type AptVerb = 'install' | 'remove' | 'upgrade'

const TITLE: Record<AptVerb, string> = { install: 'Install', remove: 'Remove', upgrade: 'Upgrade' }

// Confirms a privileged apt operation, collects the install password, then runs
// it over a WebSocket and streams the live output.
export function AptRunModal({
  open,
  verb,
  pkg,
  onClose,
  onDone,
}: {
  open: boolean
  verb: AptVerb
  pkg: string
  onClose: () => void
  onDone?: () => void
}) {
  const [password, setPassword] = useState('')
  const [phase, setPhase] = useState<'confirm' | 'running' | 'done'>('confirm')
  const [lines, setLines] = useState<string[]>([])
  const [code, setCode] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const outRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (open) {
      setPassword('')
      setPhase('confirm')
      setLines([])
      setCode(null)
      setError(null)
    }
  }, [open, pkg, verb])

  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight
  }, [lines])

  // Close the socket if the component unmounts. (We don't cancel the server-side
  // operation — interrupting dpkg is unsafe; it runs to completion regardless.)
  useEffect(() => () => wsRef.current?.close(), [])

  const destructive = verb === 'remove'

  function start(e: React.FormEvent) {
    e.preventDefault()
    if (!password) {
      setError('Enter your install password.')
      return
    }
    setPhase('running')
    setLines([])
    setError(null)
    setCode(null)
    const ws = new WebSocket(wsUrl('/api/apt/ws/run'))
    wsRef.current = ws
    ws.onopen = () => ws.send(JSON.stringify({ verb, packages: [pkg], password }))
    ws.onmessage = (ev) => {
      let m: { type: string; data?: string; detail?: string; code?: number }
      try {
        m = JSON.parse(ev.data)
      } catch {
        return
      }
      if (m.type === 'line') setLines((l) => [...l, m.data ?? ''])
      else if (m.type === 'error') {
        setError(m.detail ?? 'Error')
        setLines((l) => [...l, `✗ ${m.detail ?? 'Error'}`])
      } else if (m.type === 'end') {
        setCode(m.code ?? 1)
        setPhase('done')
        if (m.code === 0) onDone?.()
      }
    }
    ws.onerror = () => setError('Connection error.')
  }

  const ok = code === 0

  return (
    <Modal open={open} onClose={phase === 'running' ? () => {} : onClose} labelledBy="aptrun-title">
      <div className="w-full max-w-xl p-5">
        {phase === 'confirm' ? (
          <form onSubmit={start} className="space-y-4">
            <h2 id="aptrun-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {TITLE[verb]} <span className="font-mono">{pkg}</span>?
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {destructive
                ? 'This removes the package from the system. Confirm with your install password.'
                : `This runs apt-get ${verb === 'upgrade' ? 'upgrade' : verb} as root via the HomeDeck helper. Confirm with your install password.`}
            </p>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Install password</span>
              <input
                type="password"
                autoComplete="off"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </label>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                Cancel
              </button>
              <button
                type="submit"
                className={
                  'rounded-lg px-4 py-2 text-sm font-medium text-white ' +
                  (destructive ? 'bg-red-600 hover:bg-red-500' : 'bg-sky-600 hover:bg-sky-500')
                }
              >
                {TITLE[verb]}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <h2 id="aptrun-title" className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
              {TITLE[verb]} <span className="font-mono">{pkg}</span>
              {phase === 'running' && <span className="text-sm font-normal text-slate-400">running…</span>}
              {phase === 'done' && (
                <span className={`text-sm font-medium ${ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                  {ok ? '✓ done' : `✗ failed (exit ${code})`}
                </span>
              )}
            </h2>
            <pre
              ref={outRef}
              className="h-72 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-200"
            >
              {lines.length ? lines.join('\n') : 'Starting…'}
            </pre>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={phase === 'running'}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {phase === 'running' ? 'Working…' : 'Close'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
