// Light/dark theme toggle button. Persists the choice via lib/theme and flips the
// `.dark` class on <html>.
import { useState } from 'react'
import { getTheme, toggleTheme, type Theme } from '../lib/theme'

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getTheme())

  return (
    <button
      type="button"
      onClick={() => setTheme(toggleTheme())}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
    >
      {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
    </button>
  )
}
