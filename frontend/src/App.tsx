import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { api } from './lib/api'
import { useAuth } from './lib/auth'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Docker } from './pages/Docker'
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
  if (!user) {
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
