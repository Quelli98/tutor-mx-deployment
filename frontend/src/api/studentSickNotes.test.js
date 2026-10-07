import { beforeEach, expect, it, vi } from 'vitest'
import { submitStudentSickNote, decideStudentSickNote } from './studentSickNotes'
import { clearRetryKeys } from './retryKey'
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('./client', () => ({ fetchWithBearerToken: mocks.fetch }))
beforeEach(() => { vi.clearAllMocks(); clearRetryKeys() })
it.each([['submit', submitStudentSickNote, { bookingVersion: 1, reason: 'Ill' }], ['decision', decideStudentSickNote, { version: 1, bookingVersion: 2, decision: 'APPROVED' }]])('retains the %s retry key after a lost response and releases it after success', async (_, action, payload) => {
 mocks.fetch.mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue({ data: { id: 7 } })
 await expect(action(7, payload, 'bearer')).rejects.toThrow('Connection lost'); await action(7, payload, 'bearer'); await action(7, payload, 'bearer')
 const bodies = mocks.fetch.mock.calls.map(([,options]) => JSON.parse(options.body)); expect(bodies[1].requestKey).toBe(bodies[0].requestKey); expect(bodies[2].requestKey).not.toBe(bodies[0].requestKey); expect(bodies[0]).toMatchObject(payload)
})
