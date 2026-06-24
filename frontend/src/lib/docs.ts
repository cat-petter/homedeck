// Best-effort "documentation" link for a catalog app, derived from its image
// reference (and the template's repo URL when present). Points at the place an
// app's README / usage docs actually live — not guaranteed to be install steps,
// just the app's home. External; opens in a new tab.

export interface DocsLink {
  href: string
  label: string
}

export function appDocsLink(image: string | undefined, repoUrl?: string | null): DocsLink | null {
  // Prefer docs derived from the image — it points at the actual app. The
  // template's repository URL is only a fallback, because for stack templates
  // it usually points at the catalog list's own repo (a wall of images), not
  // the app's docs.
  const fromImage = imageDocsLink(image)
  if (fromImage) return fromImage
  if (repoUrl && /^https?:\/\//i.test(repoUrl)) {
    return { href: repoUrl, label: 'Source repository' }
  }
  return null
}

function imageDocsLink(image: string | undefined): DocsLink | null {
  if (!image) return null

  // Parse registry / repository (strip digest + tag).
  let ref = image.split('@')[0]
  let registry = 'docker.io'
  const slash = ref.indexOf('/')
  const first = slash === -1 ? '' : ref.slice(0, slash)
  if (first && (first.includes('.') || first.includes(':') || first === 'localhost')) {
    registry = first
    ref = ref.slice(slash + 1)
  }
  const lastSeg = ref.slice(ref.lastIndexOf('/') + 1)
  const repo = lastSeg.includes(':') ? ref.slice(0, ref.lastIndexOf(':')) : ref
  const name = repo.slice(repo.lastIndexOf('/') + 1).toLowerCase()

  // LinuxServer images have excellent per-image docs.
  if (registry === 'lscr.io' || repo.toLowerCase().startsWith('linuxserver/')) {
    return { href: `https://docs.linuxserver.io/images/docker-${name}/`, label: 'LinuxServer docs' }
  }
  // GitHub Container Registry maps to a GitHub repo.
  if (registry === 'ghcr.io') {
    return { href: `https://github.com/${repo}`, label: 'Project on GitHub' }
  }
  // Docker Hub: official (no namespace / library/) vs user repo.
  if (registry === 'docker.io') {
    const r = repo.startsWith('library/') ? repo.slice('library/'.length) : repo
    const href = r.includes('/') ? `https://hub.docker.com/r/${r}` : `https://hub.docker.com/_/${r}`
    return { href, label: 'Docs & README on Docker Hub' }
  }
  // Some other registry — link to its repo page best-effort.
  return { href: `https://${registry}/${repo}`, label: 'Image registry' }
}
