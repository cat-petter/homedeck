// Detect how the dashboard itself was reached (LAN vs Tailscale) from the URL
// the browser used, so a tile can open the matching service URL automatically.

export type AccessMode = 'lan' | 'tailscale'

export function getAccessMode(host: string = window.location.hostname): AccessMode {
  const h = host.toLowerCase()
  // Tailscale MagicDNS names end in .ts.net
  if (h.endsWith('.ts.net')) return 'tailscale'
  // Tailscale IPv4 lives in the CGNAT range 100.64.0.0/10
  const m = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/)
  if (m && Number(m[1]) === 100 && Number(m[2]) >= 64 && Number(m[2]) <= 127) {
    return 'tailscale'
  }
  // Tailscale IPv6 ULA prefix fd7a:115c:a1e0::/48
  if (h.startsWith('fd7a:115c:a1e0')) return 'tailscale'
  return 'lan'
}

// Choose the URL matching the current access mode, falling back to the other.
export function pickServiceUrl(
  lanUrl: string,
  tailscaleUrl: string,
  mode: AccessMode = getAccessMode(),
): string {
  if (mode === 'tailscale') return tailscaleUrl || lanUrl
  return lanUrl || tailscaleUrl
}
