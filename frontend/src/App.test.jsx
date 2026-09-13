import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const loginMock = vi.fn()
const logoutMock = vi.fn()
const tokenMock = vi.fn()
const completeOnboardingMock = vi.fn()
const resendVerificationMock = vi.fn()
let authState
let currentUserState

vi.mock('@auth0/auth0-react', () => ({
  Auth0Provider: ({ children }) => <div>{children}</div>,
  useAuth0: () => ({
    ...authState,
    loginWithRedirect: loginMock,
    logout: logoutMock,
    getAccessTokenSilently: tokenMock,
  }),
}))

vi.mock('./auth/useCurrentUser', () => ({
  useCurrentUser: () => currentUserState,
}))

vi.mock('./api/onboarding', () => ({
  TUTOR_MX_ROLES: Object.freeze(['STUDENT', 'TUTOR', 'ORGANISER']),
  completeOnboarding: (...arguments_) => completeOnboardingMock(...arguments_),
  resendVerificationEmail: (...arguments_) => resendVerificationMock(...arguments_),
}))

vi.mock('./api/tutorDashboard', () => ({
  fetchTutorDashboard: () =>
    Promise.resolve({
      allocations: [],
      weeklyLimit: 10,
      usedHours: 0,
      remainingHours: 10,
    }),
}))

describe('Auth entry flow', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    loginMock.mockReset()
    logoutMock.mockReset()
    tokenMock.mockReset()
    tokenMock.mockResolvedValue('token-1')
    completeOnboardingMock.mockReset()
    completeOnboardingMock.mockResolvedValue({ data: { profile: { role: 'TUTOR' } } })
    resendVerificationMock.mockReset()
    resendVerificationMock.mockResolvedValue({ data: { message: 'sent' } })
    authState = { isAuthenticated: false, isLoading: false, user: null }
    currentUserState = { role: null, loading: false, error: '', errorCode: '' }
  })

  it('redirects an existing user to Auth0 sign in', async () => {
    render(<MemoryRouter><App /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: /sign in with auth0/i }))

    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith({
        authorizationParams: { screen_hint: 'login' },
        appState: { targetUrl: '/' },
      }),
    )
  })

  it('requires a role and sends a new Student to Auth0 sign up', async () => {
    render(<MemoryRouter><App /></MemoryRouter>)

    const create = screen.getByRole('button', { name: /^choose a role$/i })
    expect(create).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /^student$/i }))
    fireEvent.click(screen.getByRole('button', { name: /create student account/i }))

    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith({
        authorizationParams: { screen_hint: 'signup' },
        appState: { targetUrl: '/' },
      }),
    )

    expect(window.sessionStorage.getItem('tutormx.pendingRole')).toBe('STUDENT')
  })

  it('shows a safe message when Auth0 cannot start sign in', async () => {
    loginMock.mockRejectedValue(new Error('tenant details'))
    render(<MemoryRouter><App /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: /sign in with auth0/i }))

    expect(await screen.findByText(/authentication could not be started/i)).toBeInTheDocument()
    expect(screen.queryByText(/tenant details/i)).not.toBeInTheDocument()
  })

  it('opens the matching role entry page after authentication', async () => {
    authState = { isAuthenticated: true, isLoading: false, user: { sub: 'auth0|123' } }
    currentUserState = { role: 'TUTOR', loading: false, error: '', errorCode: '' }

    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: /your tutor dashboard/i })).toBeInTheDocument()
  })

  it('offers role setup to an authenticated legacy user with no Neon profile', () => {
    authState = { isAuthenticated: true, isLoading: false, user: { sub: 'auth0|123' } }
    currentUserState = {
      role: null,
      loading: false,
      error: 'No Tutor Mx profile is linked to this account.',
      errorCode: 'PROFILE_NOT_FOUND',
    }

    render(<MemoryRouter><App /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: /choose your role/i })).toBeInTheDocument()
    expect(screen.getByText(/finish setting up your tutor mx account/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()
  })

  it('calls logout with returnTo origin when sign out is clicked', () => {
    authState = { isAuthenticated: true, isLoading: false, user: { sub: 'auth0|123' } }
    currentUserState = { role: 'STUDENT', loading: false, error: '', errorCode: '' }

    render(<MemoryRouter><App /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))

    expect(logoutMock).toHaveBeenCalledWith({
      logoutParams: { returnTo: window.location.origin },
    })
  })

  it('recovers into the existing workspace when a stale pending role conflicts with a linked account', async () => {
    authState = { isAuthenticated: true, isLoading: false, user: { sub: 'auth0|123' } }
    currentUserState = { role: 'TUTOR', loading: false, error: '', errorCode: '' }
    window.sessionStorage.setItem('tutormx.pendingRole', 'STUDENT')
    const conflict = new Error('This Tutor Mx account already has a different role.')
    conflict.code = 'ROLE_ALREADY_SET'
    completeOnboardingMock.mockRejectedValueOnce(conflict)

    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: /your tutor dashboard/i })).toBeInTheDocument()
    expect(window.sessionStorage.getItem('tutormx.pendingRole')).toBeNull()
    expect(screen.queryByRole('button', { name: /choose your role/i })).not.toBeInTheDocument()
  })

  it('offers verification-email recovery when onboarding is blocked by an unverified email', async () => {
    authState = { isAuthenticated: true, isLoading: false, user: { sub: 'auth0|456' } }
    window.sessionStorage.setItem('tutormx.pendingRole', 'TUTOR')
    const unverified = new Error('Verify your email address, then try again.')
    unverified.code = 'EMAIL_NOT_VERIFIED'
    completeOnboardingMock.mockRejectedValueOnce(unverified)

    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)

    expect(await screen.findByText(/verify your email using the auth0 verification email/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }))

    await waitFor(() => {
      expect(resendVerificationMock).toHaveBeenCalledWith(tokenMock)
    })
    expect(await screen.findByText(/verification email sent/i)).toBeInTheDocument()
  })
})
