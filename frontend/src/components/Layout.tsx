import type { ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import { ThemeToggle } from './ThemeToggle'

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()

  return (
    <div className="min-h-full bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🛰️</span>
            <span className="text-lg font-semibold tracking-tight">HomeDeck</span>
          </div>
          <div className="flex items-center gap-3">
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
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  )
}
