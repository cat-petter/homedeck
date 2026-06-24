// App shell: top navigation, theme toggle, LAN/Tailscale connection badge, and
// log-out. Wraps every authenticated page.
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { getAccessMode } from '../lib/access'
import { ThemeToggle } from './ThemeToggle'

const GearIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

type NavItem = { to: string; label: string; end: boolean; icon?: ReactNode }

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/docker', label: 'Docker', end: false },
  { to: '/system', label: 'System', end: false },
  { to: '/health', label: 'Health', end: false },
  { to: '/store', label: 'App Store', end: false },
  { to: '/settings', label: 'Settings', end: false, icon: GearIcon },
]

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()

  return (
    <div className="min-h-full bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3 sm:gap-5">
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xl">🛰️</span>
              <span className="hidden text-lg font-semibold tracking-tight sm:inline">HomeDeck</span>
            </div>
            <nav className="flex items-center gap-1 overflow-x-auto">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  title={item.icon ? item.label : undefined}
                  aria-label={item.icon ? item.label : undefined}
                  className={({ isActive }) =>
                    'shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ' +
                    (item.icon ? 'flex items-center ' : '') +
                    (isActive
                      ? 'bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800')
                  }
                >
                  {item.icon ?? item.label}
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
