// Thin fetch wrapper for the HomeDeck API. Same-origin: cookies are sent
// automatically. In dev, Vite proxies /api to the FastAPI backend.

export class ApiError extends Error {
  status: number
  detail: unknown
  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.status = status
    this.detail = detail
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
    const rawDetail =
      data && typeof data === 'object' && 'detail' in data
        ? (data as { detail: unknown }).detail
        : null
    // `detail` may be a string or a structured object (e.g. {message, output}).
    const message =
      typeof rawDetail === 'string'
        ? rawDetail
        : rawDetail && typeof rawDetail === 'object' && 'message' in rawDetail
          ? String((rawDetail as { message: unknown }).message)
          : res.statusText || 'Request failed'
    throw new ApiError(res.status, message, rawDetail)
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

export interface DiscoverySuggestion {
  container_id: string
  container_name: string
  image: string
  name: string
  category: string
  icon_url: string
  url: string
  port: number | null
  scheme: string | null
  http_status?: number | null
  source: 'label' | 'probe'
  already_added: boolean
}

export interface ServiceHistory {
  service_id: number
  hours: number
  uptime_pct: number | null
  checks: number
  samples: { ts: string; status: HealthStatus; response_ms: number | null; error: string | null }[]
}

// --- Catalog / app store types ----------------------------------------------

export interface TemplatePort {
  container_port: string
  host_port: string | null
  protocol: string
}
export interface TemplateVolume {
  container_path: string
  bind: string | null
  readonly: boolean
  type: string
}
export interface TemplateEnv {
  name: string
  label: string
  description: string
  default: string
  preset: boolean
  required: boolean
  options: { text: string; value: string }[] | null
}
export interface TemplateSpec {
  ports: TemplatePort[]
  volumes: TemplateVolume[]
  env: TemplateEnv[]
  restart_policy: string
  command: string
  network: string
  hostname: string
  privileged: boolean
  repository: { url?: string; stackfile?: string } | null
  platform: string
  note: string
}
export interface CatalogTemplate {
  id: string
  source: string
  source_url: string
  name: string
  description: string
  logo: string
  image: string
  image_key: string
  kind: string
  categories: string[]
  sources: { catalog: string; url: string }[]
  updated_at: string | null
  spec?: TemplateSpec
}
export interface CatalogVariant {
  id: string
  image: string
  image_key: string
  source: string
}
export interface CatalogApp {
  app_group: string
  name: string
  description: string
  logo: string
  categories: string[]
  kind: string
  primary_id: string
  sources: string[]
  variant_count: number
  variants: CatalogVariant[]
}
export interface CatalogStatus {
  total: number
  variants?: number
  last_synced: string | null
  by_source: Record<string, number>
}
export interface SyncSummary {
  imported: number
  updated: number
  skipped: number
  total: number
  sources: { source: string; url: string; templates: number }[]
  errors: { url: string; error: string }[]
}

// --- Install config / compose render ----------------------------------------

export interface InstallPort {
  container_port: string
  protocol: string
  host_port: string
}
export interface InstallEnv {
  name: string
  value: string
  label?: string
  description?: string
  required?: boolean
}
export interface InstallVolume {
  container_path: string
  type: string
  source: string
  readonly?: boolean
}
export interface InstallDevice {
  host: string
  container: string
}
export interface InstallConfig {
  title: string
  name: string
  image: string
  tag: string
  icon: string
  web_ui_lan: string
  web_ui_tailscale: string
  network: string
  ports: InstallPort[]
  env: InstallEnv[]
  volumes: InstallVolume[]
  devices: InstallDevice[]
  command: string
  privileged: boolean
  mem_limit_mb: number | null
  cpu_shares: number | null
  restart_policy: string
  cap_add: string[]
}
export interface NetworkOption {
  value: string
  label: string
}
export interface ValidationIssue {
  level: string
  field: string
  message: string
}
export interface RenderResult {
  compose_yaml: string
  validation: { ok: boolean; issues: ValidationIssue[] }
}

export interface InstalledApp {
  id: number
  name: string
  title: string
  image: string
  icon: string
  web_ui_lan: string
  web_ui_tailscale: string
  template_id: string
  service_id: number | null
  status: string // running | stopped | error | unknown
  last_error: string | null
  created_at: string | null
  updated_at: string | null
}

export interface DeployResult extends InstalledApp {
  output: string
}

// --- Docker Hub fallback ----------------------------------------------------

export interface HubSearchResult {
  repo: string
  description: string
  stars: number
  pulls: number | null
  is_official: boolean
  is_automated: boolean
  icon: string
}
export interface HubTag {
  name: string
  last_updated: string | null
  size: number | null
  architectures: string[]
}
export interface HubInspect {
  repo: string
  namespace: string
  name: string
  description: string
  readme: string
  readme_truncated: boolean
  stars: number
  pulls: number | null
  is_official: boolean
  last_updated: string | null
  tags: HubTag[]
  suggested: { title: string; icon: string; web_port: number | null }
}
export interface ImageReplacement {
  repo: string
  source: 'curated' | 'search'
  reason: string
}
export interface ImageStatus {
  checked: boolean
  exists?: boolean
  stale?: boolean
  last_updated?: string
  message?: string
  registry?: string
  error?: string
  replacement?: ImageReplacement | null
}

// --- APT app store ----------------------------------------------------------

export interface AptStatus {
  total: number
  installed: number
  upgradable: number
}
export interface AptPackage {
  name: string
  summary: string
  section: string
  installed: boolean
  upgradable: boolean
  installed_version: string | null
  candidate_version: string
}
export interface AptPackageDetail extends AptPackage {
  description: string
  homepage: string
  installed_size: number
  download_size: number
  priority: string
  origin: string
}

// --- Settings ---------------------------------------------------------------

export interface CatalogSource {
  kind: 'portainer' | 'casaos'
  url: string
  enabled: boolean
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
  dockerNetworks: () => request<{ options: NetworkOption[] }>('/api/docker/networks'),
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

  // Discovery
  discoverySuggestions: () =>
    request<{ suggestions: DiscoverySuggestion[] }>('/api/discovery/suggestions'),

  // Catalog / app store
  catalogStatus: () => request<CatalogStatus>('/api/catalog/status'),
  catalogCategories: () =>
    request<{ categories: { name: string; count: number }[] }>('/api/catalog/categories'),
  catalogTemplates: (params: { search?: string; category?: string; source?: string } = {}) => {
    const q = new URLSearchParams()
    if (params.search) q.set('search', params.search)
    if (params.category) q.set('category', params.category)
    if (params.source) q.set('source', params.source)
    const qs = q.toString()
    return request<{ total: number; items: CatalogApp[] }>(
      `/api/catalog/templates${qs ? `?${qs}` : ''}`,
    )
  },
  catalogTemplate: (id: string) =>
    request<CatalogTemplate>(`/api/catalog/templates/${encodeURIComponent(id)}`),
  catalogSync: () => request<SyncSummary>('/api/catalog/sync', { method: 'POST' }),
  catalogRender: (template_id: string, config: InstallConfig) =>
    request<RenderResult>('/api/catalog/render', {
      method: 'POST',
      body: JSON.stringify({ template_id, config }),
    }),
  stackCompose: (template_id: string) =>
    request<{ compose_yaml: string; source_url: string; swarmish: boolean }>(
      `/api/catalog/stack-compose?template_id=${encodeURIComponent(template_id)}`,
    ),
  deployStackCompose: (body: {
    name: string
    compose_yaml: string
    title?: string
    icon?: string
    web_ui_lan?: string
    web_ui_tailscale?: string
    template_id?: string
  }) => request<DeployResult>('/api/apps/deploy-compose', { method: 'POST', body: JSON.stringify(body) }),

  // Installed apps
  listApps: () => request<{ apps: InstalledApp[] }>('/api/apps'),
  getApp: (id: number) =>
    request<InstalledApp & { config: InstallConfig; compose_yaml: string }>(`/api/apps/${id}`),
  deployApp: (template_id: string, config: InstallConfig) =>
    request<DeployResult>('/api/apps/deploy', {
      method: 'POST',
      body: JSON.stringify({ template_id, config }),
    }),
  reconfigureApp: (id: number, config: InstallConfig) =>
    request<DeployResult>(`/api/apps/${id}/reconfigure`, {
      method: 'POST',
      body: JSON.stringify({ config }),
    }),
  startApp: (id: number) => request<InstalledApp>(`/api/apps/${id}/start`, { method: 'POST' }),
  stopApp: (id: number) => request<InstalledApp>(`/api/apps/${id}/stop`, { method: 'POST' }),
  removeApp: (id: number, deleteData = false) =>
    request<{ ok: boolean; output: string }>(
      `/api/apps/${id}${deleteData ? '?delete_data=true' : ''}`,
      { method: 'DELETE' },
    ),

  // Docker Hub fallback
  hubSearch: (q: string, limit = 25) =>
    request<{ count: number; results: HubSearchResult[] }>(
      `/api/hub/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),
  hubInspect: (repo: string) =>
    request<HubInspect>(`/api/hub/repos/${repo.split('/').map(encodeURIComponent).join('/')}`),
  hubImageStatus: (image: string) =>
    request<ImageStatus>(`/api/hub/image-status?image=${encodeURIComponent(image)}`),

  // APT app store
  aptStatus: () => request<AptStatus>('/api/apt/status'),
  aptPackages: (params: { search?: string; installed?: boolean; upgradable?: boolean; limit?: number } = {}) => {
    const q = new URLSearchParams()
    if (params.search) q.set('search', params.search)
    if (params.installed) q.set('installed', 'true')
    if (params.upgradable) q.set('upgradable', 'true')
    if (params.limit) q.set('limit', String(params.limit))
    const qs = q.toString()
    return request<{ total: number; items: AptPackage[] }>(`/api/apt/packages${qs ? `?${qs}` : ''}`)
  },
  aptPackage: (name: string) =>
    request<AptPackageDetail>(`/api/apt/packages/${encodeURIComponent(name)}`),

  // Install password (gates privileged package operations)
  installPasswordStatus: () => request<{ set: boolean }>('/api/install-password/status'),
  setInstallPassword: (password: string, current_password?: string) =>
    request<{ set: boolean }>('/api/install-password', {
      method: 'POST',
      body: JSON.stringify({ password, current_password: current_password ?? null }),
    }),
  verifyInstallPassword: (password: string) =>
    request<{ ok: boolean }>('/api/install-password/verify', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  // Settings
  catalogSources: () => request<{ sources: CatalogSource[] }>('/api/settings/catalog-sources'),
  saveCatalogSources: (sources: CatalogSource[]) =>
    request<{ sources: CatalogSource[] }>('/api/settings/catalog-sources', {
      method: 'PUT',
      body: JSON.stringify({ sources }),
    }),
  imageRenames: () =>
    request<{ builtin: Record<string, string>; user: Record<string, string> }>('/api/settings/image-renames'),
  saveImageRenames: (renames: Record<string, string>) =>
    request<{ user: Record<string, string> }>('/api/settings/image-renames', {
      method: 'PUT',
      body: JSON.stringify({ renames }),
    }),
}

