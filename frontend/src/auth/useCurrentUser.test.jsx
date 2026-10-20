import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as client from '../api/client'
import { useCurrentUser } from './useCurrentUser'
import { invalidateSession, PERMISSION_EVENT } from './sessionState'

const getAccessTokenSilently = vi.fn()

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    isAuthenticated: true,
    getAccessTokenSilently,
  }),
}))

describe('useCurrentUser', () => {
  beforeEach(() => {
    sessionStorage.clear()
    getAccessTokenSilently.mockReset()
    vi.spyOn(client, 'fetchWithBearerToken').mockReset()
  })

  it('loads the user role from the protected API', async () => {
    getAccessTokenSilently.mockResolvedValue('token-123')
    vi.spyOn(client, 'fetchWithBearerToken').mockResolvedValue({
      data: { profile: { role: 'ORGANISER' } },
    })

    const { result } = renderHook(() => useCurrentUser())

    await waitFor(() => {
      expect(result.current.role).toBe('ORGANISER')
    })

    expect(client.fetchWithBearerToken).toHaveBeenCalledWith('/api/me', {}, getAccessTokenSilently)
  })
  it('locks an expired session even if the old profile request finishes later', async () => {
    let complete
    client.fetchWithBearerToken.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const { result } = renderHook(() => useCurrentUser())
    await waitFor(() => expect(complete).toBeTypeOf('function'))
    act(() => invalidateSession())
    await act(async () => { complete({ data: { profile: { role: 'TUTOR' } } }) })
    expect(result.current.role).toBeNull()
    expect(result.current.errorCode).toBe('SESSION_EXPIRED')
  })
  it('rechecks the profile after denied access and uses its new role', async () => {
    client.fetchWithBearerToken.mockResolvedValueOnce({ data: { profile: { role: 'TUTOR' } } })
    const { result } = renderHook(() => useCurrentUser())
    await waitFor(() => expect(result.current.role).toBe('TUTOR'))
    client.fetchWithBearerToken.mockResolvedValueOnce({ data: { profile: { role: 'STUDENT' } } })
    act(() => window.dispatchEvent(new Event(PERMISSION_EVENT)))
    await waitFor(() => expect(result.current.role).toBe('STUDENT'))
  })
  it('keeps an organiser form mounted and its unsaved inputs intact when a tab regains focus', async () => {
    let finishFocusRefresh
    client.fetchWithBearerToken
      .mockResolvedValueOnce({ data: { profile: { id: 12, role: 'ORGANISER' } } })
      .mockImplementationOnce(() => new Promise(resolve => { finishFocusRefresh = resolve }))

    function TestWorkspace() {
      const { role, loading } = useCurrentUser()
      return loading || !role
        ? <p>Loading workspace</p>
        : <label>Proposal name<input aria-label="Proposal name" defaultValue="" /></label>
    }

    render(<TestWorkspace />)
    const field = await screen.findByRole('textbox', { name: 'Proposal name' })
    field.value = 'My unsaved November proposal'

    act(() => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(finishFocusRefresh).toBeTypeOf('function'))
    // The form must remain the SAME DOM element, even during the pending request.
    expect(screen.getByRole('textbox', { name: 'Proposal name' })).toBe(field)
    expect(field).toHaveValue('My unsaved November proposal')
    expect(screen.queryByText('Loading workspace')).not.toBeInTheDocument()

    await act(async () => {
      finishFocusRefresh({ data: { profile: { id: 12, role: 'ORGANISER' } } })
    })
    expect(screen.getByRole('textbox', { name: 'Proposal name' })).toBe(field)
    expect(field).toHaveValue('My unsaved November proposal')
  })

  it('keeps the workspace open if a background profile refresh briefly loses network access', async () => {
    client.fetchWithBearerToken
      .mockResolvedValueOnce({ data: { profile: { role: 'ORGANISER' } } })
      .mockRejectedValueOnce(new Error('Network temporarily unavailable'))

    const { result } = renderHook(() => useCurrentUser())
    await waitFor(() => expect(result.current.role).toBe('ORGANISER'))
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(result.current.role).toBe('ORGANISER')
    expect(result.current.errorCode).toBe('')
  })

  it('removes the old workspace if background revalidation reports a different role', async () => {
    client.fetchWithBearerToken
      .mockResolvedValueOnce({ data: { profile: { role: 'ORGANISER' } } })
      .mockResolvedValueOnce({ data: { profile: { role: 'STUDENT' } } })
    const { result } = renderHook(() => useCurrentUser())
    await waitFor(() => expect(result.current.role).toBe('ORGANISER'))
    await act(async () => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(result.current.role).toBe('STUDENT'))
  })

  it('keeps a failed sign-out locked on a new mount', async () => {
    invalidateSession('You have signed out of this workspace.')
    const { result } = renderHook(() => useCurrentUser())
    expect(result.current.role).toBeNull()
    expect(result.current.errorCode).toBe('SESSION_EXPIRED')
    expect(client.fetchWithBearerToken).not.toHaveBeenCalled()
  })

})
