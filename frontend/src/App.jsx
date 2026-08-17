import { useEffect, useState } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { useCurrentUser } from './auth/useCurrentUser'
import { completeOnboarding, TUTOR_MX_ROLES } from './api/onboarding'
import { PasswordResetPage, NewPasswordPage } from './features/PasswordReset'
import { RoleRouter } from './routes/RoleRouter'
import './App.css'

const PENDING_ROLE_KEY = 'tutormx.pendingRole'

const ROLE_DETAILS = Object.freeze({
  STUDENT: { title: 'Student', icon: 'student' },
  TUTOR: { title: 'Tutor', icon: 'tutor' },
  ORGANISER: { title: 'Organiser', icon: 'organiser' },
})

function storedPendingRole() {
  const value = window.sessionStorage.getItem(PENDING_ROLE_KEY)
  return TUTOR_MX_ROLES.includes(value) ? value : null
}

function LoadingCard({ message }) {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-live="polite">
        <Brand />
        <h1 className="auth-title">{message}</h1>
      </section>
    </main>
  )
}

function Brand() {
  return (
    <div className="auth-brand" aria-label="Tutor Mx">
      <span className="brand-mark" aria-hidden="true">TM</span>
      <span className="brand-name">Tutor Mx</span>
    </div>
  )
}

function RoleIcon({ role }) {
  if (role === 'STUDENT') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3 2 8l10 5 8-4v6h2V8L12 3Zm-6 9.2V16c0 2.2 2.7 4 6 4s6-1.8 6-4v-3.8l-6 3-6-3Z" />
      </svg>
    )
  }

  if (role === 'TUTOR') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0H5Zm14.8-8.3 1.4 1.4-3.9 3.9-2-2 1.4-1.4.6.6 2.5-2.5Z" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z" />
    </svg>
  )
}

function RoleChoices({ selectedRole, onSelect, heading = 'Choose your role' }) {
  return (
    <fieldset className="role-choice-fieldset">
      <legend>{heading}</legend>
      <div className="role-choice-grid">
        {TUTOR_MX_ROLES.map((role) => (
          <button
            key={role}
            type="button"
            className={`role-choice-card${selectedRole === role ? ' selected' : ''}`}
            aria-pressed={selectedRole === role}
            aria-label={ROLE_DETAILS[role].title}
            onClick={() => onSelect(role)}
          >
            <span className={`role-icon role-icon-${ROLE_DETAILS[role].icon}`}>
              <RoleIcon role={role} />
            </span>
            <strong>{ROLE_DETAILS[role].title}</strong>
            <span className="role-check" aria-hidden="true">✓</span>
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function AuthEntry({ handleAuthRedirect, isSubmitting, status, selectedRole, onSelectRole }) {
  const label = selectedRole ? ROLE_DETAILS[selectedRole].title : ''

  return (
    <main className="auth-shell">
      <section className="auth-card auth-card-entry" aria-labelledby="auth-heading">
        <Brand />

        <div className="auth-header">
          <h1 id="auth-heading" className="auth-title">Welcome</h1>
          <p className="auth-subtitle">Choose your role to get started.</p>
        </div>

        <RoleChoices selectedRole={selectedRole} onSelect={onSelectRole} />

        <div className="auth-actions auth-actions-entry">
          <button
            type="button"
            className="primary-button create-account-button"
            onClick={() => handleAuthRedirect('signup')}
            disabled={isSubmitting || !selectedRole}
          >
            {isSubmitting && selectedRole
              ? 'Opening...'
              : selectedRole
                ? `Create ${label} account`
                : 'Choose a role'}
          </button>

          <button
            type="button"
            className="secondary-button sign-in-button"
            aria-label="Sign in with Auth0"
            onClick={() => handleAuthRedirect('login')}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Opening...' : 'Sign in'}
          </button>

          <Link className="text-link auth-forgot-link" to="/reset-password">Forgot password?</Link>
        </div>

        {status.message && status.type === 'error' && (
          <p className="status-message error" aria-live="polite">{status.message}</p>
        )}
      </section>
    </main>
  )
}

function OnboardingCard({ role, onComplete, onSignOut }) {
  const { getAccessTokenSilently } = useAuth0()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ status: 'loading', message: '' })

  useEffect(() => {
    let ignore = false

    async function provision() {
      setState({ status: 'loading', message: `Setting up your ${ROLE_DETAILS[role].title} account...` })
      try {
        await completeOnboarding(role, getAccessTokenSilently)
        if (ignore) return
        window.sessionStorage.removeItem(PENDING_ROLE_KEY)
        setState({ status: 'success', message: 'Your Tutor Mx account is ready.' })
        onComplete()
      } catch (error) {
        if (ignore) return
        setState({
          status: 'error',
          message: error?.code === 'EMAIL_NOT_VERIFIED'
            ? 'Verify your email using the Auth0 verification email, then click Try again.'
            : error?.message || 'Your Tutor Mx account could not be set up. Please try again.',
        })
      }
    }

    provision()
    return () => { ignore = true }
  }, [role, attempt, getAccessTokenSilently, onComplete])

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-live="polite">
        <Brand />
        <h1 className="auth-title">Setting up your account</h1>
        <p className={`status-message ${state.status}`}>{state.message}</p>
        {state.status === 'error' && (
          <div className="auth-actions">
            <button type="button" className="primary-button" onClick={() => setAttempt((v) => v + 1)}>Try again</button>
            <button type="button" className="secondary-button" onClick={onSignOut}>Sign out</button>
          </div>
        )}
      </section>
    </main>
  )
}

function FinishSetupCard({ onChooseRole, onSignOut }) {
  const [selectedRole, setSelectedRole] = useState(null)

  return (
    <main className="auth-shell">
      <section className="auth-card auth-card-entry">
        <Brand />
        <div className="auth-header">
          <h1 className="auth-title">Choose your role</h1>
          <p className="auth-subtitle">Finish setting up your Tutor Mx account.</p>
        </div>
        <RoleChoices selectedRole={selectedRole} onSelect={setSelectedRole} heading="Account role" />
        <div className="auth-actions">
          <button type="button" className="primary-button" disabled={!selectedRole} onClick={() => onChooseRole(selectedRole)}>Continue</button>
          <button type="button" className="secondary-button" onClick={onSignOut}>Sign out</button>
        </div>
      </section>
    </main>
  )
}

function App() {
  const { isAuthenticated, loginWithRedirect, logout, isLoading } = useAuth0()
  const [pendingRole, setPendingRole] = useState(() => storedPendingRole())
  const [selectedRole, setSelectedRole] = useState(null)
  const { role: currentRole, loading: userLoading, error: userError, errorCode: userErrorCode } = useCurrentUser({ enabled: !pendingRole })
  const [status, setStatus] = useState({ type: 'idle', message: '' })
  const [isSubmitting, setIsSubmitting] = useState(false)

  const rememberPendingRole = (role) => {
    window.sessionStorage.setItem(PENDING_ROLE_KEY, role)
    setPendingRole(role)
  }

  const handleAuthRedirect = async (mode = 'login') => {
    if (isSubmitting) return
    if (mode === 'signup' && !selectedRole) {
      setStatus({ type: 'error', message: 'Choose Student, Tutor or Organiser first.' })
      return
    }

    setIsSubmitting(true)
    setStatus({ type: 'loading', message: '' })

    if (mode === 'signup') {
      window.sessionStorage.setItem(PENDING_ROLE_KEY, selectedRole)
    } else {
      window.sessionStorage.removeItem(PENDING_ROLE_KEY)
      setPendingRole(null)
    }

    try {
      await loginWithRedirect({
        authorizationParams: { screen_hint: mode === 'signup' ? 'signup' : 'login' },
        appState: { targetUrl: '/' },
      })
    } catch {
      if (mode === 'signup') window.sessionStorage.removeItem(PENDING_ROLE_KEY)
      setStatus({ type: 'error', message: 'Authentication could not be started. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSignOut = () => {
    window.sessionStorage.removeItem(PENDING_ROLE_KEY)
    setPendingRole(null)
    logout({ logoutParams: { returnTo: window.location.origin } })
  }

  if (isLoading) return <LoadingCard message="Checking your session..." />

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/reset-password" element={<PasswordResetPage />} />
        <Route path="/new-password" element={<NewPasswordPage />} />
        <Route
          path="*"
          element={(
            <AuthEntry
              handleAuthRedirect={handleAuthRedirect}
              isSubmitting={isSubmitting}
              status={status}
              selectedRole={selectedRole}
              onSelectRole={setSelectedRole}
            />
          )}
        />
      </Routes>
    )
  }

  if (pendingRole) return <OnboardingCard role={pendingRole} onComplete={() => setPendingRole(null)} onSignOut={handleSignOut} />
  if (userLoading) return <LoadingCard message="Loading your workspace..." />
  if (userErrorCode === 'PROFILE_NOT_FOUND') return <FinishSetupCard onChooseRole={rememberPendingRole} onSignOut={handleSignOut} />

  if (userError || !currentRole) {
    return (
      <main className="auth-shell">
        <section className="auth-card" role="alert">
          <Brand />
          <h1 className="auth-title">Access unavailable</h1>
          <p className="auth-subtitle">{userError || 'Your account does not have a permitted Tutor Mx role.'}</p>
          <button type="button" className="primary-button" onClick={handleSignOut}>Sign out</button>
        </section>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <RoleRouter currentRole={currentRole} onSignOut={handleSignOut} />
    </div>
  )
}

export default App
