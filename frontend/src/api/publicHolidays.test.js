import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithBearerToken } from './client'
import { getPublicHolidays } from './publicHolidays'

vi.mock('./client', () => ({
  fetchWithBearerToken: vi.fn(),
}))

describe('getPublicHolidays', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the protected backend adapter and returns safe data', async () => {
    const holidays = [
      {
        date: '2026-12-16',
        name: 'Day of Reconciliation',
        countryCode: 'ZA',
        nationalHoliday: true,
        holidayTypes: ['Public'],
      },
    ]
    fetchWithBearerToken.mockResolvedValue({
      data: {
        source: 'external',
        holidays,
        retrievedAt: '2026-09-12T10:00:00.000Z',
      },
    })

    await expect(getPublicHolidays(vi.fn(), 2026)).resolves.toEqual({
      source: 'external',
      holidays,
      retrievedAt: '2026-09-12T10:00:00.000Z',
    })
    expect(fetchWithBearerToken).toHaveBeenCalledWith(
      '/api/public-holidays?year=2026',
      {},
      expect.any(Function),
    )
  })

  it('normalizes the safe non-blocking fallback', async () => {
    fetchWithBearerToken.mockResolvedValue({
      data: {
        source: 'fallback',
        holidays: [],
        retrievedAt: null,
        reason: 'unavailable',
      },
    })

    await expect(getPublicHolidays(vi.fn(), 2026)).resolves.toEqual({
      source: 'fallback',
      holidays: [],
      retrievedAt: null,
    })
  })

  it('rejects an invalid public-holiday response', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: {} })

    await expect(getPublicHolidays(vi.fn(), 2026)).rejects.toThrow(
      /agreed contract/i,
    )
  })
})
