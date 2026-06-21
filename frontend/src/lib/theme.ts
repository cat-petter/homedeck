// Dark/light theme: persisted in localStorage, applied as a `.dark` class on
// <html>. Dark is the default (also applied by an inline script in index.html).

const KEY = 'homedeck-theme'

export type Theme = 'dark' | 'light'

export function getTheme(): Theme {
  const stored = localStorage.getItem(KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return 'dark'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  localStorage.setItem(KEY, theme)
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  return next
}
