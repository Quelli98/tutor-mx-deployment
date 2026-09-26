import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { requestPasswordReset } from '../api/client'

export function PasswordResetPage() {
  const { loginWithRedirect } = useAuth0()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState({ type: 'idle', message: '' })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSigningIn, setIsSigningIn] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (isSubmitting) return

    setIsSubmitting(true)
    setStatus({ type: 'loading', message: 'Requesting a secure reset link...' })

    try {
      const response = await requestPasswordReset(email)
      setStatus({
        type: 'success',
        message:
          response?.data?.message ||
          'If the account can be reset, Auth0 will send password-reset instructions.',
      })
    } catch (error) {
      setStatus({
        type: 'error',
        message: error?.message || 'Password reset is temporarily unavailable.',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSignInAgain = async () => {
    if (isSigningIn) return
    setIsSigningIn(true)
    try {
      await loginWithRedirect({
        authorizationParams: { screen_hint: 'login', prompt: 'login' },
        appState: { targetUrl: '/' },
      })
    } catch {
      setStatus({ type: 'error', message: 'Authentication could not be started. Please try again.' })
    } finally {
      setIsSigningIn(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="reset-heading">
        <p className="eyebrow">CSAM Tutor Hub account security</p>
        <h1 id="reset-heading">Reset your password</h1>
        <p className="subtitle">
          Enter your email. The response is deliberately the same whether or not an account exists.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="field-group">
            <label htmlFor="reset-email">Email address</label>
            <input
              id="reset-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Requesting...' : 'Send reset instructions'}
          </button>
        </form>

        {status.message && (
          <p className={`status-message ${status.type}`} aria-live="polite">
            {status.message}
          </p>
        )}

        {status.type === 'success' && (
          <div className="auth-actions">
            <button type="button" className="primary-button" onClick={handleSignInAgain} disabled={isSigningIn}>
              {isSigningIn ? 'Opening...' : 'Sign in again'}
            </button>
          </div>
        )}

        <Link className="text-link" to="/">
          Back to sign in
        </Link>
      </section>
    </main>
  )
}

export function NewPasswordPage() {
  const { loginWithRedirect } = useAuth0()
  const [isSigningIn, setIsSigningIn] = useState(false)

  const handleSignInAgain = async () => {
    if (isSigningIn) return
    setIsSigningIn(true)
    try {
      await loginWithRedirect({
        authorizationParams: { screen_hint: 'login', prompt: 'login' },
        appState: { targetUrl: '/' },
      })
    } catch {
      // Auth0 redirect failed; the user can retry.
    } finally {
      setIsSigningIn(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="new-password-heading">
        <p className="eyebrow">CSAM Tutor Hub account security</p>
        <h1 id="new-password-heading">Choose a new password</h1>
        <p className="subtitle">
          Open the secure link in your reset email to set the new password on Auth0&apos;s hosted
          page. CSAM Tutor Hub never receives or stores it.
        </p>
        <p className="subtitle">
          Once you have set your new password on Auth0, sign in again below.
        </p>
        <div className="auth-actions">
          <button type="button" className="primary-button" onClick={handleSignInAgain} disabled={isSigningIn}>
            {isSigningIn ? 'Opening...' : 'Sign in again'}
          </button>
        </div>
        <Link className="text-link" to="/reset-password">
          Request another reset link
        </Link>
      </section>
    </main>
  )
}
