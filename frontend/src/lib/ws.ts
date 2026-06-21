// Build a same-origin WebSocket URL from an /api path. The session cookie rides
// along with the handshake automatically (same origin), so the backend can
// authenticate the connection.

export function wsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}${path}`
}
