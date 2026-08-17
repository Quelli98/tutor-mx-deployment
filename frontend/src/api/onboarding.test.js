import { describe, expect, it, vi } from 'vitest'
import { completeOnboarding } from './onboarding'
describe('completeOnboarding', () => {
  it('posts the selected role with the bearer token', async () => {
    const token = vi.fn().mockResolvedValue('token-1')
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { profile: { role: 'STUDENT' } } }) })
    await completeOnboarding('STUDENT', token)
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/auth/onboarding'), expect.objectContaining({ method: 'POST', body: JSON.stringify({ role: 'STUDENT' }), headers: expect.objectContaining({ Authorization: 'Bearer token-1' }) }))
  })
  it('rejects unknown roles before sending', async () => {
    globalThis.fetch = vi.fn(); await expect(completeOnboarding('ADMIN', vi.fn())).rejects.toThrow(/choose student/i); expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
