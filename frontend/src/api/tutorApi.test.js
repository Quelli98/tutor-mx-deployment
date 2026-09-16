import { beforeEach, describe, expect, it, vi } from 'vitest'
import { submitTimeSlot } from './availability'
import { fetchExcuseStatus, parseExcuseStatusResponse, submitExcuse } from './excuse'
import { fetchTutorDashboard, parseTutorDashboardResponse } from './tutorDashboard'
import { fetchTimesheetStatus, parseTimesheetResponse, submitTimesheet } from './timesheet'
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
const timesheet = {
  id: 12,
  weekStart: '2030-09-02',
  status: 'DRAFT',
  submittedAt: null,
  reviewedAt: null,
  reviewReason: null,
  totalHours: 2,
}
const excuseStatus = {
  id: 5,
  allocationId: 1,
  reason: 'Sick',
  status: 'PENDING',
  reviewReason: null,
  createdAt: '2030-09-03T08:00:00.000Z',
  updatedAt: '2030-09-03T08:00:00.000Z',
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
    const timeSlot = {
      id: 2,
      type: 'BUSY',
      startsAt: '2030-09-04T14:00:00.000Z',
      endsAt: '2030-09-04T16:00:00.000Z',
      recurrence: null,
      label: null,
      recurrenceUntil: null,
    }
    fetchWithBearerToken.mockResolvedValueOnce({ data: { timeSlot } })
    await expect(
      submitTimeSlot(
        {
          type: 'BUSY',
          startsAt: '2030-09-04T14:00:00.000Z',
          endsAt: '2030-09-04T16:00:00.000Z',
        },
        tokenGetter,
      ),
    ).resolves.toEqual(timeSlot)
    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(
      '/api/tutor/time-slots',
      {
        method: 'POST',
        body: JSON.stringify({
          type: 'BUSY',
          startsAt: '2030-09-04T14:00:00.000Z',
          endsAt: '2030-09-04T16:00:00.000Z',
          label: null,
          recurrenceUntil: null,
        }),
      },
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
    const validSlotInput = {
      type: 'BUSY',
      startsAt: '2030-09-04T14:00:00.000Z',
      endsAt: '2030-09-04T16:00:00.000Z',
    }
    fetchWithBearerToken.mockResolvedValue({ data: {} })
    await expect(submitTimeSlot(validSlotInput, tokenGetter)).rejects.toThrow(/agreed contract/i)
    await expect(submitWorkLog({}, tokenGetter)).rejects.toThrow(/agreed contract/i)
    await expect(submitExcuse({}, tokenGetter)).rejects.toThrow(/agreed contract/i)
  })

  it('gets and submits the tutor timesheet using only the timesheet id', async () => {
    fetchWithBearerToken.mockResolvedValueOnce({ data: { timesheet } })
    await expect(fetchTimesheetStatus(12, tokenGetter)).resolves.toEqual(timesheet)
    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(
      '/api/tutor/timesheets/12/status',
      {},
      tokenGetter,
    )

    const submitted = {
      ...timesheet,
      status: 'SUBMITTED',
      submittedAt: '2030-09-06T12:00:00.000Z',
    }
    fetchWithBearerToken.mockResolvedValueOnce({ data: { timesheet: submitted } })
    await expect(submitTimesheet(12, tokenGetter)).resolves.toEqual(submitted)
    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(
      '/api/tutor/timesheets/12/submit',
      { method: 'POST' },
      tokenGetter,
    )
  })

  it('accepts a returned timesheet with the organiser review fields', () => {
    expect(
      parseTimesheetResponse({
        data: {
          timesheet: {
            ...timesheet,
            status: 'RETURNED',
            submittedAt: '2030-09-06T12:00:00.000Z',
            reviewedAt: '2030-09-09T08:30:00.000Z',
            reviewReason: 'Please correct Tuesday hours',
            totalHours: 3.5,
          },
        },
      }),
    ).toMatchObject({
      status: 'RETURNED',
      reviewReason: 'Please correct Tuesday hours',
      totalHours: 3.5,
    })
  })

  it('rejects malformed timesheet responses', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: {} })
    await expect(fetchTimesheetStatus(12, tokenGetter)).rejects.toThrow(/agreed contract/i)
    await expect(submitTimesheet(12, tokenGetter)).rejects.toThrow(/agreed contract/i)

    expect(() =>
      parseTimesheetResponse({
        data: { timesheet: { ...timesheet, status: 'APPROVING' } },
      }),
    ).toThrow(/agreed contract/i)
    expect(() =>
      parseTimesheetResponse({ data: { timesheet: { ...timesheet, totalHours: -1 } } }),
    ).toThrow(/agreed contract/i)
  })

  it('gets the tutor excuse status using only the excuse id', async () => {
    fetchWithBearerToken.mockResolvedValueOnce({ data: { excuse: excuseStatus } })
    await expect(fetchExcuseStatus(5, tokenGetter)).resolves.toEqual(excuseStatus)
    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(
      '/api/tutor/excuses/5/status',
      {},
      tokenGetter,
    )
  })

  it('accepts a rejected excuse with the organiser review fields', () => {
    expect(
      parseExcuseStatusResponse({
        data: {
          excuse: {
            ...excuseStatus,
            status: 'REJECTED',
            reviewReason: 'Insufficient evidence',
            updatedAt: '2030-09-04T09:00:00.000Z',
          },
        },
      }),
    ).toMatchObject({
      status: 'REJECTED',
      reviewReason: 'Insufficient evidence',
    })
  })

  it('rejects malformed excuse status responses', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: {} })
    await expect(fetchExcuseStatus(5, tokenGetter)).rejects.toThrow(/agreed contract/i)

    expect(() =>
      parseExcuseStatusResponse({
        data: { excuse: { ...excuseStatus, status: 'DECIDED' } },
      }),
    ).toThrow(/agreed contract/i)
    expect(() =>
      parseExcuseStatusResponse({ data: { excuse: { ...excuseStatus, reviewReason: 7 } } }),
    ).toThrow(/agreed contract/i)
  })
})
