import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { wsUrl } from '../lib/ws'
import { Modal } from './Modal'

// Interactive shell into a running container over the exec WebSocket.
export function TerminalDrawer({
  containerId,
  name,
  open,
  onClose,
}: {
  containerId: string | null
  name: string
  open: boolean
  onClose: () => void
}) {
  const mountRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open || !containerId || !mountRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      theme: { background: '#0b0f17', foreground: '#e2e8f0' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(mountRef.current)
    fit.fit()
    term.focus()

    const ws = new WebSocket(wsUrl(`/api/docker/ws/exec/${encodeURIComponent(containerId)}`))
    ws.binaryType = 'arraybuffer'
    let alive = true

    const sendResize = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', rows: term.rows, cols: term.cols }))
      }
    }

    ws.onopen = () => {
      sendResize()
      term.writeln('\x1b[90m— connected —\x1b[0m')
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        // Control/error message (JSON).
        try {
          const m = JSON.parse(ev.data)
          if (m.type === 'error') term.writeln(`\r\n\x1b[31m${m.detail}\x1b[0m`)
        } catch {
          /* ignore */
        }
        return
      }
      term.write(new Uint8Array(ev.data))
    }
    ws.onclose = () => {
      if (alive) term.writeln('\r\n\x1b[90m— session ended —\x1b[0m')
    }
    ws.onerror = () => term.writeln('\r\n\x1b[31m— connection error —\x1b[0m')

    const dataSub = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: d }))
    })

    const onResize = () => {
      try {
        fit.fit()
      } catch {
        /* terminal not measurable yet */
      }
      sendResize()
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(mountRef.current)

    return () => {
      alive = false
      ro.disconnect()
      dataSub.dispose()
      ws.close()
      term.dispose()
    }
  }, [open, containerId])

  return (
    <Modal open={open} onClose={onClose} side labelledBy="term-title">
      <div className="flex h-full flex-col bg-[#0b0f17]">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 id="term-title" className="flex items-center gap-2 truncate font-mono text-sm font-semibold text-slate-100">
            <span className="text-emerald-400">›_</span> {name}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800">✕</button>
        </div>
        <div ref={mountRef} className="min-h-0 flex-1 overflow-hidden p-2" />
      </div>
    </Modal>
  )
}
