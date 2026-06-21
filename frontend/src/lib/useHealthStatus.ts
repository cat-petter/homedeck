import { useEffect, useRef, useState } from 'react'
import type { ServiceData } from './api'
import { wsUrl } from './ws'

// Live list of services with their latest health status, over the health
// WebSocket, with auto-reconnect. Shared by the Dashboard tiles and Health page.
export function useHealthStatus() {
  const [services, setServices] = useState<ServiceData[] | null>(null)
  const [connected, setConnected] = useState(false)
  const closedByUs = useRef(false)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [bump, setBump] = useState(0)

  useEffect(() => {
    closedByUs.current = false
    const connect = () => {
      const ws = new WebSocket(wsUrl('/api/health/ws'))
      wsRef.current = ws
      ws.onopen = () => setConnected(true)
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'services') setServices(msg.services)
        } catch {
          /* ignore */
        }
      }
      ws.onclose = () => {
        setConnected(false)
        if (!closedByUs.current) reconnectRef.current = setTimeout(connect, 2000)
      }
      ws.onerror = () => ws.close()
    }
    connect()
    return () => {
      closedByUs.current = true
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      wsRef.current?.close()
    }
  }, [bump])

  // Force an immediate reconnect/refresh (e.g. right after a CRUD change).
  const refresh = () => setBump((b) => b + 1)
  return { services, connected, refresh }
}
