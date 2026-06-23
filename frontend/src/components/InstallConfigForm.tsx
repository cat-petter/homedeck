import { useEffect, useMemo, useState } from 'react'
import {
  ApiError,
  api,
  type CatalogTemplate,
  type InstallConfig,
  type RenderResult,
} from '../lib/api'
import { Modal } from './Modal'

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^[-_.]+|[-_.]+$/g, '') || 'app'
}

function initConfig(t: CatalogTemplate): InstallConfig {
  const name = slugify(t.name)
  const spec = t.spec!
  return {
    name,
    image: t.image,
    restart_policy: spec.restart_policy || 'unless-stopped',
    network: spec.network || '',
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
      source:
        v.bind ||
        (v.type === 'bind'
          ? `/DATA/AppData/${name}${v.container_path}`
          : `${name}${slugify(v.container_path)}`),
    })),
  }
}

const RESTART_POLICIES = ['unless-stopped', 'always', 'on-failure', 'no']

export function InstallConfigForm({
  template,
  open,
  onClose,
}: {
  template: CatalogTemplate | null
  open: boolean
  onClose: () => void
}) {
  const [config, setConfig] = useState<InstallConfig | null>(null)
  const [render, setRender] = useState<RenderResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [raw, setRaw] = useState(false)

  useEffect(() => {
    if (open && template?.spec) {
      setConfig(initConfig(template))
      setRender(null)
      setError(null)
      setRaw(false)
    }
  }, [open, template])

  // Debounced render/validate on config changes.
  useEffect(() => {
    if (!config || !template) return
    const h = setTimeout(() => {
      api
        .catalogRender(template.id, config)
        .then(setRender)
        .catch((e) => setError(e instanceof ApiError ? e.message : 'Render failed'))
    }, 300)
    return () => clearTimeout(h)
  }, [config, template])

  const issuesByField = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const i of render?.validation.issues ?? []) {
      ;(m[i.field] ??= []).push(i.message)
    }
    return m
  }, [render])

  if (!config || !template) return null

  const patch = (p: Partial<InstallConfig>) => setConfig({ ...config, ...p })
  const setPort = (i: number, host: string) => {
    const ports = config.ports.map((p, j) => (j === i ? { ...p, host_port: host } : p))
    patch({ ports })
  }
  const setEnv = (i: number, value: string) => {
    const env = config.env.map((e, j) => (j === i ? { ...e, value } : e))
    patch({ env })
  }
  const setVol = (i: number, source: string) => {
    const volumes = config.volumes.map((v, j) => (j === i ? { ...v, source } : v))
    patch({ volumes })
  }

  const okToInstall = render?.validation.ok ?? false

  return (
    <Modal open={open} onClose={onClose} side labelledBy="install-title">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0">
            <h2 id="install-title" className="truncate font-semibold text-slate-900 dark:text-slate-100">
              Configure {template.name}
            </h2>
            <div className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">{template.image}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            ✕
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2 text-xs dark:border-slate-800">
          <button type="button" onClick={() => setRaw(false)} className={tab(!raw)}>Form</button>
          <button type="button" onClick={() => setRaw(true)} className={tab(raw)}>Raw compose</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

          {raw ? (
            <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-200">
              {render?.compose_yaml ?? 'Rendering…'}
            </pre>
          ) : (
            <div className="space-y-5 text-sm">
              <Field label="Container name">
                <input value={config.name} onChange={(e) => patch({ name: e.target.value })} className={inputCls} />
              </Field>

              {config.ports.length > 0 && (
                <Group title="Ports">
                  {config.ports.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        value={p.host_port}
                        onChange={(e) => setPort(i, e.target.value)}
                        placeholder="host"
                        className={`w-24 ${inputCls} ${issuesByField[`port:${p.host_port}`] ? 'border-red-500' : ''}`}
                      />
                      <span className="text-slate-400">→</span>
                      <span className="font-mono text-xs text-slate-600 dark:text-slate-300">
                        {p.container_port}/{p.protocol}
                      </span>
                    </div>
                  ))}
                </Group>
              )}

              {config.env.length > 0 && (
                <Group title="Environment">
                  {config.env.map((e, i) => (
                    <Field
                      key={e.name}
                      label={
                        <>
                          <span className="font-mono">{e.name}</span>
                          {e.required && <span className="ml-1 text-[10px] text-red-500">required</span>}
                        </>
                      }
                      hint={e.description}
                    >
                      <input
                        value={e.value}
                        onChange={(ev) => setEnv(i, ev.target.value)}
                        className={`${inputCls} ${issuesByField[`env:${e.name}`] ? 'border-red-500' : ''}`}
                      />
                    </Field>
                  ))}
                </Group>
              )}

              {config.volumes.length > 0 && (
                <Group title="Volumes">
                  {config.volumes.map((v, i) => (
                    <Field key={i} label={<span className="font-mono text-xs">{v.container_path}</span>} hint={v.type}>
                      <input value={v.source} onChange={(e) => setVol(i, e.target.value)} className={inputCls} />
                    </Field>
                  ))}
                </Group>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Network">
                  <input value={config.network} onChange={(e) => patch({ network: e.target.value })} placeholder="bridge" className={inputCls} />
                </Field>
                <Field label="Restart policy">
                  <select value={config.restart_policy} onChange={(e) => patch({ restart_policy: e.target.value })} className={inputCls}>
                    {RESTART_POLICIES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-slate-200 p-4 dark:border-slate-800">
          {render && !okToInstall && (
            <ul className="space-y-1 text-xs text-red-500">
              {render.validation.issues.map((i, k) => (
                <li key={k}>• {i.message}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled
            title="Deploy lands in the next step"
            className="w-full cursor-not-allowed rounded-lg bg-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300"
          >
            {okToInstall ? 'Deploy — coming next' : 'Resolve issues to deploy'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'

function tab(active: boolean): string {
  return (
    'rounded-md px-3 py-1 font-medium ' +
    (active ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800')
  )
}

function Field({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</legend>
      {children}
    </fieldset>
  )
}
