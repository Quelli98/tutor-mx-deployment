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
  STUDENT: { title: 'Student', description: 'View available overflow work and volunteer for suitable sessions.' },
  TUTOR: { title: 'Tutor', description: 'View tutoring work, availability, work logs and excuses.' },
  ORGANISER: { title: 'Organiser', description: 'Manage the Tutor Mx workspace and organiser-only functions.' },
})
function storedPendingRole() { const value = window.sessionStorage.getItem(PENDING_ROLE_KEY); return TUTOR_MX_ROLES.includes(value) ? value : null }
function LoadingCard({ message }) { return <main className="auth-shell"><section className="auth-card" aria-live="polite"><p className="eyebrow">Tutor Mx</p><h1>{message}</h1></section></main> }

function RoleChoices({ selectedRole, onSelect, heading = 'Choose your role' }) {
  return <fieldset className="role-choice-fieldset"><legend>{heading}</legend><p className="role-choice-help">Choose the role this account will use in Tutor Mx.</p><div className="role-choice-grid">
    {TUTOR_MX_ROLES.map((role) => <button key={role} type="button" className={`role-choice-card${selectedRole === role ? ' selected' : ''}`} aria-pressed={selectedRole === role} aria-label={ROLE_DETAILS[role].title} onClick={() => onSelect(role)}><strong>{ROLE_DETAILS[role].title}</strong><span>{ROLE_DETAILS[role].description}</span></button>)}
  </div>{selectedRole === 'ORGANISER' && <p className="role-choice-warning">Organiser accounts have elevated access. Enable organiser self-sign-up only where that is intended.</p>}</fieldset>
}

function AuthEntry({ handleAuthRedirect, isSubmitting, status, selectedRole, onSelectRole }) {
  const label = selectedRole ? ROLE_DETAILS[selectedRole].title : ''
  return <main className="auth-shell"><section className="auth-card auth-card-wide" aria-labelledby="auth-heading"><div className="auth-header"><p className="eyebrow">Tutor Mx</p><h1 id="auth-heading">Welcome to Tutor Mx</h1></div>
    <p className="subtitle">Auth0 handles account credentials securely. Choose your Tutor Mx role before creating a new account; Tutor Mx will create the matching Auth0 role and Neon profile automatically after the first verified sign-in.</p>
    <RoleChoices selectedRole={selectedRole} onSelect={onSelectRole} />
    <div className="auth-actions"><button type="button" className="secondary-button" onClick={() => handleAuthRedirect('signup')} disabled={isSubmitting || !selectedRole}>{isSubmitting && selectedRole ? 'Please wait...' : selectedRole ? `Create ${label} account` : 'Choose a role to create account'}</button>
      <div className="existing-account-divider" aria-hidden="true"><span>Already registered?</span></div>
      <button type="button" className="primary-button" onClick={() => handleAuthRedirect('login')} disabled={isSubmitting}>{isSubmitting ? 'Please wait...' : 'Sign in with Auth0'}</button>
      <Link className="text-link" to="/reset-password">Forgot your password?</Link></div>
    {status.message && <p className={`status-message ${status.type}`} aria-live="polite">{status.message}</p>}</section></main>
}

function OnboardingCard({ role, onComplete, onSignOut }) {
  const { getAccessTokenSilently } = useAuth0(); const [attempt, setAttempt] = useState(0); const [state, setState] = useState({ status: 'loading', message: '' })
  useEffect(() => { let ignore = false; async function provision() { setState({ status: 'loading', message: `Setting up your ${ROLE_DETAILS[role].title} account...` }); try { await completeOnboarding(role, getAccessTokenSilently); if (ignore) return; window.sessionStorage.removeItem(PENDING_ROLE_KEY); setState({ status: 'success', message: 'Your Tutor Mx account is ready.' }); onComplete() } catch (error) { if (ignore) return; setState({ status: 'error', message: error?.code === 'EMAIL_NOT_VERIFIED' ? 'Verify your email using the Auth0 verification email, then click Try again.' : error?.message || 'Your Tutor Mx account could not be set up. Please try again.' }) } } provision(); return () => { ignore = true } }, [role, attempt, getAccessTokenSilently, onComplete])
  return <main className="auth-shell"><section className="auth-card" aria-live="polite"><p className="eyebrow">Tutor Mx</p><h1>Setting up your {ROLE_DETAILS[role].title} account</h1><p className={`status-message ${state.status}`}>{state.message}</p>{state.status === 'error' && <div className="auth-actions"><button type="button" className="primary-button" onClick={() => setAttempt((v) => v + 1)}>Try again</button><button type="button" className="secondary-button" onClick={onSignOut}>Sign out</button></div>}</section></main>
}

function FinishSetupCard({ onChooseRole, onSignOut }) {
  const [selectedRole, setSelectedRole] = useState(null)
  return <main className="auth-shell"><section className="auth-card auth-card-wide"><p className="eyebrow">Tutor Mx</p><h1>Finish setting up your account</h1><p className="subtitle">This Auth0 account does not yet have a Tutor Mx profile. Choose its role once and Tutor Mx will create the matching Auth0 and Neon records automatically.</p><RoleChoices selectedRole={selectedRole} onSelect={setSelectedRole} /><div className="auth-actions"><button type="button" className="primary-button" disabled={!selectedRole} onClick={() => onChooseRole(selectedRole)}>Continue</button><button type="button" className="secondary-button" onClick={onSignOut}>Sign out</button></div></section></main>
}

function App() {
  const { isAuthenticated, loginWithRedirect, logout, isLoading } = useAuth0()
  const [pendingRole, setPendingRole] = useState(() => storedPendingRole())
  const [selectedRole, setSelectedRole] = useState(null)
  const { role: currentRole, loading: userLoading, error: userError, errorCode: userErrorCode } = useCurrentUser({ enabled: !pendingRole })
  const [status, setStatus] = useState({ type: 'idle', message: '' }); const [isSubmitting, setIsSubmitting] = useState(false)
  const rememberPendingRole = (role) => { window.sessionStorage.setItem(PENDING_ROLE_KEY, role); setPendingRole(role) }
  const handleAuthRedirect = async (mode = 'login') => {
    if (isSubmitting) return
    if (mode === 'signup' && !selectedRole) { setStatus({ type: 'error', message: 'Choose Student, Tutor or Organiser first.' }); return }
    setIsSubmitting(true); setStatus({ type: 'loading', message: mode === 'signup' ? 'Opening account creation...' : 'Redirecting to sign in...' })
    if (mode === 'signup') window.sessionStorage.setItem(PENDING_ROLE_KEY, selectedRole); else { window.sessionStorage.removeItem(PENDING_ROLE_KEY); setPendingRole(null) }
    try { await loginWithRedirect({ authorizationParams: { screen_hint: mode === 'signup' ? 'signup' : 'login' }, appState: { targetUrl: '/' } }); setStatus({ type: 'success', message: mode === 'signup' ? 'Account creation started.' : 'Sign in started.' }) }
    catch { if (mode === 'signup') window.sessionStorage.removeItem(PENDING_ROLE_KEY); setStatus({ type: 'error', message: 'Authentication could not be started. Please try again.' }) }
    finally { setIsSubmitting(false) }
  }
  const handleSignOut = () => { window.sessionStorage.removeItem(PENDING_ROLE_KEY); setPendingRole(null); logout({ logoutParams: { returnTo: window.location.origin } }) }
  if (isLoading) return <LoadingCard message="Checking your session..." />
  if (!isAuthenticated) return <Routes><Route path="/reset-password" element={<PasswordResetPage />} /><Route path="/new-password" element={<NewPasswordPage />} /><Route path="*" element={<AuthEntry handleAuthRedirect={handleAuthRedirect} isSubmitting={isSubmitting} status={status} selectedRole={selectedRole} onSelectRole={setSelectedRole} />} /></Routes>
  if (pendingRole) return <OnboardingCard role={pendingRole} onComplete={() => setPendingRole(null)} onSignOut={handleSignOut} />
  if (userLoading) return <LoadingCard message="Loading your workspace..." />
  if (userErrorCode === 'PROFILE_NOT_FOUND') return <FinishSetupCard onChooseRole={rememberPendingRole} onSignOut={handleSignOut} />
  if (userError || !currentRole) return <main className="auth-shell"><section className="auth-card" role="alert"><p className="eyebrow">Tutor Mx</p><h1>Access unavailable</h1><p className="subtitle">{userError || 'Your account does not have a permitted Tutor Mx role. Sign out and contact support if this continues.'}</p><button type="button" className="primary-button" onClick={handleSignOut}>Sign out</button></section></main>
  return <div className="app-shell"><RoleRouter currentRole={currentRole} /><button type="button" className="primary-button sign-out-button" onClick={handleSignOut}>Sign out</button></div>
}
export default App
