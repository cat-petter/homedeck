import { useEffect, useState } from 'react'
import { ApiError, api, type CatalogApp, type CatalogTemplate } from '../lib/api'
import { Modal } from './Modal'
import { AppIcon } from './AppIcon'
import { InstallConfigForm } from './InstallConfigForm'

// Template detail (browse). For apps with multiple image variants (official vs
// linuxserver) a selector switches between them. "Configure & install" opens the
// pre-install config form.
export function TemplateDetailDrawer({
  app,
  open,
  onClose,
  onDeployed,
}: {
  app: CatalogApp | null
  open: boolean
  onClose: () => void
  onDeployed?: () => void
}) {
  const [t, setT] = useState<CatalogTemplate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [variantId, setVariantId] = useState<string | null>(null)
  const [configuring, setConfiguring] = useState(false)

  useEffect(() => {
    if (open && app) setVariantId(app.primary_id)
  }, [open, app])

  useEffect(() => {
    if (!open || !variantId) return
    setT(null)
    setError(null)
    api
      .catalogTemplate(variantId)
      .then(setT)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load template'))
  }, [open, variantId])

  return (
    <Modal open={open} onClose={onClose} side labelledBy="tpl-title">
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-3">
            <AppIcon icon={t?.logo ?? ''} size={36} />
            <div className="min-w-0">
              <h2 id="tpl-title" className="truncate font-semibold text-slate-900 dark:text-slate-100">
                {t?.name ?? 'Loading…'}
              </h2>
              <div className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">{t?.image}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 text-sm">
          {error && <p className="text-red-500">{error}</p>}
          {!t && !error && <p className="text-slate-400">Loading…</p>}
          {t && (
            <div className="space-y-5">
              {t.description && <p className="text-slate-600 dark:text-slate-300">{t.description}</p>}

              {app && app.variant_count > 1 && (
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Variant ({app.variant_count})
                  </span>
                  <select
                    value={variantId ?? ''}
                    onChange={(e) => setVariantId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {app.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.image || 'compose stack'} ({v.source})
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="flex flex-wrap gap-2">
                {t.kind === 'stack' && (
                  <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                    compose stack
                  </Badge>
                )}
                {t.categories.map((c) => (
                  <Badge key={c} className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {c}
                  </Badge>
                ))}
              </div>

              {t.spec && (
                <>
                  <Section title={`Ports (${t.spec.ports.length})`}>
                    {t.spec.ports.length === 0 ? (
                      <Empty />
                    ) : (
                      t.spec.ports.map((p, i) => (
                        <div key={i} className="font-mono text-xs">
                          {p.host_port ? `${p.host_port}:` : ''}
                          {p.container_port}/{p.protocol}
                        </div>
                      ))
                    )}
                  </Section>

                  <Section title={`Environment (${t.spec.env.length})`}>
                    {t.spec.env.length === 0 ? (
                      <Empty />
                    ) : (
                      t.spec.env.map((e) => (
                        <div key={e.name} className="mb-1">
                          <span className="font-mono text-xs text-sky-600 dark:text-sky-400">{e.name}</span>
                          {e.required && <span className="ml-1 text-[10px] text-red-500">required</span>}
                          {e.default && <span className="ml-1 font-mono text-xs text-slate-400">= {e.default}</span>}
                          {e.label && e.label !== e.name && (
                            <div className="text-xs text-slate-500 dark:text-slate-400">{e.label}</div>
                          )}
                        </div>
                      ))
                    )}
                  </Section>

                  <Section title={`Volumes (${t.spec.volumes.length})`}>
                    {t.spec.volumes.length === 0 ? (
                      <Empty />
                    ) : (
                      t.spec.volumes.map((v, i) => (
                        <div key={i} className="font-mono text-xs">
                          {v.bind ? `${v.bind} → ` : `[volume] `}
                          {v.container_path}
                          {v.readonly ? ' (ro)' : ''}
                        </div>
                      ))
                    )}
                  </Section>

                  {(t.spec.restart_policy || t.spec.network) && (
                    <Section title="Runtime">
                      {t.spec.restart_policy && <KV k="Restart" v={t.spec.restart_policy} />}
                      {t.spec.network && <KV k="Network" v={t.spec.network} />}
                    </Section>
                  )}
                </>
              )}

              <div className="text-xs text-slate-400">
                Source: {t.source}
                {t.source_url && (
                  <>
                    {' · '}
                    <a href={t.source_url} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline dark:text-sky-400">
                      attribution
                    </a>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 p-4 dark:border-slate-800">
          <button
            type="button"
            disabled={!t || t.kind === 'stack' || !t.image}
            onClick={() => setConfiguring(true)}
            title={t?.kind === 'stack' ? 'Compose-stack templates are not installable yet' : undefined}
            className="w-full rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-slate-700 dark:disabled:text-slate-300"
          >
            {t?.kind === 'stack' ? 'Stack install — coming later' : 'Configure & install'}
          </button>
        </div>
      </div>

      <InstallConfigForm
        template={t}
        open={configuring}
        onClose={() => setConfiguring(false)}
        onDeployed={() => {
          setConfiguring(false)
          onClose()
          onDeployed?.()
        }}
      />
    </Modal>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h3>
      <div className="space-y-0.5 text-slate-700 dark:text-slate-200">{children}</div>
    </div>
  )
}
function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3 text-xs">
      <span className="w-20 text-slate-500 dark:text-slate-400">{k}</span>
      <span className="font-mono">{v}</span>
    </div>
  )
}
function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{children}</span>
}
function Empty() {
  return <span className="text-xs text-slate-400">None</span>
}
