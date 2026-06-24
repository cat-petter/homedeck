import { useEffect, useState } from 'react'
import { ApiError, api, type CatalogTemplate } from '../lib/api'
import { Modal } from './Modal'
import { AppIcon } from './AppIcon'

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^[-_.]+|[-_.]+$/g, '') || 'app'
}

// Install a multi-service "stack" template: fetch its compose, let the user
// review/edit it, then deploy it verbatim with `docker compose up -d`.
export function StackInstallDrawer({
  template,
  open,
  onClose,
  onDeployed,
}: {
  template: CatalogTemplate | null
  open: boolean
  onClose: () => void
  onDeployed?: () => void
}) {
  const [title, setTitle] = useState('')
  const [name, setName] = useState('')
  const [lan, setLan] = useState('')
  const [ts, setTs] = useState('')
  const [compose, setCompose] = useState('')
  const [swarmish, setSwarmish] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [deployErr, setDeployErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !template) return
    setTitle(template.name)
    setName(slugify(template.name))
    setLan('')
    setTs('')
    setCompose('')
    setSwarmish(false)
    setDeployErr(null)
    setLoadErr(null)
    setLoading(true)
    let active = true
    api
      .stackCompose(template.id)
      .then((r) => {
        if (!active) return
        setCompose(r.compose_yaml)
        setSwarmish(r.swarmish)
      })
      .catch((e) => active && setLoadErr(e instanceof ApiError ? e.message : 'Could not fetch the stackfile'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [open, template])

  if (!template) return null

  async function deploy() {
    if (deploying) return
    setDeploying(true)
    setDeployErr(null)
    try {
      await api.deployStackCompose({
        name,
        compose_yaml: compose,
        title,
        icon: template!.logo,
        web_ui_lan: lan,
        web_ui_tailscale: ts,
        template_id: template!.id,
      })
      onDeployed?.()
      onClose()
    } catch (e) {
      if (e instanceof ApiError) {
        const d = e.detail as { output?: string } | null
        setDeployErr(e.message + (d?.output ? `\n\n${d.output}` : ''))
      } else {
        setDeployErr('Deploy failed')
      }
    } finally {
      setDeploying(false)
    }
  }

  const canDeploy = !!name && !!compose.trim() && !loading && !deploying

  return (
    <Modal open={open} onClose={onClose} side labelledBy="stack-title">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-3">
            <AppIcon icon={template.logo} size={32} />
            <h2 id="stack-title" className="truncate font-semibold text-slate-900 dark:text-slate-100">
              Install stack — {template.name}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
            This is a multi-service stack. HomeDeck fetched its compose file — review (and edit) it
            below, then it's deployed verbatim with <span className="font-mono">docker compose up -d</span>.
          </div>

          {swarmish && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
              ⚠ This looks like a Docker <strong>Swarm</strong> stack (overlay networks / <span className="font-mono">deploy:</span>).
              It may need edits to run under plain <span className="font-mono">docker compose</span> — check the output if it fails.
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Title">
              <input value={title} onChange={(e) => { setTitle(e.target.value); setName(slugify(e.target.value)) }} className={inp} />
            </Field>
            <Field label="Project name">
              <input value={name} onChange={(e) => setName(slugify(e.target.value))} className={`font-mono ${inp}`} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Web UI (LAN)" hint="optional"><input value={lan} onChange={(e) => setLan(e.target.value)} placeholder="http://192.168.1.x:PORT" className={inp} /></Field>
            <Field label="Web UI (Tailscale)" hint="optional"><input value={ts} onChange={(e) => setTs(e.target.value)} placeholder="http://host.ts.net:PORT" className={inp} /></Field>
          </div>

          <Field label="docker-compose.yml">
            {loading ? (
              <p className="text-slate-400">Fetching stackfile…</p>
            ) : loadErr ? (
              <p className="text-red-500">{loadErr}</p>
            ) : (
              <textarea
                value={compose}
                onChange={(e) => setCompose(e.target.value)}
                spellCheck={false}
                className="h-80 w-full resize-y rounded-lg border border-slate-300 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-200 outline-none focus:border-sky-500 dark:border-slate-700"
              />
            )}
          </Field>
        </div>

        <div className="space-y-2 border-t border-slate-200 p-4 dark:border-slate-800">
          {deployErr && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{deployErr}</pre>
          )}
          <button
            type="button"
            disabled={!canDeploy}
            onClick={deploy}
            className="w-full rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-slate-700 dark:disabled:text-slate-300"
          >
            {deploying ? 'Deploying…' : `Deploy ${title || template.name}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}

const inp =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
        {hint && <span className="ml-1 text-xs font-normal text-slate-400">({hint})</span>}
      </span>
      {children}
    </label>
  )
}
