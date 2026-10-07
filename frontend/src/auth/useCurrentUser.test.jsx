import { act, renderHook, waitFor } from '@testing-library/react'
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
  it('keeps a failed sign-out locked on a new mount', async () => {
    invalidateSession('You have signed out of this workspace.')
    const { result } = renderHook(() => useCurrentUser())
    expect(result.current.role).toBeNull()
    expect(result.current.errorCode).toBe('SESSION_EXPIRED')
    expect(client.fetchWithBearerToken).not.toHaveBeenCalled()
  })

})
