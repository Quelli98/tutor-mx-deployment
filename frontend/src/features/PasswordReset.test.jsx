import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NewPasswordPage, PasswordResetPage } from './PasswordReset'

const mockPasswordReset = vi.fn()
const loginMock = vi.fn()

vi.mock('../api/client', () => ({
  requestPasswordReset: (...arguments_) => mockPasswordReset(...arguments_),
}))

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    loginWithRedirect: loginMock,
  }),
}))

describe('PasswordResetPage', () => {
  beforeEach(() => {
    mockPasswordReset.mockReset()
    loginMock.mockReset()
  })

  it('shows the same safe response after submitting a known email', async () => {
    mockPasswordReset.mockResolvedValue({
      data: { message: 'If the account can be reset, Auth0 will send instructions.' },
    })
    render(
      <MemoryRouter>
        <PasswordResetPage />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'known@tutormx.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send reset instructions/i }))

    await waitFor(() => expect(mockPasswordReset).toHaveBeenCalledTimes(1))
    expect(screen.getByText(/if the account can be reset/i)).toBeInTheDocument()
  })

  it('shows a "Sign in again" button after a successful reset request', async () => {
    mockPasswordReset.mockResolvedValue({
      data: { message: 'If the account can be reset, Auth0 will send instructions.' },
    })
    render(
      <MemoryRouter>
        <PasswordResetPage />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'known@tutormx.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send reset instructions/i }))

    expect(await screen.findByRole('button', { name: /sign in again/i })).toBeInTheDocument()
  })

  it('starts Auth0 login when "Sign in again" is clicked', async () => {
    mockPasswordReset.mockResolvedValue({
      data: { message: 'If the account can be reset, Auth0 will send instructions.' },
    })
    render(
      <MemoryRouter>
        <PasswordResetPage />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'known@tutormx.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send reset instructions/i }))

    fireEvent.click(await screen.findByRole('button', { name: /sign in again/i }))

    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith({
        authorizationParams: { screen_hint: 'login', prompt: 'login' },
        appState: { targetUrl: '/' },
      }),
    )
  })

  it('shows a controlled unavailable state', async () => {
    mockPasswordReset.mockRejectedValue(new Error('Password reset is temporarily unavailable.'))
    render(
      <MemoryRouter>
        <PasswordResetPage />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'user@tutormx.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send reset instructions/i }))

    expect(await screen.findByText(/temporarily unavailable/i)).toBeInTheDocument()
  })
})

describe('NewPasswordPage', () => {
  beforeEach(() => {
    loginMock.mockReset()
  })

  it('keeps the actual password on the Auth0 hosted page', () => {
    render(
      <MemoryRouter>
        <NewPasswordPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: /choose a new password/i })).toBeInTheDocument()
    expect(screen.getByText(/auth0's hosted page/i)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('offers a "Sign in again" button that triggers Auth0 login', async () => {
    render(
      <MemoryRouter>
        <NewPasswordPage />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /sign in again/i }))

    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith({
        authorizationParams: { screen_hint: 'login', prompt: 'login' },
        appState: { targetUrl: '/' },
      }),
    )
  })
})
