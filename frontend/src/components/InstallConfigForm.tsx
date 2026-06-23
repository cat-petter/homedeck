import { useEffect, useMemo, useState } from 'react'
import {
  ApiError,
  api,
  type CatalogTemplate,
  type InstallConfig,
  type NetworkOption,
  type RenderResult,
} from '../lib/api'
import { Modal } from './Modal'
import { AppIcon } from './AppIcon'

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^[-_.]+|[-_.]+$/g, '') || 'app'
}

// Build a fresh InstallConfig for a non-catalog image (e.g. a Docker Hub result).
export function blankInstallConfig(p: {
  title: string
  image: string
  tag?: string
  icon?: string
  webPort?: number | null
}): InstallConfig {
  const ports = p.webPort
    ? [{ host_port: String(p.webPort), container_port: String(p.webPort), protocol: 'tcp' }]
    : []
  return {
    title: p.title,
    name: slugify(p.title),
    image: p.image,
    tag: p.tag || 'latest',
    icon: p.icon || '',
    web_ui_lan: '',
    web_ui_tailscale: '',
    network: 'bridge',
    ports,
    env: [],
    volumes: [],
    devices: [],
    command: '',
    privileged: false,
    mem_limit_mb: null,
    cpu_shares: null,
    restart_policy: 'unless-stopped',
    cap_add: [],
  }
}

function splitImage(ref: string): { image: string; tag: string } {
  if (!ref) return { image: '', tag: 'latest' }
  const lastSeg = ref.split('/').pop() || ref
  if (lastSeg.includes(':')) {
    const idx = ref.lastIndexOf(':')
    return { image: ref.slice(0, idx), tag: ref.slice(idx + 1) }
  }
  return { image: ref, tag: 'latest' }
}

function initConfig(t: CatalogTemplate): InstallConfig {
  const title = t.name
  const name = slugify(title)
  const { image, tag } = splitImage(t.image)
  const spec = t.spec!
  return {
    title,
    name,
    image,
    tag,
    icon: t.logo || '',
    web_ui_lan: '',
    web_ui_tailscale: '',
    network: spec.network || 'bridge',
    ports: spec.ports.map((p) => ({
      container_port: p.container_port,
      protocol: p.protocol,
      host_port: p.host_port || p.container_port,
    })),
    env: spec.env.map((e) => ({
      name: e.name,
      value: e.default,
      label: e.label,
      description: e.description,
      required: e.required,
    })),
    volumes: spec.volumes.map((v) => ({
      container_path: v.container_path,
      type: v.type,
      readonly: v.readonly,
      source: v.bind || (v.type === 'bind' ? `/DATA/AppData/${name}${v.container_path}` : `${name}${slugify(v.container_path)}`),
    })),
    devices: [],
    command: spec.command || '',
    privileged: spec.privileged || false,
    mem_limit_mb: null,
    cpu_shares: null,
    restart_policy: spec.restart_policy || 'unless-stopped',
    cap_add: [],
  }
}

const RESTART_POLICIES = ['unless-stopped', 'always', 'on-failure', 'no']
const CPU_OPTIONS = [
  { label: 'Default', value: '' },
  { label: 'Low (512)', value: '512' },
  { label: 'Normal (1024)', value: '1024' },
  { label: 'High (2048)', value: '2048' },
  { label: 'Max (4096)', value: '4096' },
]
const COMMON_CAPS = ['NET_ADMIN', 'NET_RAW', 'SYS_ADMIN', 'SYS_MODULE', 'SYS_NICE', 'SYS_TIME', 'MKNOD', 'CHOWN', 'DAC_OVERRIDE']
const MEM_FALLBACK_MAX = 16384 // MB, until the host's total RAM is detected

export function InstallConfigForm({
  template,
  open,
  onClose,
  onDeployed,
  editApp,
  seed,
  imageOverride,
}: {
  template: CatalogTemplate | null
  open: boolean
  onClose: () => void
  onDeployed?: () => void
  // When set, the form edits an existing app instead of installing a new one.
  editApp?: { id: number; template_id: string; config: InstallConfig } | null
  // When set (and not editing), pre-fill a fresh install from a non-catalog
  // image (e.g. a Docker Hub search result).
  seed?: InstallConfig | null
  // When set, substitute the catalog template's image with this one (the
  // original 404'd on Docker Hub and was auto-remapped). Shown disclaimed.
  imageOverride?: { repo: string; reason: string } | null
}) {
  const [config, setConfig] = useState<InstallConfig | null>(null)
  const [render, setRender] = useState<RenderResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [raw, setRaw] = useState(false)
  const [networks, setNetworks] = useState<NetworkOption[]>([])
  const [memMax, setMemMax] = useState(MEM_FALLBACK_MAX)
  const [deploying, setDeploying] = useState(false)
  const [deployError, setDeployError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (!editApp && !seed && !template?.spec) return
    const c = editApp ? editApp.config : seed ? seed : initConfig(template!)
    // Auto-substitute a renamed/removed image for a fresh catalog install.
    if (!editApp && !seed && imageOverride?.repo) {
      const { image, tag } = splitImage(imageOverride.repo)
      c.image = image
      c.tag = tag
    }
    setConfig(c)
    setRender(null)
    setError(null)
    setRaw(false)
    setDeployError(null)
    api.dockerNetworks().then((r) => setNetworks(r.options)).catch(() => {})
    api
      .metricsCurrent()
      .then((m) => {
        const totalMb = Math.floor(m.memory.total / (1024 * 1024))
        if (totalMb > 0) setMemMax(totalMb)
      })
      .catch(() => {})
    // Autofill the web-UI URLs from the first published port + detected IPs —
    // only for a fresh install (an edited app already carries its own URLs).
    const firstPort = c.ports.find((p) => p.host_port)?.host_port
    if (!editApp && !c.web_ui_lan && !c.web_ui_tailscale && firstPort) {
      api
        .systemInfo()
        .then((info) => {
          const lan = info.connectivity.lan_ip
          const ts = info.connectivity.tailscale_dns
          setConfig((prev) =>
            prev
              ? {
                  ...prev,
                  web_ui_lan: lan ? `http://${lan}:${firstPort}` : '',
                  web_ui_tailscale: ts ? `http://${ts}:${firstPort}` : '',
                }
              : prev,
          )
        })
        .catch(() => {})
    }
  }, [open, template, editApp, seed, imageOverride])

  const tplId = template?.id ?? editApp?.template_id ?? ''

  useEffect(() => {
    if (!config) return
    const h = setTimeout(() => {
      api
        .catalogRender(tplId, config)
        .then(setRender)
        .catch((e) => setError(e instanceof ApiError ? e.message : 'Render failed'))
    }, 300)
    return () => clearTimeout(h)
  }, [config, tplId])

  const issuesByField = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const i of render?.validation.issues ?? []) (m[i.field] ??= []).push(i.message)
    return m
  }, [render])

  if (!config) return null
  const appName = config.title || template?.name || 'app'
  const patch = (p: Partial<InstallConfig>) => setConfig({ ...config, ...p })
  const okToInstall = render?.validation.ok ?? false

  async function doDeploy() {
    if (!config || deploying) return
    setDeploying(true)
    setDeployError(null)
    try {
      if (editApp) await api.reconfigureApp(editApp.id, config)
      else await api.deployApp(tplId, config)
      onDeployed?.()
      onClose()
    } catch (e) {
      if (e instanceof ApiError) {
        const d = e.detail as { output?: string } | null
        setDeployError(e.message + (d?.output ? `\n\n${d.output}` : ''))
      } else {
        setDeployError('Deploy failed')
      }
    } finally {
      setDeploying(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} side labelledBy="install-title">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-3">
            <AppIcon icon={config.icon} size={32} />
            <h2 id="install-title" className="truncate font-semibold text-slate-900 dark:text-slate-100">
              {editApp ? 'Reconfigure' : 'Configure'} {appName}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
        </div>

        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2 text-xs dark:border-slate-800">
          <button type="button" onClick={() => setRaw(false)} className={tab(!raw)}>Form</button>
          <button type="button" onClick={() => setRaw(true)} className={tab(raw)}>Raw compose</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

          {!editApp && !seed && imageOverride?.repo && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
              ⚠ The catalog's original image was not found on Docker Hub, so it was
              auto-substituted with <span className="font-mono">{imageOverride.repo}</span> ({imageOverride.reason}){' '}
              Double-check it's the right project before deploying — you can edit the image field below.
            </div>
          )}

          {raw ? (
            <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-200">{render?.compose_yaml ?? 'Rendering…'}</pre>
          ) : (
            <div className="space-y-5 text-sm">
              <div className="grid grid-cols-3 gap-3">
                <Field label="Docker image" required className="col-span-2" err={issuesByField['image']}>
                  <input value={config.image} onChange={(e) => patch({ image: e.target.value })} placeholder="linuxserver/jellyfin" className={inp} />
                </Field>
                <Field label="Tag">
                  <input value={config.tag} onChange={(e) => patch({ tag: e.target.value })} placeholder="latest" className={inp} />
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Field label="Title" required className="col-span-2" err={issuesByField['title']}>
                  <input value={config.title} onChange={(e) => patch({ title: e.target.value, name: slugify(e.target.value) })} className={inp} />
                </Field>
                <Field label="Preview">
                  <div className="flex h-10 items-center"><AppIcon icon={config.icon} size={28} /></div>
                </Field>
              </div>

              <Field label="Icon URL" hint="Image URL (CasaOS-style) or emoji">
                <input value={config.icon} onChange={(e) => patch({ icon: e.target.value })} placeholder="https://…/icon.png" className={inp} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Web UI (LAN)"><input value={config.web_ui_lan} onChange={(e) => patch({ web_ui_lan: e.target.value })} placeholder="http://192.168.1.x:PORT" className={inp} /></Field>
                <Field label="Web UI (Tailscale)"><input value={config.web_ui_tailscale} onChange={(e) => patch({ web_ui_tailscale: e.target.value })} placeholder="http://host.ts.net:PORT" className={inp} /></Field>
              </div>

              <Field label="Network interface">
                <select value={config.network} onChange={(e) => patch({ network: e.target.value })} className={inp}>
                  {networks.length === 0 && <option value={config.network}>{config.network || 'bridge'}</option>}
                  {networks.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
                </select>
              </Field>

              <RowGroup
                title="Ports (host → container)"
                rows={config.ports}
                onAdd={() => patch({ ports: [...config.ports, { host_port: '', container_port: '', protocol: 'tcp' }] })}
                onRemove={(i) => patch({ ports: config.ports.filter((_, j) => j !== i) })}
                render={(p, i) => (
                  <>
                    <input value={p.host_port} onChange={(e) => patch({ ports: config.ports.map((x, j) => (j === i ? { ...x, host_port: e.target.value } : x)) })} placeholder="host" className={`w-24 ${inp} ${issuesByField[`port:${p.host_port}`] ? 'border-red-500' : ''}`} />
                    <span className="text-slate-400">→</span>
                    <input value={p.container_port} onChange={(e) => patch({ ports: config.ports.map((x, j) => (j === i ? { ...x, container_port: e.target.value } : x)) })} placeholder="container" className={`w-24 ${inp}`} />
                    <select value={p.protocol} onChange={(e) => patch({ ports: config.ports.map((x, j) => (j === i ? { ...x, protocol: e.target.value } : x)) })} className={`w-20 ${inp}`}>
                      <option value="tcp">tcp</option><option value="udp">udp</option>
                    </select>
                  </>
                )}
              />

              <RowGroup
                title="Volumes (host → container)"
                rows={config.volumes}
                onAdd={() => patch({ volumes: [...config.volumes, { source: '', container_path: '', type: 'bind', readonly: false }] })}
                onRemove={(i) => patch({ volumes: config.volumes.filter((_, j) => j !== i) })}
                render={(v, i) => (
                  <>
                    <input value={v.source} onChange={(e) => patch({ volumes: config.volumes.map((x, j) => (j === i ? { ...x, source: e.target.value } : x)) })} placeholder="host path / volume" className={`flex-1 ${inp}`} />
                    <span className="text-slate-400">→</span>
                    <input value={v.container_path} onChange={(e) => patch({ volumes: config.volumes.map((x, j) => (j === i ? { ...x, container_path: e.target.value } : x)) })} placeholder="/container" className={`flex-1 ${inp}`} />
                    <label className="flex items-center gap-1 text-xs text-slate-500"><input type="checkbox" checked={!!v.readonly} onChange={(e) => patch({ volumes: config.volumes.map((x, j) => (j === i ? { ...x, readonly: e.target.checked } : x)) })} />ro</label>
                  </>
                )}
              />

              <RowGroup
                title="Environment variables"
                rows={config.env}
                onAdd={() => patch({ env: [...config.env, { name: '', value: '' }] })}
                onRemove={(i) => patch({ env: config.env.filter((_, j) => j !== i) })}
                render={(e, i) => (
                  <>
                    <input
                      value={e.name ? `${e.name}=${e.value}` : ''}
                      onChange={(ev) => {
                        const raw = ev.target.value
                        const eq = raw.indexOf('=')
                        const name = eq >= 0 ? raw.slice(0, eq) : raw
                        const value = eq >= 0 ? raw.slice(eq + 1) : ''
                        patch({ env: config.env.map((x, j) => (j === i ? { ...x, name, value } : x)) })
                      }}
                      placeholder="NAME=value"
                      className={`flex-1 font-mono ${inp} ${issuesByField[`env:${e.name}`] ? 'border-red-500' : ''}`}
                      title={e.description}
                    />
                    {e.required && <span className="text-[10px] text-red-500">req</span>}
                  </>
                )}
              />

              <RowGroup
                title="Devices (host → container)"
                rows={config.devices}
                onAdd={() => patch({ devices: [...config.devices, { host: '', container: '' }] })}
                onRemove={(i) => patch({ devices: config.devices.filter((_, j) => j !== i) })}
                render={(d, i) => (
                  <>
                    <input value={d.host} onChange={(e) => patch({ devices: config.devices.map((x, j) => (j === i ? { ...x, host: e.target.value } : x)) })} placeholder="/dev/dri" className={`flex-1 ${inp}`} />
                    <span className="text-slate-400">→</span>
                    <input value={d.container} onChange={(e) => patch({ devices: config.devices.map((x, j) => (j === i ? { ...x, container: e.target.value } : x)) })} placeholder="/dev/dri" className={`flex-1 ${inp}`} />
                  </>
                )}
              />

              <RowGroup
                title="Capabilities (cap-add)"
                rows={config.cap_add}
                onAdd={() => patch({ cap_add: [...config.cap_add, ''] })}
                onRemove={(i) => patch({ cap_add: config.cap_add.filter((_, j) => j !== i) })}
                render={(c, i) => (
                  <>
                    <input list="caps-list" value={c} onChange={(e) => patch({ cap_add: config.cap_add.map((x, j) => (j === i ? e.target.value : x)) })} placeholder="NET_ADMIN" className={`w-48 font-mono ${inp}`} />
                  </>
                )}
              />
              <datalist id="caps-list">{COMMON_CAPS.map((c) => <option key={c} value={c} />)}</datalist>

              <Field label="Container command" hint="Startup command override (optional)">
                <input value={config.command} onChange={(e) => patch({ command: e.target.value })} className={`font-mono ${inp}`} />
              </Field>

              <label className="flex items-center gap-2"><input type="checkbox" checked={config.privileged} onChange={(e) => patch({ privileged: e.target.checked })} /><span className="text-slate-700 dark:text-slate-300">Privileged mode</span></label>

              <Field label={`Memory limit: ${config.mem_limit_mb ? `${config.mem_limit_mb} MB` : 'Unlimited'}`} hint={`Host total: ${memMax} MB`}>
                <input type="range" min={0} max={memMax} step={256} value={Math.min(config.mem_limit_mb ?? 0, memMax)} onChange={(e) => patch({ mem_limit_mb: Number(e.target.value) || null })} className="w-full" />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="CPU shares">
                  <select value={config.cpu_shares == null ? '' : String(config.cpu_shares)} onChange={(e) => patch({ cpu_shares: e.target.value ? Number(e.target.value) : null })} className={inp}>
                    {CPU_OPTIONS.map((o) => <option key={o.label} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
                <Field label="Restart policy">
                  <select value={config.restart_policy} onChange={(e) => patch({ restart_policy: e.target.value })} className={inp}>
                    {RESTART_POLICIES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </Field>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-slate-200 p-4 dark:border-slate-800">
          {render && !okToInstall && (
            <ul className="max-h-24 space-y-1 overflow-y-auto text-xs text-red-500">
              {render.validation.issues.map((i, k) => <li key={k}>• {i.message}</li>)}
            </ul>
          )}
          {deployError && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{deployError}</pre>
          )}
          <button
            type="button"
            disabled={!okToInstall || deploying}
            onClick={doDeploy}
            className="w-full rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-slate-700 dark:disabled:text-slate-300"
          >
            {deploying
              ? editApp
                ? 'Saving…'
                : 'Deploying…'
              : okToInstall
                ? editApp
                  ? 'Save & recreate'
                  : `Deploy ${appName}`
                : 'Resolve issues to deploy'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

const inp =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'

function tab(active: boolean): string {
  return 'rounded-md px-3 py-1 font-medium ' + (active ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800')
}

function Field({ label, hint, required, err, className = '', children }: { label: string; hint?: string; required?: boolean; err?: string[]; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </span>
      {children}
      {err && err.length > 0 && <span className="mt-0.5 block text-xs text-red-500">{err[0]}</span>}
      {hint && !err?.length && <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

function RowGroup<T>({ title, rows, onAdd, onRemove, render }: { title: string; rows: T[]; onAdd: () => void; onRemove: (i: number) => void; render: (row: T, i: number) => React.ReactNode }) {
  return (
    <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <legend className="flex items-center gap-2 px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</span>
        <button type="button" onClick={onAdd} className="rounded bg-slate-100 px-1.5 text-xs font-medium text-sky-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-sky-400">+ add</button>
      </legend>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">None</p>
      ) : (
        rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            {render(row, i)}
            <button type="button" onClick={() => onRemove(i)} className="ml-auto shrink-0 rounded px-1.5 text-xs text-slate-400 hover:text-red-500" aria-label="Remove">✕</button>
          </div>
        ))
      )}
    </fieldset>
  )
}
