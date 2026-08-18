import { beforeEach, describe, expect, it, vi } from 'vitest'
import { submitTimeSlot } from './availability'
import { submitExcuse } from './excuse'
import { fetchTutorDashboard, parseTutorDashboardResponse } from './tutorDashboard'
import { submitWorkLog } from './workLog'

const fetchWithBearerToken = vi.fn()

vi.mock('./client', () => ({
  fetchWithBearerToken: (...args) => fetchWithBearerToken(...args),
}))

const tokenGetter = vi.fn()
const dashboard = {
  allocations: [
    {
      id: 1,
      courseCode: 'DEMO101',
      courseName: 'Demo Course',
      startsAt: '2030-09-04T14:00:00.000Z',
      endsAt: '2030-09-04T16:00:00.000Z',
      allocatedHours: 2,
      status: 'CONFIRMED',
    },
  ],
  weeklyLimit: 10,
  usedHours: 6,
  remainingHours: 4,
}

describe('tutor API contract', () => {
  beforeEach(() => {
    fetchWithBearerToken.mockReset()
    tokenGetter.mockReset()
  })

  it('uses the own-dashboard URL and validates its safe projection', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: { dashboard } })

    await expect(fetchTutorDashboard(tokenGetter)).resolves.toEqual(dashboard)
    expect(fetchWithBearerToken).toHaveBeenCalledWith(
      '/api/tutor/dashboard',
      {},
      tokenGetter,
    )
    expect(fetchWithBearerToken.mock.calls[0][0]).not.toMatch(/tutorId|\/\d+/)
  })


  it('accepts a new tutor dashboard before the weekly-hour limit is configured', () => {
    expect(
      parseTutorDashboardResponse({
        data: {
          dashboard: {
            allocations: [],
            weeklyLimit: null,
            usedHours: 0,
            remainingHours: null,
          },
        },
      }),
    ).toEqual({
      allocations: [],
      weeklyLimit: null,
      usedHours: 0,
      remainingHours: null,
    })
  })

  it('fails when the dashboard contract changes or exposes a tutor id', () => {
    expect(() => parseTutorDashboardResponse({ data: { dashboard: {} } })).toThrow(
      /agreed contract/i,
    )
    expect(() =>
      parseTutorDashboardResponse({
        data: {
          dashboard: {
            ...dashboard,
            allocations: [{ ...dashboard.allocations[0], tutorId: 999 }],
          },
        },
      }),
    ).toThrow(/agreed contract/i)
  })

  it('posts availability, work logs and excuses with the shared bearer helper', async () => {
    const timeSlot = { id: 2, type: 'BUSY' }
    fetchWithBearerToken.mockResolvedValueOnce({ data: { timeSlot } })
    await expect(
      submitTimeSlot({ type: 'BUSY' }, tokenGetter),
    ).resolves.toEqual(timeSlot)
    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(
      '/api/tutor/time-slots',
      { method: 'POST', body: JSON.stringify({ type: 'BUSY' }) },
      tokenGetter,
    )

    const workLog = { id: 3, timesheetId: 4 }
    fetchWithBearerToken.mockResolvedValueOnce({ data: { workLog } })
    await expect(
      submitWorkLog({ allocationId: 1 }, tokenGetter),
    ).resolves.toEqual(workLog)
    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(
      '/api/tutor/work-logs',
      { method: 'POST', body: JSON.stringify({ allocationId: 1 }) },
      tokenGetter,
    )

    const excuse = { id: 5, status: 'PENDING' }
    fetchWithBearerToken.mockResolvedValueOnce({ data: { excuse } })
    await expect(
      submitExcuse({ allocationId: 1, reason: 'Sick' }, tokenGetter),
    ).resolves.toEqual(excuse)
    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(
      '/api/tutor/excuses',
      {
        method: 'POST',
        body: JSON.stringify({ allocationId: 1, reason: 'Sick' }),
      },
      tokenGetter,
    )
  })

  it('rejects malformed mutation responses', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: {} })
    await expect(submitTimeSlot({}, tokenGetter)).rejects.toThrow(/agreed contract/i)
    await expect(submitWorkLog({}, tokenGetter)).rejects.toThrow(/agreed contract/i)
    await expect(submitExcuse({}, tokenGetter)).rejects.toThrow(/agreed contract/i)
  })
})
