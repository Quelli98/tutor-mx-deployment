import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountSettings } from './AccountSettings'

const mockRequest = vi.fn()
const mockPasswordReset = vi.fn()
const mockLogout = vi.fn()

vi.mock('../api/client', () => ({
  requestPasswordReset: (...arguments_) => mockPasswordReset(...arguments_),
  useApiClient: () => mockRequest,
}))

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    logout: mockLogout,
  }),
}))

describe('AccountSettings', () => {
  beforeEach(() => {
    mockRequest.mockReset()
    mockRequest.mockResolvedValue({ data: { status: 'pending' } })
    mockPasswordReset.mockReset()
    mockPasswordReset.mockResolvedValue({
      data: { message: 'If the account can be reset, Auth0 will send instructions.' },
    })
    mockLogout.mockReset()
  })

  it('requests a non-enumerating Auth0 password reset', async () => {
    render(<AccountSettings />)

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'known@tutormx.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send reset instructions/i }))

    await waitFor(() => {
      expect(mockPasswordReset).toHaveBeenCalledWith('known@tutormx.example')
    })
    expect(screen.getByText(/if the account can be reset/i)).toBeInTheDocument()
  })

  it('does not call the backend when account deletion is cancelled', () => {
    render(<AccountSettings />)

    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }))
    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), {
      target: { value: 'DELETE' },
    })
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(mockRequest).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /delete my account/i })).toBeInTheDocument()
  })

  it('submits a delete-account request only after exact confirmation', async () => {
    render(<AccountSettings />)

    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }))
    const confirmButton = screen.getByRole('button', { name: /confirm deletion/i })
    expect(confirmButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), {
      target: { value: 'DELETE' },
    })
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(mockRequest).toHaveBeenCalledWith('/api/auth/delete-account', { method: 'DELETE' })
    })
    expect(screen.getByText(/account deleted/i)).toBeInTheDocument()
  })

  it('signs the user out automatically once deletion succeeds', async () => {
    render(<AccountSettings />)

    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }))
    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), {
      target: { value: 'DELETE' },
    })
    fireEvent.click(screen.getByRole('button', { name: /confirm deletion/i }))

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalledWith({
        logoutParams: { returnTo: window.location.origin },
      })
    })
  })

  it('stays usable with a clear error when deletion fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Auth0 unavailable'))

    render(<AccountSettings />)

    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }))
    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), {
      target: { value: 'DELETE' },
    })
    fireEvent.click(screen.getByRole('button', { name: /confirm deletion/i }))

    expect(await screen.findByText(/auth0 unavailable/i)).toBeInTheDocument()
    expect(mockLogout).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /confirm deletion/i })).toBeEnabled()
  })
  it('locks the local session after account deletion even when Auth0 logout fails', async () => {
    mockLogout.mockRejectedValueOnce(new Error('Provider offline'))
    sessionStorage.removeItem('tutormx.sessionLocked')
    render(<AccountSettings />)
    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }))
    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), { target: { value: 'DELETE' } })
    fireEvent.click(screen.getByRole('button', { name: /confirm deletion/i }))
    expect(await screen.findByText(/automatic sign-out failed/i)).toBeInTheDocument()
    expect(sessionStorage.getItem('tutormx.sessionLocked')).toBe('true')
  })

})
