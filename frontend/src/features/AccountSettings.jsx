import { useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { requestPasswordReset, useApiClient } from '../api/client'

const DELETE_ACCOUNT_PATH = '/api/auth/delete-account'

export function AccountSettings() {
  const request = useApiClient()
  const { logout } = useAuth0()
  const [email, setEmail] = useState('')
  const [resetStatus, setResetStatus] = useState({ type: 'idle', message: '' })
  const [resetSubmitting, setResetSubmitting] = useState(false)
  const [deleteState, setDeleteState] = useState({
    step: 0,
    confirm: '',
    error: '',
    submitting: false,
  })

  const handlePasswordReset = async (event) => {
    event.preventDefault()
    if (resetSubmitting) return

    setResetSubmitting(true)
    setResetStatus({ type: 'loading', message: 'Requesting reset instructions...' })
    try {
      const response = await requestPasswordReset(email)
      setResetStatus({
        type: 'success',
        message:
          response?.data?.message ||
          'If the account can be reset, Auth0 will send password-reset instructions.',
      })
    } catch (error) {
      setResetStatus({ type: 'error', message: error.message || 'Unable to request a reset.' })
    } finally {
      setResetSubmitting(false)
    }
  }

  const handleDeleteStart = () => {
    setDeleteState({ step: 1, confirm: '', error: '', submitting: false })
  }

  const handleDeleteCancel = () => {
    setDeleteState({ step: 0, confirm: '', error: '', submitting: false })
  }

  const handleDeleteConfirm = async () => {
    if (deleteState.submitting || deleteState.confirm !== 'DELETE') return

    setDeleteState((previous) => ({ ...previous, submitting: true, error: '' }))
    try {
      await request(DELETE_ACCOUNT_PATH, { method: 'DELETE' })
      setDeleteState({ step: 2, confirm: '', error: '', submitting: false })
      // The account no longer exists, so the in-memory session must not linger.
      try {
        logout({ logoutParams: { returnTo: window.location.origin } })
      } catch {
        setDeleteState((previous) => ({
          ...previous,
          error: 'Account deleted, but automatic sign-out failed. Use Sign out in the navigation bar.',
        }))
      }
    } catch (error) {
      setDeleteState((previous) => ({
        ...previous,
        error: error.message || 'Unable to request account deletion.',
        submitting: false,
      }))
    }
  }

  return (
    <main id="main-content" className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Your account</p>
          <h1>Account settings</h1>
          <p className="helper-text">Manage password recovery and account access.</p>
        </div>
      </header>

      <div className="settings-panel">
        <section className="settings-card">
          <h2>Reset password</h2>
          <p>Auth0 sends the reset link and hosts the new-password screen securely.</p>
          <form className="inline-form" onSubmit={handlePasswordReset}>
            <label htmlFor="settings-reset-email">Email address</label>
            <input
              id="settings-reset-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <button type="submit" className="secondary-button" disabled={resetSubmitting}>
              {resetSubmitting ? 'Requesting...' : 'Send reset instructions'}
            </button>
          </form>
          {resetStatus.message && (
            <p className={`status-message ${resetStatus.type}`} aria-live="polite">
              {resetStatus.message}
            </p>
          )}
        </section>

        <section className="settings-card danger-zone">
          <h2>Delete account</h2>
          {deleteState.step === 0 && (
            <>
              <p>This permanently deletes your CSAM Tutor Hub profile data and Auth0 login.</p>
              <button type="button" className="danger-button" onClick={handleDeleteStart}>
                Delete my account
              </button>
            </>
          )}

          {deleteState.step === 1 && (
            <>
              <label htmlFor="confirm-delete">Type DELETE to confirm</label>
              <input
                id="confirm-delete"
                type="text"
                value={deleteState.confirm}
                onChange={(event) =>
                  setDeleteState((previous) => ({
                    ...previous,
                    confirm: event.target.value,
                    error: '',
                  }))
                }
                autoComplete="off"
              />
              <div className="button-row">
                <button
                  type="button"
                  className="danger-button"
                  disabled={deleteState.confirm !== 'DELETE' || deleteState.submitting}
                  onClick={handleDeleteConfirm}
                >
                  {deleteState.submitting ? 'Submitting...' : 'Confirm deletion'}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={deleteState.submitting}
                  onClick={handleDeleteCancel}
                >
                  Cancel
                </button>
              </div>
            </>
          )}

          {deleteState.step === 2 && !deleteState.error && (
            <p className="status-note" role="status">
              Account deleted. Signing you out of CSAM Tutor Hub...
            </p>
          )}
          {deleteState.error && (
            <p className="status-note danger" role="alert">
              {deleteState.error}
            </p>
          )}
        </section>
      </div>
    </main>
  )
}
