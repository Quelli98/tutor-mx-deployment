import { describe, expect, it } from 'vitest'
import {
  budgetUsed,
  courseAccents,
  courseCards,
  initials,
  money,
  neighbouringWeeks,
  requirementsForWeek,
  sumHours,
  timetableWeek,
  toIsoDate,
  tutorLoads,
  yearToDatePeriod,
} from './organiserHome'

const monday = new Date(2026, 8, 21)

function requirement(overrides) {
  return {
    id: 1,
    courseId: 3,
    courseCode: 'COMS1018A',
    startsAt: new Date(2026, 8, 22, 14, 15).toISOString(),
    endsAt: new Date(2026, 8, 22, 17, 0).toISOString(),
    status: 'OPEN',
    shortageTutors: 2,
    ...overrides,
  }
}

describe('organiser Home figures', () => {
  it('adds quarter hours without floating-point noise', () => {
    expect(sumHours([{ h: 0.1 }, { h: 0.2 }], 'h')).toBe(0.3)
    expect(sumHours([{ h: 2.75 }, { h: 1.25 }, { h: null }], 'h')).toBe(4)
  })

  it('writes money the same way as the Reports page', () => {
    expect(money(48360)).toBe('R48360.00')
    expect(money(null)).toBe('--')
  })

  it('keeps only open requirements that start in the week, soonest first', () => {
    const rows = requirementsForWeek(
      [
        requirement({ id: 1, startsAt: new Date(2026, 8, 24, 9).toISOString() }),
        requirement({ id: 2, startsAt: new Date(2026, 8, 22, 9).toISOString() }),
        requirement({ id: 3, status: 'CLOSED' }),
        requirement({ id: 4, startsAt: new Date(2026, 8, 28, 9).toISOString() }),
        requirement({ id: 5, startsAt: new Date(2026, 8, 20, 23).toISOString() }),
      ],
      monday,
    )
    expect(rows.map((row) => row.id)).toEqual([2, 1])
  })

  it('reports the year so far, never more than the 52 weeks the server allows', () => {
    expect(yearToDatePeriod(monday)).toEqual({ weekStart: '2025-12-29', weeks: 39 })
    expect(yearToDatePeriod(new Date(2026, 0, 5))).toEqual({ weekStart: '2025-12-29', weeks: 2 })
    const lateMonday = new Date(2020, 11, 28)
    const period = yearToDatePeriod(lateMonday)
    expect(period.weeks).toBe(52)
    expect(toIsoDate(new Date(`${period.weekStart}T00:00:00`))).toBe('2020-01-06')
  })

  it('measures budget used only across courses with both a budget and a spend', () => {
    expect(
      budgetUsed([
        { budget: 1000, spend: 250 },
        { budget: 3000, spend: 750.5 },
        { budget: null, spend: 90 },
        { budget: 500, spend: null },
      ]),
    ).toEqual({ spend: 1000.5, budget: 4000, fraction: 1000.5 / 4000 })
    expect(budgetUsed([{ budget: null, spend: null }])).toBeNull()
    expect(budgetUsed([{ budget: 0, spend: 10 }])).toEqual({ spend: 10, budget: 0, fraction: 1 })
  })

  it('orders course cards by this week’s hours and counts each tutor once', () => {
    const courses = [
      { id: 1, code: 'COMS2002A', name: 'Database Fundamentals' },
      { id: 2, code: 'COMS1018A', name: 'Basic Computer Organisation' },
      { id: 3, code: 'COMS3011A', name: 'Software Design Project' },
      { id: 4, code: 'APPM1006A', name: 'Applied Mathematics' },
    ]
    const at = (day, hour) => new Date(2026, 8, day, hour).toISOString()
    const allocations = [
      { id: 1, courseId: 2, tutorId: 7, startsAt: at(22, 14), status: 'CONFIRMED' },
      { id: 2, courseId: 2, tutorId: 7, startsAt: at(24, 14), status: 'CONFIRMED' },
      { id: 3, courseId: 2, tutorId: 8, startsAt: at(23, 10), status: 'PROPOSED' },
      { id: 4, courseId: 2, tutorId: 9, startsAt: at(23, 12), status: 'CANCELLED' },
      { id: 5, courseId: 2, tutorId: 10, startsAt: at(30, 9), status: 'CONFIRMED' },
    ]
    const weekReport = { courses: [{ courseId: 2, allocatedHours: 9 }, { courseId: 1, allocatedHours: 4 }] }
    const yearReport = { courses: [{ courseId: 2, budget: 1000, spend: 620 }] }

    const cards = courseCards(courses, allocations, weekReport, yearReport, monday, new Date(2026, 8, 23, 11))

    expect(cards.map((card) => card.code)).toEqual(['COMS1018A', 'COMS2002A', 'APPM1006A'])
    expect(cards[0]).toMatchObject({ tutorsThisWeek: 2, hoursThisWeek: 9, budgetFraction: 0.62, accent: 'magenta' })
    expect(cards[0].nextSession).toBe(at(24, 14))
    expect(cards[1]).toMatchObject({ tutorsThisWeek: 0, budgetFraction: null, nextSession: null, accent: 'violet' })
  })

  it('lists the fullest tutors first and tutors without a limit last', () => {
    const loads = tutorLoads([
      { id: 1, fullName: 'Aisha Patel', email: 'a@x', usedHours: 9, weeklyHours: 12, capacityStatus: 'available' },
      { id: 2, fullName: ' ', email: 'thabo@wits.ac.za', usedHours: 14, weeklyHours: 15, capacityStatus: 'near-limit' },
      { id: 3, fullName: 'Pieter van Wyk', email: 'p@x', usedHours: 3, weeklyHours: null, capacityStatus: 'not-set' },
    ])
    expect(loads.map((tutor) => tutor.name)).toEqual(['thabo@wits.ac.za', 'Aisha Patel', 'Pieter van Wyk'])
    expect(loads[2].fraction).toBeNull()
  })

  it('makes two-letter initials from a name or an email', () => {
    expect(initials('Naledi Mokoena')).toBe('NM')
    expect(initials('thabo.nkosi@wits.ac.za')).toBe('TN')
    expect(initials('Zanele')).toBe('ZA')
  })

  it('lays a week out by day, with tutors on the same session together and weekends only when used', () => {
    const allocation = (id, courseId, day, hour, tutorName, hours = 2.75) => ({
      id,
      courseId,
      courseCode: `COMS${courseId}`,
      courseName: `Course ${courseId}`,
      tutorName,
      startsAt: new Date(2026, 8, day, hour, 15).toISOString(),
      endsAt: new Date(2026, 8, day, hour + 2, 45).toISOString(),
      allocatedHours: hours,
    })
    const week = timetableWeek(
      [
        allocation(1, 3, 22, 14, 'Thabo Nkosi'),
        allocation(2, 3, 22, 14, 'Lerato Dlamini'),
        allocation(3, 5, 22, 9, 'Aisha Patel', 1.5),
        allocation(4, 3, 26, 10, 'Pieter van Wyk'),
        allocation(5, 3, 29, 14, 'Thabo Nkosi'),
      ],
      monday,
    )

    expect(week.days.map((day) => toIsoDate(day.date))).toEqual([
      '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26',
    ])
    const tuesday = week.days[1].sessions
    expect(tuesday.map((session) => session.courseCode)).toEqual(['COMS5', 'COMS3'])
    expect(tuesday[1].allocations.map((entry) => entry.tutorName)).toEqual(['Lerato Dlamini', 'Thabo Nkosi'])
    expect(week.count).toBe(4)
    expect(week.hours).toBe(9.75)
  })

  it('finds the nearest earlier and later weeks that have allocations', () => {
    const on = (id, month, day) => ({ id, courseId: 1, startsAt: new Date(2026, month, day, 10).toISOString() })
    const allocations = [on(1, 8, 2), on(2, 8, 22), on(3, 9, 13), on(4, 9, 14)]

    const { previous, next } = neighbouringWeeks(allocations, monday)
    expect(toIsoDate(previous.weekStart)).toBe('2026-08-31')
    expect(previous.count).toBe(1)
    expect(toIsoDate(next.weekStart)).toBe('2026-10-12')
    expect(next.count).toBe(2)
    expect(neighbouringWeeks([on(2, 8, 22)], monday)).toEqual({ previous: null, next: null })
  })

  it('gives each course one colour that does not depend on the week shown', () => {
    const accents = courseAccents([{ courseId: 9 }, { courseId: 2 }, { courseId: 9 }, { courseId: 4 }])
    expect([...accents]).toEqual([[2, 'pink'], [4, 'blue'], [9, 'orchid']])
  })
})
