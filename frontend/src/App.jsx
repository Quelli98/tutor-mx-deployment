import { useState } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { useCurrentUser } from './auth/useCurrentUser'
import { PasswordResetPage, NewPasswordPage } from './features/PasswordReset'
import { RoleRouter } from './routes/RoleRouter'
import './App.css'

function LoadingCard({ message }) {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-live="polite">
        <p className="eyebrow">Tutor Mx</p>
        <h1>{message}</h1>
      </section>
    </main>
  )
}

function AuthEntry({ handleAuthRedirect, isSubmitting, status }) {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-heading">
        <div className="auth-header">
          <p className="eyebrow">Tutor Mx</p>
          <h1 id="auth-heading">Welcome back</h1>
        </div>

        <p className="subtitle">
          Auth0 Universal Login securely handles the labelled email and password fields. Tutor Mx
          never receives or stores your password.
        </p>

        <div className="auth-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => handleAuthRedirect('login')}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Please wait...' : 'Sign in with Auth0'}
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={() => handleAuthRedirect('signup')}
            disabled={isSubmitting}
          >
            Create account
          </button>

          <Link className="text-link" to="/reset-password">
            Forgot your password?
          </Link>
        </div>

        {status.message && (
          <p className={`status-message ${status.type}`} aria-live="polite">
            {status.message}
          </p>
        )}
      </section>
    </main>
  )
}

function App() {
  const { isAuthenticated, loginWithRedirect, logout, isLoading } = useAuth0()
  const { role: currentRole, loading: userLoading, error: userError } = useCurrentUser()
  const [status, setStatus] = useState({ type: 'idle', message: '' })
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleAuthRedirect = async (mode = 'login') => {
    if (isSubmitting) return

    setIsSubmitting(true)
    setStatus({
      type: 'loading',
      message: mode === 'signup' ? 'Opening account creation...' : 'Redirecting to sign in...',
    })

    try {
      await loginWithRedirect({
        authorizationParams: { screen_hint: mode === 'signup' ? 'signup' : 'login' },
        appState: { targetUrl: '/' },
      })
      setStatus({
        type: 'success',
        message: mode === 'signup' ? 'Account creation started.' : 'Sign in started.',
      })
    } catch {
      setStatus({
        type: 'error',
        message: 'Authentication could not be started. Please try again.',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSignOut = () => {
    logout({ logoutParams: { returnTo: window.location.origin } })
  }

  if (isLoading) {
    return <LoadingCard message="Checking your session..." />
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/reset-password" element={<PasswordResetPage />} />
        <Route path="/new-password" element={<NewPasswordPage />} />
        <Route
          path="*"
          element={
            <AuthEntry
              handleAuthRedirect={handleAuthRedirect}
              isSubmitting={isSubmitting}
              status={status}
            />
          }
        />
      </Routes>
    )
  }

  if (userLoading) {
    return <LoadingCard message="Loading your workspace..." />
  }

  if (userError || !currentRole) {
    return (
      <main className="auth-shell">
        <section className="auth-card" role="alert">
          <p className="eyebrow">Tutor Mx</p>
          <h1>Access unavailable</h1>
          <p className="subtitle">
            Your account does not have a permitted Tutor Mx role. Sign out and contact support if
            this continues.
          </p>
          <button type="button" className="primary-button" onClick={handleSignOut}>
            Sign out
          </button>
        </section>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <RoleRouter currentRole={currentRole} />
      <button type="button" className="primary-button sign-out-button" onClick={handleSignOut}>
        Sign out
      </button>
    </div>
  )
}

export default App
