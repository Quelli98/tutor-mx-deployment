import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountSettings } from './AccountSettings'

const mockRequest = vi.fn()
const mockPasswordReset = vi.fn()

vi.mock('../api/client', () => ({
  requestPasswordReset: (...arguments_) => mockPasswordReset(...arguments_),
  useApiClient: () => mockRequest,
}))

describe('AccountSettings', () => {
  beforeEach(() => {
    mockRequest.mockReset()
    mockRequest.mockResolvedValue({ data: { status: 'pending' } })
    mockPasswordReset.mockReset()
    mockPasswordReset.mockResolvedValue({
      data: { message: 'If the account can be reset, Auth0 will send instructions.' },
    })
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
    expect(screen.getByText(/deletion request recorded/i)).toBeInTheDocument()
  })
})
