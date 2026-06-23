import { useEffect, useState } from 'react'
import { ApiError, api, type CatalogTemplate } from '../lib/api'
import { Modal } from './Modal'
import { AppIcon } from './AppIcon'

// Read-only template detail (browse). Configure-and-install is wired in a later
// step; the button is present but disabled for now.
export function TemplateDetailDrawer({
  templateId,
  open,
  onClose,
}: {
  templateId: string | null
  open: boolean
  onClose: () => void
}) {
  const [t, setT] = useState<CatalogTemplate | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !templateId) return
    setT(null)
    setError(null)
    api
      .catalogTemplate(templateId)
      .then(setT)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load template'))
  }, [open, templateId])

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
            disabled
            title="Configuration form & deploy land in the next step"
            className="w-full cursor-not-allowed rounded-lg bg-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300"
          >
            Configure &amp; install — coming next
          </button>
        </div>
      </div>
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
