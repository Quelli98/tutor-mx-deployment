import { beforeEach, describe, expect, it, vi } from 'vitest'
import { moveOccurrence, restoreOccurrence, skipOccurrence } from './availability'

const fetchWithBearerToken = vi.fn()
vi.mock('./client', () => ({ fetchWithBearerToken: (...args) => fetchWithBearerToken(...args) }))

const slot = {
  id: 4, type: 'BUSY', startsAt: '2026-02-03T08:00:00.000Z', endsAt: '2026-02-03T09:30:00.000Z',
  recurrence: 'WEEKLY', label: 'Lecture', recurrenceUntil: null, exceptions: [],
}

beforeEach(() => {
  fetchWithBearerToken.mockReset()
  fetchWithBearerToken.mockResolvedValue({ data: { timeSlot: slot } })
})

describe('single-week API', () => {
  it('skips, moves and restores one occurrence on the shared schedule path', async () => {
    await expect(skipOccurrence(4, '2026-02-17', 'token')).resolves.toEqual(slot)
    await moveOccurrence(4, '2026-02-17', { newStartsAt: '2026-02-18T08:00:00.000Z', newEndsAt: '2026-02-18T09:30:00.000Z' }, 'token')
    await restoreOccurrence(4, '2026-02-17', 'token')

    expect(fetchWithBearerToken.mock.calls.map(([path, options]) => [path, options.method, options.body ? JSON.parse(options.body) : null])).toEqual([
      ['/api/me/time-slots/4/exceptions/2026-02-17', 'PUT', { exceptionType: 'CANCELLED' }],
      ['/api/me/time-slots/4/exceptions/2026-02-17', 'PUT', { exceptionType: 'MOVED', newStartsAt: '2026-02-18T08:00:00.000Z', newEndsAt: '2026-02-18T09:30:00.000Z' }],
      ['/api/me/time-slots/4/exceptions/2026-02-17', 'DELETE', null],
    ])
  })

  it('refuses bad input before calling the server', async () => {
    await expect(skipOccurrence(0, '2026-02-17', 'token')).rejects.toThrow('Invalid busy time identifier.')
    await expect(skipOccurrence(4, '17/02/2026', 'token')).rejects.toThrow('Choose the week to change.')
    await expect(moveOccurrence(4, '2026-02-17', { newStartsAt: '2026-02-18T09:00:00.000Z', newEndsAt: '2026-02-18T08:00:00.000Z' }, 'token'))
      .rejects.toThrow('The new end time must be after the new start time.')
    expect(fetchWithBearerToken).not.toHaveBeenCalled()
  })

  it('rejects a response that is not a schedule entry', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: { timeSlot: { id: 'x' } } })
    await expect(restoreOccurrence(4, '2026-02-17', 'token')).rejects.toThrow('did not match the agreed contract')
  })
})
