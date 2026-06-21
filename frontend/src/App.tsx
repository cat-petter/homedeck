import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { api } from './lib/api'
import { useAuth } from './lib/auth'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Docker } from './pages/Docker'
import { Metrics } from './pages/Metrics'
import { Storage } from './pages/Storage'
import { Health } from './pages/Health'
import { Login } from './pages/Login'
import { Setup } from './pages/Setup'

function FullScreenMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 text-slate-500 dark:bg-slate-950 dark:text-slate-400">
      {children}
    </div>
  )
}

export default function App() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null)

  useEffect(() => {
    api
      .setupStatus()
      .then((s) => setNeedsSetup(s.needs_setup))
      .catch(() => setNeedsSetup(false))
  }, [])

  if (loading || needsSetup === null) {
    return <FullScreenMessage>Loading…</FullScreenMessage>
  }

  // Authenticated users go straight to the app — this also covers the moment
  // right after the setup wizard logs the admin in, even though the initially
  // fetched `needsSetup` flag is still stale-true.
  if (!user) {
    // First-run: force the setup wizard until an admin exists.
    if (needsSetup) {
      return (
        <Routes>
          <Route path="/setup" element={<Setup />} />
          <Route path="*" element={<Navigate to="/setup" replace />} />
        </Routes>
      )
    }
    // Setup complete but not logged in -> login.
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" state={{ from: location }} replace />} />
      </Routes>
    )
  }

  // Authenticated app.
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/docker" element={<Docker />} />
        <Route path="/system" element={<Metrics />} />
        <Route path="/storage" element={<Storage />} />
        <Route path="/health" element={<Health />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
