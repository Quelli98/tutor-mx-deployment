import { describe, expect, it } from 'vitest'
import { parseTutorDashboardResponse } from './tutorDashboard'

const base = { allocations: [], weeklyLimit: 10, usedHours: 0, remainingHours: 10 }
const owed = { kind: 'LOG_HOURS', title: 'Log your hours', weekEnding: '2026-10-11', dueAt: null, overdue: false, allocationId: 4, timesheetId: null }

describe('dashboard obligations contract', () => {
  it('defaults to nothing owed when an older server sends none', () => {
    expect(parseTutorDashboardResponse({ data: { dashboard: base } }).obligations).toEqual([])
  })

  it('keeps well-formed obligations', () => {
    const dashboard = parseTutorDashboardResponse({ data: { dashboard: { ...base, obligations: [owed, { ...owed, kind: 'RESUBMIT_TIMESHEET', dueAt: '2026-10-08T08:00:00.000Z' }] } } })
    expect(dashboard.obligations).toHaveLength(2)
  })

  it.each([
    ['not a list', { obligations: 'none' }],
    ['an unknown kind', { obligations: [{ ...owed, kind: 'PAY_TUTOR' }] }],
    ['a bad week', { obligations: [{ ...owed, weekEnding: 'Sunday' }] }],
    ['a bad due date', { obligations: [{ ...owed, dueAt: 'soon' }] }],
    ['a missing overdue flag', { obligations: [{ ...owed, overdue: 'yes' }] }],
  ])('rejects %s', (_name, extra) => {
    expect(() => parseTutorDashboardResponse({ data: { dashboard: { ...base, ...extra } } })).toThrow('agreed contract')
  })
})
