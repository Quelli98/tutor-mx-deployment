import { describe, expect, it, vi } from 'vitest'
import { completeOnboarding, resendVerificationEmail } from './onboarding'
describe('completeOnboarding', () => {
  it('posts the selected role with the bearer token', async () => {
    const token = vi.fn().mockResolvedValue('token-1')
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { profile: { role: 'STUDENT' } } }) })
    await completeOnboarding('STUDENT', token)
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/auth/onboarding'), expect.objectContaining({ method: 'POST', body: JSON.stringify({ role: 'STUDENT' }), headers: expect.objectContaining({ Authorization: 'Bearer token-1' }) }))
  })
  it('uses the separate lecturer organiser-registration endpoint', async () => {
    const token = vi.fn().mockResolvedValue('token-2')
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { application: { status: 'PENDING' } } }) })
    await completeOnboarding('ORGANISER', token)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/organiser-registration'),
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer token-2' }) }),
    )
    expect(globalThis.fetch.mock.calls[0][1].body).toBeUndefined()
  })
  it('rejects unknown roles before sending', async () => {
    globalThis.fetch = vi.fn(); await expect(completeOnboarding('ADMIN', vi.fn())).rejects.toThrow(/choose student/i); expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe('resendVerificationEmail', () => {
  it('posts to the resend-verification endpoint with the bearer token and no body', async () => {
    const token = vi.fn().mockResolvedValue('token-2')
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { message: 'If your account needs verification, Auth0 will send an email.' } }) })

    await resendVerificationEmail(token)

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/resend-verification'),
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer token-2' }) }),
    )
    const call = globalThis.fetch.mock.calls[0]
    expect(call[1].body).toBeUndefined()
  })
})
