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
}
