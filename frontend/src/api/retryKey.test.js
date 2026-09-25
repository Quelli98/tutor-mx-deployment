import { describe, expect, it, vi } from 'vitest'
import { withRetryKey } from './retryKey'

describe('durable-write retry headers', () => {
  it('retains the key after uncertainty and releases it after success', async () => {
    const first = vi.fn().mockRejectedValue(new Error('connection lost'))
    await expect(withRetryKey('test-retry', { id: 1 }, first)).rejects.toThrow()
    const next = vi.fn().mockResolvedValue('saved')
    await withRetryKey('test-retry', { id: 1 }, next)
    expect(next.mock.calls[0][0]).toBe(first.mock.calls[0][0])
    await withRetryKey('test-retry', { id: 1 }, next)
    expect(next.mock.calls[1][0]).not.toBe(next.mock.calls[0][0])
  })
  it('gives changed content and different operations separate keys', async () => {
    const send = vi.fn().mockRejectedValue(new Error('offline'))
    for (const [scope, payload] of [['one', 1], ['one', 2], ['two', 1]]) {
      await expect(withRetryKey(scope, payload, send)).rejects.toThrow()
    }
    expect(new Set(send.mock.calls.map(([key]) => key)).size).toBe(3)
  })
})
