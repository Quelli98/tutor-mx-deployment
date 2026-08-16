import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as client from '../api/client'
import { useCurrentUser } from './useCurrentUser'

const getAccessTokenSilently = vi.fn()

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    isAuthenticated: true,
    getAccessTokenSilently,
  }),
}))

describe('useCurrentUser', () => {
  beforeEach(() => {
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
})
