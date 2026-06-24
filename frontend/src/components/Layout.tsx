import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { getAccessMode } from '../lib/access'
import { ThemeToggle } from './ThemeToggle'

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/docker', label: 'Docker', end: false },
  { to: '/system', label: 'System', end: false },
  { to: '/health', label: 'Health', end: false },
  { to: '/store', label: 'App Store', end: false },
  { to: '/settings', label: 'Settings', end: false },
]

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()

  return (
    <div className="min-h-full bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2">
              <span className="text-xl">🛰️</span>
              <span className="text-lg font-semibold tracking-tight">HomeDeck</span>
            </div>
            <nav className="flex items-center gap-1">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    'rounded-lg px-3 py-1.5 text-sm font-medium ' +
                    (isActive
                      ? 'bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800')
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <ConnectionBadge />
            <ThemeToggle />
            {user && (
              <>
                <span className="hidden text-sm text-slate-500 sm:inline dark:text-slate-400">
                  {user.username}
                </span>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600"
                >
                  Log out
                </button>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  )
}

function ConnectionBadge() {
  const mode = getAccessMode()
  const tailscale = mode === 'tailscale'
  return (
    <span
      title={`You reached HomeDeck via ${tailscale ? 'Tailscale' : 'your LAN'}`}
      className={
        'hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium sm:inline-flex ' +
        (tailscale
          ? 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300'
          : 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300')
      }
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tailscale ? 'bg-violet-500' : 'bg-emerald-500'}`} />
      {tailscale ? 'Tailscale' : 'LAN'}
    </span>
  )
}
