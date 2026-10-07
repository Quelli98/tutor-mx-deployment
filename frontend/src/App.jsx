import { invalidateSession } from './auth/sessionState'
import { useCallback, useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { useCurrentUser } from './auth/useCurrentUser'
import { completeOnboarding, resendVerificationEmail, TUTOR_MX_ROLES } from './api/onboarding'
import { getOwnOrganiserApplication } from './api/organiserApplications'
import { CsamMark } from './components/shared/CsamMark'
import { Landing } from './features/Landing'
import { PasswordResetPage, NewPasswordPage } from './features/PasswordReset'
import { RoleRouter } from './routes/RoleRouter'
import './App.css'

const PENDING_ROLE_KEY = 'tutormx.pendingRole'
const REQUESTED_SIGNIN_ROLE_KEY = 'tutormx.requestedSignInRole'

const ROLE_DETAILS = Object.freeze({
  STUDENT: { title: 'Student', icon: 'student' },
  TUTOR: { title: 'Tutor', icon: 'tutor' },
  ORGANISER: { title: 'Organiser', icon: 'organiser' },
})

function storedPendingRole() {
  const value = window.sessionStorage.getItem(PENDING_ROLE_KEY)
  return TUTOR_MX_ROLES.includes(value) ? value : null
}

function storedRequestedSignInRole() {
  const value = window.sessionStorage.getItem(REQUESTED_SIGNIN_ROLE_KEY)
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

const ONBOARDING_ERROR_MESSAGES = Object.freeze({
  EMAIL_NOT_VERIFIED: 'Verify your email using the Auth0 verification email, then click Sign in.',
})

function Brand() {
  return (
    <div className="auth-brand">
      <CsamMark className="brand-mark" />
      <span className="brand-name">CSAM Tutor Hub</span>
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

function OnboardingCard({ role, onComplete, onSignOut, onSignInAgain }) {
  const { getAccessTokenSilently } = useAuth0()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ status: 'loading', message: '', code: '' })
  const [resendState, setResendState] = useState({ status: 'idle', message: '' })

  useEffect(() => {
    let ignore = false

    async function provision() {
      setState({
        status: 'loading',
        message: role === 'ORGANISER'
          ? 'Registering your organiser account for Master Organiser approval...'
          : `Setting up your ${ROLE_DETAILS[role].title} account...`,
        code: '',
      })
      try {
        const result = await completeOnboarding(role, getAccessTokenSilently)
        if (ignore) return
        if (role !== 'ORGANISER') window.sessionStorage.removeItem(PENDING_ROLE_KEY)
        const organiserStatus = result?.data?.application?.status
        if (role === 'ORGANISER' && organiserStatus === 'REJECTED') {
          setState({
            status: 'error',
            message: 'This organiser registration was not approved. Contact a Master Organiser if it needs to be reviewed.',
            code: 'ORGANISER_REJECTED',
          })
          return
        }
        setState({
          status: 'success',
          message: role === 'ORGANISER'
            ? organiserStatus === 'APPROVED'
              ? 'Your organiser registration is approved. Return to sign in and choose Organiser.'
              : 'Your organiser registration has been submitted. A Master Organiser must approve it before you can sign in to the organiser workspace.'
            : 'Your CSAM Tutor Hub account is ready.',
          code: '',
        })
        if (role !== 'ORGANISER') onComplete()
      } catch (error) {
        if (ignore) return
        if (error?.code === 'ROLE_ALREADY_SET') {
          // The account is already linked to a different role. Show a clear mismatch message.
          window.sessionStorage.removeItem(PENDING_ROLE_KEY)
          setState({
            status: 'error',
            code: 'ROLE_MISMATCH',
            message: `This account is registered as a different role. Please sign in using the correct option.`,
          })
          return
        }
        setState({
          status: 'error',
          code: error?.code || '',
          message: ONBOARDING_ERROR_MESSAGES[error?.code]
            || error?.message
            || 'Your CSAM Tutor Hub account could not be set up. Please try again.',
        })
      }
    }

    provision()
    return () => { ignore = true }
  }, [role, attempt, getAccessTokenSilently, onComplete])

  const handleResendVerification = async () => {
    if (resendState.status === 'loading') return
    setResendState({ status: 'loading', message: 'Sending verification email...' })
    try {
      await resendVerificationEmail(getAccessTokenSilently)
      setResendState({ status: 'success', message: 'Verification email sent. Check your inbox, then click Sign in.' })
    } catch {
      setResendState({ status: 'error', message: 'Verification email could not be sent. Please try again later.' })
    }
  }

  const isEmailNotVerified = state.code === 'EMAIL_NOT_VERIFIED'
  const isRoleMismatch = state.code === 'ROLE_MISMATCH'
  const isOrganiserRejected = state.code === 'ORGANISER_REJECTED'

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-live="polite">
        <Brand />
        <h1 className="auth-title">Setting up your account</h1>
        <p className={`status-message ${state.status}`}>{state.message}</p>
        {state.status === 'error' && (
          <div className="auth-actions">
            {isEmailNotVerified && (
              <button type="button" className="primary-button" onClick={onSignInAgain}>Sign in</button>
            )}
            {isRoleMismatch && (
              <button type="button" className="primary-button" onClick={onSignOut}>Return to role selection</button>
            )}
            {!isEmailNotVerified && !isRoleMismatch && !isOrganiserRejected && (
              <button type="button" className="primary-button" onClick={() => setAttempt((v) => v + 1)}>Try again</button>
            )}
            <button type="button" className="secondary-button" onClick={onSignOut}>Sign out</button>
          </div>
        )}
        {state.status === 'error' && isEmailNotVerified && (
          <div className="auth-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={handleResendVerification}
              disabled={resendState.status === 'loading'}
            >
              {resendState.status === 'loading' ? 'Sending...' : 'Resend verification email'}
            </button>
          </div>
        )}
        {state.status === 'success' && role === 'ORGANISER' && (
          <div className="auth-actions">
            <button type="button" className="primary-button" onClick={onSignOut}>Return to sign in</button>
          </div>
        )}
        {resendState.message && (
          <p className={`status-message ${resendState.status}`} aria-live="polite">{resendState.message}</p>
        )}
      </section>
    </main>
  )
}

function OrganiserApprovalCard({ application, onSignOut }) {
  const status = application?.status || 'NOT_FOUND'
  const content = {
    PENDING: {
      title: 'Awaiting organiser approval',
      tone: 'loading',
      message: 'Your lecturer organiser registration is still waiting for a Master Organiser to approve it.',
    },
    APPROVED: {
      title: 'Organiser account approved',
      tone: 'success',
      message: 'Your organiser account has been approved. Sign out, then sign in as Organiser to load your new access.',
    },
    REJECTED: {
      title: 'Organiser registration not approved',
      tone: 'error',
      message: 'Your organiser registration was not approved. Contact a Master Organiser if you believe this needs to be reviewed.',
    },
  }[status]

  if (!content) return null

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-live="polite">
        <Brand />
        <h1 className="auth-title">{content.title}</h1>
        <p className={`status-message ${content.tone}`}>{content.message}</p>
        <div className="auth-actions">
          <button type="button" className="primary-button" onClick={onSignOut}>Return to role selection</button>
        </div>
      </section>
    </main>
  )
}

function ProfileNotFoundGate({ onChooseRole, onSignOut }) {
  const { getAccessTokenSilently } = useAuth0()
  const [state, setState] = useState({ loading: true, application: null })

  useEffect(() => {
    let ignore = false
    async function loadApplication() {
      try {
        const application = await getOwnOrganiserApplication(getAccessTokenSilently)
        if (!ignore) setState({ loading: false, application })
      } catch {
        if (!ignore) setState({ loading: false, application: null })
      }
    }
    loadApplication()
    return () => { ignore = true }
  }, [getAccessTokenSilently])

  if (state.loading) return <LoadingCard message="Checking your account status..." />
  if (state.application) return <OrganiserApprovalCard application={state.application} onSignOut={onSignOut} />
  return <FinishSetupCard onChooseRole={onChooseRole} onSignOut={onSignOut} />
}

function FinishSetupCard({ onChooseRole, onSignOut }) {
  const [selectedRole, setSelectedRole] = useState(null)

  return (
    <main className="auth-shell">
      <section className="auth-card auth-card-entry">
        <Brand />
        <div className="auth-header">
          <h1 className="auth-title">Choose your role</h1>
          <p className="auth-subtitle">Finish setting up your CSAM Tutor Hub account.</p>
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

function RoleMismatchCard({ requestedRole, actualRole, onSignOut }) {
  const requestedTitle = ROLE_DETAILS[requestedRole]?.title || requestedRole
  const actualTitle = ROLE_DETAILS[actualRole]?.title || actualRole

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-live="polite">
        <Brand />
        <h1 className="auth-title">Role mismatch</h1>
        <p className="status-message error">
          This account is registered as a {actualTitle}. Please sign in using the {actualTitle} option.
        </p>
        <p className="auth-subtitle">
          You selected {requestedTitle} sign-in, but this account has a different role.
        </p>
        <div className="auth-actions">
          <button type="button" className="primary-button" onClick={onSignOut}>Return to role selection</button>
        </div>
      </section>
    </main>
  )
}

function RoleChangedCard({ onSignOut }) {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-live="polite">
        <Brand />
        <h1 className="auth-title">Your access has changed</h1>
        <p className="status-message success">
          Your Tutor MX role was updated. Sign out and sign in again to load your new permissions.
        </p>
        <div className="auth-actions">
          <button type="button" className="primary-button" onClick={onSignOut}>Sign out and continue</button>
        </div>
      </section>
    </main>
  )
}

function App() {
  const { isAuthenticated, loginWithRedirect, logout, isLoading } = useAuth0()
  const [pendingRole, setPendingRole] = useState(() => storedPendingRole())
  const [requestedSignInRole, setRequestedSignInRole] = useState(() => storedRequestedSignInRole())
  const { user: currentUser, role: currentRole, loading: userLoading, error: userError, errorCode: userErrorCode } = useCurrentUser({ enabled: !pendingRole })
  const [status, setStatus] = useState({ type: 'idle', message: '' })
  const [isSubmitting, setIsSubmitting] = useState(false)

  const rememberPendingRole = (role) => {
    window.sessionStorage.setItem(PENDING_ROLE_KEY, role)
    setPendingRole(role)
  }

  const rememberRequestedSignInRole = (role) => {
    if (TUTOR_MX_ROLES.includes(role)) {
      window.sessionStorage.setItem(REQUESTED_SIGNIN_ROLE_KEY, role)
      setRequestedSignInRole(role)
    }
  }

  const clearRequestedSignInRole = useCallback(() => {
    window.sessionStorage.removeItem(REQUESTED_SIGNIN_ROLE_KEY)
    setRequestedSignInRole(null)
  }, [])

  const handleAuthRedirect = async (mode = 'login', role = null) => {
    if (isSubmitting) return
    if (mode === 'signup' && !TUTOR_MX_ROLES.includes(role)) {
      setStatus({ type: 'error', message: 'Choose Student, Tutor or Organiser first.' })
      return
    }

    setIsSubmitting(true)
    setStatus({ type: 'loading', message: '' })

    if (mode === 'signup') {
      window.sessionStorage.setItem(PENDING_ROLE_KEY, role)
      clearRequestedSignInRole()
    } else {
      window.sessionStorage.removeItem(PENDING_ROLE_KEY)
      setPendingRole(null)
      if (TUTOR_MX_ROLES.includes(role)) {
        rememberRequestedSignInRole(role)
      } else {
        clearRequestedSignInRole()
      }
    }

    try {
      await loginWithRedirect({
        authorizationParams: {
          screen_hint: mode === 'signup' ? 'signup' : 'login',
          // Always show Auth0's form: accounts are per role, so a remembered login must not
          // silently choose the account (or reuse it for a new sign-up).
          prompt: 'login',
        },
        appState: { targetUrl: '/' },
      })
    } catch {
      if (mode === 'signup') window.sessionStorage.removeItem(PENDING_ROLE_KEY)
      setStatus({ type: 'error', message: 'Authentication could not be started. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSignInAgain = async () => {
    // Resume sign-in to obtain fresh authentication/verification state after email verification.
    // Preserve the pending role so onboarding completes correctly.
    if (isSubmitting) return
    setIsSubmitting(true)
    setStatus({ type: 'loading', message: '' })

    try {
      await loginWithRedirect({
        authorizationParams: {
          screen_hint: 'login',
          prompt: 'login',
        },
        appState: { targetUrl: '/' },
      })
    } catch {
      setStatus({ type: 'error', message: 'Authentication could not be started. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSignOut = async () => {
    invalidateSession('You have signed out of this workspace.')
    window.sessionStorage.removeItem(PENDING_ROLE_KEY)
    setPendingRole(null)
    clearRequestedSignInRole()
    try { await logout({ logoutParams: { returnTo: window.location.origin } }) }
    catch { setStatus({ type: 'error', message: 'Sign-out could not reach the identity provider. Your workspace is locked. Try again.' }) }
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
            <Landing
              onCreateAccount={(role) => handleAuthRedirect('signup', role)}
              onSignIn={(role) => handleAuthRedirect('login', role)}
              isSubmitting={isSubmitting}
              status={status}
            />
          )}
        />
      </Routes>
    )
  }

  if (userErrorCode === 'SESSION_EXPIRED') return <main className="auth-shell"><section className="auth-card" role="alert"><h1>Sign in again</h1><p>{userError}</p>{status.type === 'error' && <p>{status.message}</p>}<button type="button" className="primary-button" onClick={handleSignInAgain}>Sign in again</button><button type="button" className="secondary-button" onClick={handleSignOut}>Sign out</button></section></main>
  if (pendingRole) return <OnboardingCard role={pendingRole} onComplete={() => setPendingRole(null)} onSignOut={handleSignOut} onSignInAgain={handleSignInAgain} />
  if (userLoading) return <LoadingCard message="Loading your workspace..." />
  if (userErrorCode === 'PROFILE_NOT_FOUND') return <ProfileNotFoundGate onChooseRole={rememberPendingRole} onSignOut={handleSignOut} />
  if (userErrorCode === 'ROLE_MISMATCH') return <RoleChangedCard onSignOut={handleSignOut} />

  // Check for role mismatch: if user selected a specific role for sign-in, compare with actual profile role.
  if (requestedSignInRole && currentRole && requestedSignInRole !== currentRole) {
    return <RoleMismatchCard requestedRole={requestedSignInRole} actualRole={currentRole} onSignOut={handleSignOut} />
  }

  if (userError || !currentRole) {
    return (
      <main className="auth-shell">
        <section className="auth-card" role="alert">
          <Brand />
          <h1 className="auth-title">Access unavailable</h1>
          <p className="auth-subtitle">{userError || 'Your account does not have a permitted CSAM Tutor Hub role.'}</p>
          <button type="button" className="primary-button" onClick={handleSignOut}>Sign out</button>
        </section>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <RoleRouter key={`${currentUser?.data?.profile?.id ?? 'user'}-${currentRole}`} currentRole={currentRole} onSignOut={handleSignOut} user={currentUser} />
    </div>
  )
}

export default App
