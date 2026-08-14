import { describe, it, expect, vi } from 'vitest'
import { fetchWithBearerToken, requestPasswordReset } from './client'

const getAccessTokenSilently = vi.fn()

describe('fetchWithBearerToken', () => {
  it('adds the bearer token to each request', async () => {
    getAccessTokenSilently.mockResolvedValue('token-123')
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ profile: { role: 'ORGANISER' } }),
    })

    await fetchWithBearerToken('/api/me', {}, getAccessTokenSilently)

    expect(getAccessTokenSilently).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/me'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      }),
    )
  })

  it('fails closed before sending when no token is available', async () => {
    globalThis.fetch = vi.fn()

    await expect(fetchWithBearerToken('/api/me', {}, null)).rejects.toThrow(
      /missing bearer token/i,
    )
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('uses the safe API error message for a rejected protected request', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { code: 'FORBIDDEN', message: 'Access denied.' } }),
    })

    await expect(fetchWithBearerToken('/api/me', {}, 'token-123')).rejects.toThrow(
      'Access denied.',
    )
  })
})

describe('requestPasswordReset', () => {
  it('posts the labelled email to the public Express route', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { message: 'safe response' } }),
    })

    await expect(requestPasswordReset('user@tutormx.example')).resolves.toEqual({
      data: { message: 'safe response' },
    })
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/password-reset'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'user@tutormx.example' }),
      }),
    )
  })

  it('reports a controlled reset error from the API', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: { message: 'Password reset is temporarily unavailable.' },
      }),
    })

    await expect(requestPasswordReset('user@tutormx.example')).rejects.toThrow(
      /temporarily unavailable/i,
    )
  })
})
