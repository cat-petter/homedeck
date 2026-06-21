import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from './Modal'
import { wsUrl } from '../lib/ws'

const MAX_LINES = 5000

export function LogsDrawer({
  containerId,
  containerName,
  open,
  onClose,
}: {
  containerId: string
  containerName: string
  open: boolean
  onClose: () => void
}) {
  const [lines, setLines] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [follow, setFollow] = useState(true)
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed' | 'error'>('connecting')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setLines([])
    setErrorMsg(null)
    setStatus('connecting')

    const ws = new WebSocket(wsUrl(`/api/docker/ws/logs/${encodeURIComponent(containerId)}?tail=400`))
    ws.onopen = () => setStatus('open')
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'line') {
          const incoming = String(msg.data).split('\n').filter((s: string) => s.length > 0)
          if (incoming.length === 0) return
          setLines((prev) => {
            const next = prev.concat(incoming)
            return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next
          })
        } else if (msg.type === 'error') {
          setErrorMsg(String(msg.detail))
          setStatus('error')
        } else if (msg.type === 'end') {
          setStatus('closed')
        }
      } catch {
        /* ignore malformed frame */
      }
    }
    ws.onerror = () => setStatus('error')
    ws.onclose = () => setStatus((s) => (s === 'error' ? s : 'closed'))

    return () => ws.close()
  }, [open, containerId])

  const filtered = useMemo(() => {
    if (!filter.trim()) return lines
    const f = filter.toLowerCase()
    return lines.filter((l) => l.toLowerCase().includes(f))
  }, [lines, filter])

  useEffect(() => {
    if (follow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [filtered, follow])

  return (
    <Modal open={open} onClose={onClose} side labelledBy="logs-title">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0">
            <h2 id="logs-title" className="truncate font-semibold text-slate-900 dark:text-slate-100">
              Logs — {containerName}
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {status === 'open' && '● live'}
              {status === 'connecting' && 'connecting…'}
              {status === 'closed' && 'stream ended'}
              {status === 'error' && 'error'}
              {' · '}
              {filtered.length} line{filtered.length === 1 ? '' : 's'}
              {filter && ` (filtered from ${lines.length})`}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close logs"
          >
            ✕
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2 dark:border-slate-800">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
            Follow
          </label>
        </div>

        {errorMsg && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {errorMsg}
          </div>
        )}

        <div
          ref={scrollRef}
          className="flex-1 overflow-auto bg-slate-950 px-4 py-3 font-mono text-xs leading-relaxed text-slate-200"
        >
          {filtered.length === 0 ? (
            <div className="text-slate-500">{status === 'open' ? 'Waiting for output…' : 'No log lines.'}</div>
          ) : (
            filtered.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                {line}
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  )
}
