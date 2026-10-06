import { describe, expect, it } from 'vitest'
import { courseTones, monthGrid, sameDay, scheduleItems, splitRequests, studentSummary, workByDay } from './studentHome'

const now = new Date('2026-10-06T12:00:00')

const request = (overrides) => ({
  id: 1, status: 'ACCEPTED', courseCode: 'COMS3011A', hours: 2,
  startsAt: '2026-10-07T09:00:00', endsAt: '2026-10-07T11:00:00', ...overrides,
})

describe('studentSummary', () => {
  it('counts open work, pending requests, upcoming approved sessions and approved hours', () => {
    const summary = studentSummary({
      now,
      workItems: [{ status: 'OPEN' }, { status: 'OPEN' }, { status: 'FILLED' }],
      requests: [
        request({ id: 1, startsAt: '2026-10-09T09:00:00', endsAt: '2026-10-09T10:30:00', hours: 1.5 }),
        request({ id: 2 }),
        request({ id: 3, startsAt: '2026-10-01T09:00:00', endsAt: '2026-10-01T11:00:00' }),
        request({ id: 4, status: 'PENDING' }),
        request({ id: 5, status: 'REJECTED' }),
      ],
    })

    expect(summary).toMatchObject({ openCount: 2, pendingCount: 1, upcomingCount: 2, approvedHours: 5.5 })
    expect(summary.nextSession.id).toBe(2)
  })

  it('has nothing to say about an empty workspace', () => {
    expect(studentSummary({ now })).toEqual({ openCount: 0, pendingCount: 0, upcomingCount: 0, nextSession: null, approvedHours: 0 })
  })
})

describe('scheduleItems', () => {
  const weeklyLecture = {
    id: 9, type: 'BUSY', startsAt: '2026-09-22T08:00:00', endsAt: '2026-09-22T09:45:00',
    recurrence: 'WEEKLY', label: 'COMS2002 Lecture', recurrenceUntil: null, category: 'CLASS', exceptions: [],
  }

  it('expands repeating classes and adds approved volunteer sessions in order', () => {
    const items = scheduleItems({
      slots: [weeklyLecture],
      requests: [request({}), request({ id: 2, status: 'PENDING', startsAt: '2026-10-08T09:00:00', endsAt: '2026-10-08T10:00:00' })],
      from: new Date('2026-10-05T00:00:00'),
      to: new Date('2026-10-19T00:00:00'),
    })

    expect(items.map((item) => [item.kind, item.title, item.startsAt.getDate()])).toEqual([
      ['class', 'COMS2002 Lecture', 6],
      ['volunteer', 'COMS3011A volunteer session', 7],
      ['class', 'COMS2002 Lecture', 13],
    ])
  })

  it('keeps an entry that runs past midnight once and marks busy time', () => {
    const items = scheduleItems({
      slots: [{ ...weeklyLecture, recurrence: null, category: 'UNAVAILABLE', label: 'Night shift',
        startsAt: '2026-10-07T22:00:00', endsAt: '2026-10-08T02:00:00' }],
      requests: [],
      from: new Date('2026-10-05T00:00:00'),
      to: new Date('2026-10-12T00:00:00'),
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'busy', title: 'Night shift' })
    expect(items[0].endsAt.getHours()).toBe(2)
  })

  it('leaves out anything outside the window', () => {
    expect(scheduleItems({
      slots: [],
      requests: [request({ startsAt: '2026-11-07T09:00:00', endsAt: '2026-11-07T11:00:00' })],
      from: new Date('2026-10-01T00:00:00'),
      to: new Date('2026-11-01T00:00:00'),
    })).toEqual([])
  })
})

describe('monthGrid', () => {
  it('lays a month out in Monday-first weeks', () => {
    const weeks = monthGrid(new Date('2026-10-01T00:00:00'))
    expect(weeks).toHaveLength(5)
    expect(weeks[0].slice(0, 3)).toEqual([null, null, null])
    expect(weeks[0][3].getDate()).toBe(1)
    expect(weeks.at(-1).filter(Boolean).at(-1).getDate()).toBe(31)
    expect(weeks.every((week) => week.length === 7)).toBe(true)
  })

  it('compares calendar days, not instants', () => {
    expect(sameDay(new Date('2026-10-06T00:01:00'), new Date('2026-10-06T23:59:00'))).toBe(true)
    expect(sameDay(new Date('2026-10-06T23:59:00'), new Date('2026-10-07T00:01:00'))).toBe(false)
  })
})

describe('workByDay', () => {
  it('groups open work by the day it starts, soonest first', () => {
    const work = (id, startsAt) => ({ id, startsAt })
    const days = workByDay([
      work(3, '2026-10-09T14:00:00'),
      work(1, '2026-10-07T14:15:00'),
      work(2, '2026-10-07T09:00:00'),
    ])

    expect(days.map((day) => day.date.getDate())).toEqual([7, 9])
    expect(days[0].items.map((item) => item.id)).toEqual([2, 1])
  })
})

describe('splitRequests', () => {
  it('keeps waiting and still-to-come approved requests current, and the rest past', () => {
    const { current, past } = splitRequests([
      request({ id: 1, status: 'PENDING', startsAt: '2026-10-09T09:00:00', endsAt: '2026-10-09T11:00:00' }),
      request({ id: 2, status: 'ACCEPTED' }),
      request({ id: 3, status: 'ACCEPTED', startsAt: '2026-10-01T09:00:00', endsAt: '2026-10-01T11:00:00' }),
      request({ id: 4, status: 'REJECTED', startsAt: '2026-10-04T09:00:00', endsAt: '2026-10-04T11:00:00' }),
      request({ id: 5, status: 'WITHDRAWN', startsAt: '2026-10-12T09:00:00', endsAt: '2026-10-12T11:00:00' }),
      // A request still waiting stays current even once its session has passed.
      request({ id: 6, status: 'PENDING', startsAt: '2026-10-02T09:00:00', endsAt: '2026-10-02T11:00:00' }),
    ], now)

    expect(current.map((entry) => entry.id)).toEqual([6, 2, 1])
    expect(past.map((entry) => entry.id)).toEqual([5, 4, 3])
  })
})

describe('courseTones', () => {
  it('gives each course one colour in code order, whatever order they arrive in', () => {
    expect([...courseTones(['COMS3', 'COMS1', 'COMS3', null, 'COMS2'])]).toEqual([
      ['COMS1', 'accent-pink'],
      ['COMS2', 'accent-blue'],
      ['COMS3', 'accent-orchid'],
    ])
  })
})

