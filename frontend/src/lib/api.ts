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

// --- Metrics types ----------------------------------------------------------

export interface DiskInfo {
  device: string
  mountpoint: string
  fstype: string
  total: number
  used: number
  free: number
  percent: number
}

export interface MetricsSnapshot {
  ts: string
  cpu: {
    percent: number
    per_cpu: number[]
    count_logical: number | null
    count_physical: number | null
  }
  memory: { total: number; used: number; available: number; percent: number }
  swap: { total: number; used: number; percent: number }
  disks: DiskInfo[]
  network: { rx_rate: number; tx_rate: number; rx_total: number; tx_total: number }
  load: { load1: number; load5: number; load15: number }
  uptime_seconds: number
  boot_time: number
}

export interface MetricSample {
  ts: string
  cpu_pct: number
  mem_pct: number
  mem_used: number
  mem_total: number
  swap_pct: number
  net_rx_rate: number
  net_tx_rate: number
  load1: number
}

export interface ProcessGroup {
  name: string
  cpu_pct: number
  mem_bytes: number
  mem_pct: number
  count: number
}

export type ProcessSort = 'cpu' | 'mem'

// --- Storage types ----------------------------------------------------------

export interface StorageCategory {
  type: string
  count: number
  active: number
  size: number
  reclaimable: number
}

export interface DockerUsage {
  categories: StorageCategory[]
  total_size: number
  total_reclaimable: number
  largest_images: { name: string; size: number; shared: number; containers: number }[]
  largest_volumes: { name: string; size: number; refcount: number }[]
}

export interface FilesystemInfo {
  device: string
  mountpoint: string
  fstype: string
  opts: string
  total: number
  used: number
  free: number
  percent: number
  inodes: { total: number; used: number; free: number; percent: number } | null
}

export interface DirEntry {
  name: string
  is_dir: boolean
  is_link: boolean
  is_mount: boolean
  size: number
  accessible: boolean
  errors?: number
}

export interface DirBreakdown {
  path: string
  parent: string | null
  entries: DirEntry[]
  truncated: boolean
}

// --- Health / services types ------------------------------------------------

export type CheckType = 'none' | 'http' | 'tcp' | 'ping'
export type HealthStatus = 'unknown' | 'up' | 'degraded' | 'down'

export interface ServiceInput {
  name: string
  category: string
  icon: string
  lan_url: string
  tailscale_url: string
  check_type: CheckType
  check_target: string
  expected_status: string
  interval_seconds: number
  timeout_seconds: number
  degraded_ms: number | null
  verify_tls: boolean
  enabled: boolean
  sort_order: number
}

export interface ServiceData extends ServiceInput {
  id: number
  last_status: HealthStatus
  last_checked_at: string | null
  last_response_ms: number | null
  last_error: string | null
  uptime_24h: number | null
}

export interface ServiceHistory {
  service_id: number
  hours: number
  uptime_pct: number | null
  checks: number
  samples: { ts: string; status: HealthStatus; response_ms: number | null; error: string | null }[]
}

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

  // Metrics
  metricsCurrent: () => request<MetricsSnapshot>('/api/metrics/current'),
  metricsHistory: (hours = 24) =>
    request<{ hours: number; samples: MetricSample[] }>(`/api/metrics/history?hours=${hours}`),
  metricsProcesses: (sort: ProcessSort = 'cpu', limit = 10) =>
    request<{ sort: ProcessSort; processes: ProcessGroup[] }>(
      `/api/metrics/processes?sort=${sort}&limit=${limit}`,
    ),

  // Storage
  storageDocker: () => request<DockerUsage>('/api/storage/docker'),
  storageFilesystems: () => request<{ filesystems: FilesystemInfo[] }>('/api/storage/filesystems'),
  storageDirectories: (path = '/', limit = 40) =>
    request<DirBreakdown>(
      `/api/storage/directories?path=${encodeURIComponent(path)}&limit=${limit}`,
    ),

  // Health / services
  listServices: () => request<ServiceData[]>('/api/health/services'),
  createService: (body: ServiceInput) =>
    request<ServiceData>('/api/health/services', { method: 'POST', body: JSON.stringify(body) }),
  updateService: (id: number, body: ServiceInput) =>
    request<ServiceData>(`/api/health/services/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteService: (id: number) =>
    request<void>(`/api/health/services/${id}`, { method: 'DELETE' }),
  checkService: (id: number) =>
    request<ServiceData>(`/api/health/services/${id}/check`, { method: 'POST' }),
  serviceHistory: (id: number, hours = 24) =>
    request<ServiceHistory>(`/api/health/services/${id}/history?hours=${hours}`),
}

