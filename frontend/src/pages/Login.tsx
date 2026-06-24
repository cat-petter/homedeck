// Login page: posts credentials, then routes back to wherever the user was headed.
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { AuthShell, Field, SubmitButton } from './Setup'

export function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(username, password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Sign in to HomeDeck">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Username" value={username} onChange={setUsername} autoFocus autoComplete="username" />
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <SubmitButton busy={busy}>Sign in</SubmitButton>
      </form>
    </AuthShell>
  )
}
