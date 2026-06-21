import { useEffect, useRef, useState } from 'react'
import type { ContainerStat, ContainerSummary } from './api'
import { wsUrl } from './ws'

export type WsState = 'connecting' | 'open' | 'closed'

// Live container list + stats over the status WebSocket, with auto-reconnect.
// Shared by the Docker page and the metrics per-container breakdown.
export function useDockerStatus() {
  const [containers, setContainers] = useState<ContainerSummary[] | null>(null)
  const [stats, setStats] = useState<Record<string, ContainerStat>>({})
  const [wsState, setWsState] = useState<WsState>('connecting')
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closedByUs = useRef(false)

  useEffect(() => {
    closedByUs.current = false

    const connect = () => {
      const ws = new WebSocket(wsUrl('/api/docker/ws/status'))
      wsRef.current = ws
      setWsState('connecting')
      ws.onopen = () => setWsState('open')
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'snapshot') {
            setContainers(msg.containers)
            setError(null)
          } else if (msg.type === 'stats') {
            const map: Record<string, ContainerStat> = {}
            for (const s of msg.stats as ContainerStat[]) map[s.id] = s
            setStats(map)
          } else if (msg.type === 'error') {
            setError(String(msg.detail))
          }
        } catch {
          /* ignore */
        }
      }
      ws.onclose = () => {
        setWsState('closed')
        if (!closedByUs.current) {
          reconnectRef.current = setTimeout(connect, 2000)
        }
      }
      ws.onerror = () => ws.close()
    }

    connect()
    return () => {
      closedByUs.current = true
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      wsRef.current?.close()
    }
  }, [])

  return { containers, stats, wsState, error }
}
