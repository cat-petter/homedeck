// Thin fetch wrapper for the HomeDeck API. Same-origin: cookies are sent
// automatically. In dev, Vite proxies /api to the FastAPI backend.

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers:
      options.body != null ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  })

  if (res.status === 204) {
    return undefined as T
  }

  let data: unknown = null
  const text = await res.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!res.ok) {
    const detail =
      data && typeof data === 'object' && 'detail' in data
        ? String((data as { detail: unknown }).detail)
        : res.statusText || 'Request failed'
    throw new ApiError(res.status, detail)
  }
  return data as T
}

export interface UserOut {
  id: number
  username: string
  is_admin: boolean
}

export interface SetupStatus {
  needs_setup: boolean
}

export interface Connectivity {
  hostname: string
  lan_ip: string | null
  tailscale_ip: string | null
  tailscale_dns: string | null
  tailscale_available: boolean
}

export interface SystemInfo {
  app_version: string
  hostname: string
  platform: string
  python_version: string
  connectivity: Connectivity
}

// --- Docker types -----------------------------------------------------------

export interface ContainerPort {
  container_port: string
  protocol: string
  host_ip: string | null
  host_port: string | null
}

export interface ContainerSummary {
  id: string
  short_id: string
  name: string
  image: string
  state: string // running|exited|paused|created|restarting|dead
  status: string
  status_text: string
  created: string | null
  started_at: string | null
  finished_at: string | null
  ports: ContainerPort[]
  labels: Record<string, string>
  restart_policy: string
}

export interface ContainerStat {
  id: string
  cpu_pct: number | null
  mem_used: number | null
  mem_limit: number | null
  mem_pct: number | null
  net_rx: number
  net_tx: number
}

export interface EnvVar {
  key: string
  value: string
}

export interface MountInfo {
  type: string | null
  source: string | null
  destination: string | null
  mode: string | null
  rw: boolean | null
  name: string | null
}

export interface NetworkInfo {
  name: string
  ip_address: string | null
  gateway: string | null
  mac_address: string | null
  aliases: string[]
}

export interface ContainerInspect {
  id: string
  name: string
  image: string
  command: string[] | null
  entrypoint: string[] | null
  working_dir: string
  env: EnvVar[]
  labels: Record<string, string>
  mounts: MountInfo[]
  networks: NetworkInfo[]
  ports: ContainerPort[]
  restart_policy: Record<string, unknown>
  state: Record<string, unknown>
}

export type DockerAction = 'start' | 'stop' | 'restart' | 'pause' | 'unpause'

export const api = {
  setupStatus: () => request<SetupStatus>('/api/setup/status'),
  createAdmin: (username: string, password: string) =>
    request<UserOut>('/api/setup', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    request<UserOut>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  me: () => request<UserOut>('/api/auth/me'),
  systemInfo: () => request<SystemInfo>('/api/system/info'),

  // Docker
  listContainers: () => request<ContainerSummary[]>('/api/docker/containers'),
  inspectContainer: (id: string) =>
    request<ContainerInspect>(`/api/docker/containers/${encodeURIComponent(id)}/inspect`),
  containerAction: (id: string, action: DockerAction) =>
    request<{ ok: boolean }>(`/api/docker/containers/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
    }),
  removeContainer: (id: string, opts: { force?: boolean; volumes?: boolean } = {}) => {
    const q = new URLSearchParams()
    if (opts.force) q.set('force', 'true')
    if (opts.volumes) q.set('volumes', 'true')
    const qs = q.toString()
    return request<{ ok: boolean }>(
      `/api/docker/containers/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`,
      { method: 'DELETE' },
    )
  },
}

