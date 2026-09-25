import { describe, expect, it } from 'vitest'
import {
  BUDGET_STATUS,
  DRILL_DOWN_LABELS,
  DRILL_DOWN_PATHS,
  STAFFING_STATUS,
  STAFFING_STATUS_TONES,
  buildBudgetPanel,
  buildHeatmap,
  buildKpis,
  buildWorkloadPanel,
  courseDetailPath,
  isEmptyPeriod,
  staffingStatusFor,
  staffingStatusLabel,
  tutorDetailPath,
} from './commandCentreModel'

/** Every screen a drill-down may point at: the organiser routes that exist. */
const ORGANISER_ROUTES = [
  '/organiser',
  '/organiser/courses',
  '/organiser/tutors',
  '/organiser/staffing',
  '/organiser/staffing/bulk',
  '/organiser/reports',
  '/organiser/approvals',
  '/organiser/overflow',
]

function requirement(overrides = {}) {
  return {
    id: 12,
    courseId: 3,
    courseCode: 'COMS3011',
    courseName: 'Software Design Project',
    startsAt: '2030-09-04T14:00:00.000Z',
    endsAt: '2030-09-04T18:00:00.000Z',
    tutorsNeeded: 2,
    windowHours: 4,
    requiredHours: 8,
    assignedHours: 0,
    shortageHours: 8,
    shortageTutors: 2,
    fillState: 'unfilled',
    status: 'OPEN',
    notes: null,
    createdById: 8,
    createdAt: '2026-09-21T09:00:00.000Z',
    updatedAt: '2026-09-21T09:00:00.000Z',
    ...overrides,
  }
}

function day(date, overrides = {}) {
  return {
    date,
    requiredHours: 0,
    assignedHours: 0,
    unfilledHours: 0,
    requirements: 0,
    fillState: null,
    ...overrides,
  }
}

function course(overrides = {}) {
  return {
    courseId: 3,
    courseCode: 'COMS3011',
    courseName: 'Software Design Project',
    allocatedHours: 0,
    approvedWorkedHours: 0,
    hourlyRate: null,
    budget: null,
    spend: null,
    committed: null,
    budgetRemaining: null,
    ...overrides,
  }
}

function tutor(overrides = {}) {
  return {
    tutorId: 7,
    fullName: 'Ada Tutor',
    capacityHours: 40,
    allocatedHours: 0,
    approvedWorkedHours: 0,
    shareOfAllocatedHours: 0,
    ...overrides,
  }
}

/** A period with nothing in it, which each test then fills in. */
function summary(overrides = {}) {
  return {
    period: {
      weekStart: '2030-09-02T00:00:00.000Z',
      weekEnd: '2030-09-30T00:00:00.000Z',
      weeks: 4,
    },
    staffing: {
      requiredHours: 0,
      assignedHours: 0,
      unfilledHours: 0,
      openRequirements: 0,
      unfilledRequirements: 0,
      requirements: [],
      days: [],
    },
    finance: {
      budget: null,
      spend: null,
      committed: null,
      remaining: null,
      overBudgetCourses: 0,
      unpricedCourses: 0,
      courses: [],
    },
    workload: { tutors: [] },
    actions: {
      pendingTimesheets: 0,
      pendingVolunteerClaims: 0,
      pendingExcuses: 0,
      openDisputes: 0,
      total: 0,
    },
    overflow: { openItems: 0, openHours: 0, unclaimedItems: 0 },
    ...overrides,
  }
}

function kpiOf(kpis, key) {
  return kpis.find((kpi) => kpi.key === key)
}

function staffingWith(overrides) {
  return { ...summary().staffing, ...overrides }
}

function financeWith(overrides) {
  return { ...summary().finance, ...overrides }
}

describe('commandCentreModel KPI cards', () => {
  it('shows zeros and unset money rather than inventing figures', () => {
    const kpis = buildKpis(summary())

    expect(kpis).toHaveLength(6)
    expect(kpiOf(kpis, 'allocated').value).toBe('0 h')
    expect(kpiOf(kpis, 'required').value).toBe('0 h')
    expect(kpiOf(kpis, 'unfilled').value).toBe('0 h')
    expect(kpiOf(kpis, 'spend').value).toBe('--')
    expect(kpiOf(kpis, 'budget').value).toBe('--')
    expect(kpiOf(kpis, 'actions').value).toBe('0')
    expect(kpiOf(kpis, 'unfilled').tone).toBe('success')
    expect(kpiOf(kpis, 'actions').tone).toBe('success')
  })

  it('turns unfilled work into a danger card and says how many requirements are short', () => {
    const kpis = buildKpis(
      summary({
        staffing: staffingWith({
          requiredHours: 16,
          assignedHours: 6,
          unfilledHours: 10,
          openRequirements: 2,
          unfilledRequirements: 1,
        }),
      }),
    )

    expect(kpiOf(kpis, 'unfilled').value).toBe('10 h')
    expect(kpiOf(kpis, 'unfilled').tone).toBe('danger')
    expect(kpiOf(kpis, 'unfilled').detail).toBe('1 requirement short of tutors.')
    expect(kpiOf(kpis, 'allocated').detail).toBe('Booked across 2 open requirements.')
  })

  it('says the period is covered when nothing is short', () => {
    const kpis = buildKpis(
      summary({
        staffing: staffingWith({
          requiredHours: 8,
          assignedHours: 8,
          openRequirements: 1,
        }),
      }),
    )

    expect(kpiOf(kpis, 'unfilled').value).toBe('0 h')
    expect(kpiOf(kpis, 'unfilled').tone).toBe('success')
    expect(kpiOf(kpis, 'unfilled').detail).toBe('Every open requirement is covered.')
  })

  it('names the courses over budget instead of only colouring the card', () => {
    const kpis = buildKpis(
      summary({
        finance: financeWith({
          budget: 1500,
          spend: 1900,
          committed: 300,
          remaining: -400,
          overBudgetCourses: 1,
        }),
      }),
    )

    expect(kpiOf(kpis, 'budget').tone).toBe('danger')
    expect(kpiOf(kpis, 'budget').detail).toBe('1 course over budget.')
    expect(kpiOf(kpis, 'spend').value).toBe('R1900.00')
  })

  it('states what is left when the period is inside its budget', () => {
    const kpis = buildKpis(
      summary({
        finance: financeWith({
          budget: 1500,
          spend: 1100,
          committed: 300,
          remaining: 400,
        }),
      }),
    )

    expect(kpiOf(kpis, 'budget').tone).toBe('neutral')
    expect(kpiOf(kpis, 'budget').detail).toBe('R400.00 left to spend.')
  })

  it('says so when money cannot be worked out at all', () => {
    const kpis = buildKpis(
      summary({ finance: financeWith({ spend: null, unpricedCourses: 2 }) }),
    )

    expect(kpiOf(kpis, 'spend').detail).toBe('No hourly rate is set, so spend cannot be worked out.')
    expect(kpiOf(kpis, 'budget').detail).toBe('No budget is set for the courses in this period.')
  })

  it('lists the queues waiting on the organiser, and nothing when they are clear', () => {
    const quiet = buildKpis(summary())
    expect(kpiOf(quiet, 'actions').detail).toBe('Nothing is waiting on you in this period.')

    const busy = buildKpis(
      summary({
        actions: {
          pendingTimesheets: 2,
          pendingVolunteerClaims: 0,
          pendingExcuses: 1,
          openDisputes: 1,
          total: 4,
        },
      }),
    )
    expect(kpiOf(busy, 'actions').value).toBe('4')
    expect(kpiOf(busy, 'actions').tone).toBe('warning')
    expect(kpiOf(busy, 'actions').detail).toBe(
      'Waiting on you: 2 timesheets, 1 excuse, 1 dispute.',
    )
  })

  it('points every card at a screen that exists and labels the link', () => {
    for (const kpi of buildKpis(summary())) {
      expect(ORGANISER_ROUTES).toContain(kpi.path)
      expect(kpi.linkLabel).toBeTruthy()
    }
    expect(Object.keys(DRILL_DOWN_PATHS).sort()).toEqual(Object.keys(DRILL_DOWN_LABELS).sort())
  })
})

describe('commandCentreModel staffing heatmap', () => {
  it('groups the days the server sent into weeks, in order', () => {
    const days = Array.from({ length: 10 }, (_, index) =>
      day(`2030-09-${String(2 + index).padStart(2, '0')}`),
    )
    const heatmap = buildHeatmap(summary({ staffing: staffingWith({ days }) }))

    expect(heatmap.weeks).toHaveLength(2)
    expect(heatmap.weeks[0]).toHaveLength(7)
    expect(heatmap.weeks[1]).toHaveLength(3)
    expect(heatmap.weeks[0][0].date).toBe('2030-09-02')
    expect(heatmap.weeks[0][0].weekday).toMatch(/^Mon/)
    expect(heatmap.hasWork).toBe(false)
  })

  it('carries the day sums and the staffing service state through unchanged', () => {
    const days = [
      day('2030-09-02', {
        requiredHours: 12,
        assignedHours: 6,
        unfilledHours: 6,
        requirements: 2,
        fillState: 'partially-filled',
      }),
      day('2030-09-03', {
        requiredHours: 4,
        assignedHours: 0,
        unfilledHours: 4,
        requirements: 1,
        fillState: 'unfilled',
      }),
      day('2030-09-04'),
    ]
    const heatmap = buildHeatmap(summary({ staffing: staffingWith({ days }) }))

    expect(heatmap.weeks[0][0]).toMatchObject({
      requiredHours: 12,
      assignedHours: 6,
      unfilledHours: 6,
      requirements: 2,
      tone: 'partially-filled',
    })
    expect(heatmap.weeks[0][1].tone).toBe('unfilled')
    expect(heatmap.weeks[0][2].tone).toBe('empty')
    expect(heatmap.weeks[0][2].detail).toMatch(/No requirements start/)
    expect(heatmap.hasWork).toBe(true)
    expect(heatmap.unfilledDays).toBe(2)
  })
})

describe('commandCentreModel budget panel', () => {
  it('shows spend against budget as a fraction of the two figures', () => {
    const budget = buildBudgetPanel(
      summary({
        finance: financeWith({ budget: 1500, spend: 1100, committed: 300, remaining: 400 }),
      }),
    )

    expect(budget.sentence).toBe('R1100.00 of R1500.00 spent, R400.00 left.')
    expect(budget.percent).toBe('73%')
    expect(budget.full).toBe(false)
    expect(budget.overBudget).toBe(false)
    expect(budget.remainingLabel).toBe('R400.00')
    expect(budget.unpricedNote).toBeNull()
  })

  it('says how far over budget the period is, per course', () => {
    const budget = buildBudgetPanel(
      summary({
        finance: financeWith({
          budget: 1500,
          spend: 1900,
          committed: 0,
          remaining: -400,
          overBudgetCourses: 1,
          courses: [course({ hourlyRate: 30, budget: 1500, spend: 1900, budgetRemaining: -400 })],
        }),
      }),
    )

    expect(budget.sentence).toBe('R1900.00 spent against a R1500.00 budget, R400.00 over.')
    expect(budget.full).toBe(true)
    expect(budget.overBudget).toBe(true)
    expect(budget.remainingLabel).toBe('R400.00')
    expect(budget.overBudgetCourses).toEqual([
      {
        key: 3,
        id: 3,
        code: 'COMS3011',
        name: 'Software Design Project',
        spentLabel: 'R1900.00',
        budgetLabel: 'R1500.00',
        overLabel: 'R400.00',
        path: '/organiser/courses/3',
        linkLabel: 'Open COMS3011',
      },
    ])
  })

  it('draws no bar and claims nothing when there is no rate', () => {
    const budget = buildBudgetPanel(summary())

    expect(budget.fraction).toBeNull()
    expect(budget.percent).toBeNull()
    expect(budget.remainingLabel).toBeNull()
    expect(budget.sentence).toBe(
      'No hourly rate is set for a course with work in this period, so spend cannot be worked out.',
    )
  })

  it('counts the courses whose spend is missing rather than treating them as zero', () => {
    const budget = buildBudgetPanel(
      summary({ finance: financeWith({ spend: 300, budget: 1000, unpricedCourses: 2 }) }),
    )

    expect(budget.unpricedNote).toBe(
      'No hourly rate is set for 2 courses in this period, so their spend is not counted.',
    )
  })
})

describe('commandCentreModel workload panel', () => {
  it('only lists tutors who have work, and measures them against capacity', () => {
    const workload = buildWorkloadPanel(
      summary({
        workload: {
          tutors: [
            tutor({ allocatedHours: 50, approvedWorkedHours: 4, shareOfAllocatedHours: 1 }),
            tutor({ tutorId: 8, fullName: 'Ben Tutor', capacityHours: null, allocatedHours: 2 }),
            tutor({ tutorId: 9, fullName: 'Cal Tutor' }),
          ],
        },
      }),
    )

    expect(workload.rows).toHaveLength(2)
    expect(workload.rows[0]).toMatchObject({
      name: 'Ada Tutor',
      allocatedLabel: '50 h',
      approvedLabel: '4 h',
      shareLabel: '100%',
      capacityLabel: '40 h',
      fraction: 1,
      over: true,
    })
    expect(workload.rows[1].fraction).toBeNull()
    expect(workload.rows[1].capacityLabel).toBeNull()
    expect(workload.idleTutors).toBe(1)
    expect(workload.idleNote).toBe('1 tutor has no allocated or approved hours in this period.')
  })

  it('says nothing about idle tutors when everyone has work', () => {
    const workload = buildWorkloadPanel(
      summary({
        workload: { tutors: [tutor({ allocatedHours: 4, shareOfAllocatedHours: 1 })] },
      }),
    )

    expect(workload.idleTutors).toBe(0)
    expect(workload.idleNote).toBeNull()
  })
})

describe('commandCentreModel empty period', () => {
  it('is true only when no panel has anything in it', () => {
    expect(isEmptyPeriod(summary())).toBe(true)

    expect(
      isEmptyPeriod(summary({ staffing: staffingWith({ requirements: [requirement()] }) })),
    ).toBe(false)
    expect(isEmptyPeriod(summary({ finance: financeWith({ courses: [course()] }) }))).toBe(false)
    expect(isEmptyPeriod(summary({ workload: { tutors: [tutor()] } }))).toBe(false)
    expect(isEmptyPeriod(summary({ overflow: { openItems: 1, openHours: 2, unclaimedItems: 0 } }))).toBe(
      false,
    )
    expect(
      isEmptyPeriod(summary({ actions: { ...summary().actions, openDisputes: 1, total: 1 } })),
    ).toBe(false)
  })
})

describe('commandCentreModel staffing state', () => {
  it('calls a day with nothing left to fill fully staffed', () => {
    expect(
      staffingStatusFor({
        requirements: 1,
        fillState: 'fully-filled',
        assignedHours: 8,
        shortageHours: 0,
      }),
    ).toBe(STAFFING_STATUS.FULLY_STAFFED)
  })

  it('calls a day with some hours allocated partly staffed', () => {
    expect(
      staffingStatusFor({
        requirements: 2,
        fillState: 'partially-filled',
        assignedHours: 6,
        shortageHours: 6,
      }),
    ).toBe(STAFFING_STATUS.PARTIALLY_STAFFED)
  })

  it('calls a day with nothing allocated at all unstaffed', () => {
    expect(
      staffingStatusFor({
        requirements: 1,
        fillState: 'unfilled',
        assignedHours: 0,
        shortageHours: 4,
      }),
    ).toBe(STAFFING_STATUS.UNSTAFFED)
  })

  it('keeps the state the server sent for work that is not being filled', () => {
    expect(
      staffingStatusFor({ requirements: 1, fillState: 'not-being-filled', shortageHours: 4 }),
    ).toBe(STAFFING_STATUS.NOT_BEING_FILLED)
  })

  it('applies the staffing service rule when the server sent figures and no state', () => {
    // The rule the staffing service applies: nothing left over is fully staffed,
    // some allocated is partly staffed, none allocated is unstaffed, and work
    // that is not open is not being filled.
    expect(staffingStatusFor({ requirements: 2, assignedHours: 6, shortageHours: 0 })).toBe(
      STAFFING_STATUS.FULLY_STAFFED,
    )
    expect(staffingStatusFor({ requirements: 2, assignedHours: 6, shortageHours: 6 })).toBe(
      STAFFING_STATUS.PARTIALLY_STAFFED,
    )
    expect(staffingStatusFor({ requirements: 2, assignedHours: 0, shortageHours: 8 })).toBe(
      STAFFING_STATUS.UNSTAFFED,
    )
    expect(staffingStatusFor({ requirements: 1, assignedHours: 4, shortageHours: 4, status: 'CANCELLED' })).toBe(
      STAFFING_STATUS.NOT_BEING_FILLED,
    )
  })

  it('has no state to give a day nothing starts on, whatever the day computed', () => {
    expect(staffingStatusFor()).toBe(STAFFING_STATUS.NO_WORK)
    expect(staffingStatusFor({ requirements: 0, assignedHours: 4, shortageHours: 0 })).toBe(
      STAFFING_STATUS.NO_WORK,
    )
  })

  it('writes every state out and gives it a colour name the staffing board uses', () => {
    for (const status of Object.values(STAFFING_STATUS)) {
      expect(staffingStatusLabel(status)).toBeTruthy()
      expect(STAFFING_STATUS_TONES[status]).toBeTruthy()
    }
    expect(staffingStatusLabel('not-a-state')).toBe('State not known')
  })

  it('carries the state into the day the heatmap draws, in words as well as colour', () => {
    const days = [
      day('2030-09-02', {
        requiredHours: 12,
        assignedHours: 12,
        unfilledHours: 0,
        requirements: 2,
        fillState: 'fully-filled',
      }),
      day('2030-09-03', {
        requiredHours: 12,
        assignedHours: 6,
        unfilledHours: 6,
        requirements: 2,
        fillState: 'partially-filled',
      }),
      day('2030-09-04', {
        requiredHours: 4,
        assignedHours: 0,
        unfilledHours: 4,
        requirements: 1,
        fillState: 'unfilled',
      }),
      day('2030-09-05'),
    ]
    const { weeks } = buildHeatmap(summary({ staffing: staffingWith({ days }) }))

    expect(weeks[0][0]).toMatchObject({
      status: STAFFING_STATUS.FULLY_STAFFED,
      statusLabel: 'Fully staffed',
      tone: 'fully-filled',
    })
    expect(weeks[0][1]).toMatchObject({ statusLabel: 'Partly staffed', tone: 'partially-filled' })
    expect(weeks[0][2]).toMatchObject({ statusLabel: 'Unstaffed', tone: 'unfilled' })
    expect(weeks[0][3]).toMatchObject({
      status: STAFFING_STATUS.NO_WORK,
      statusLabel: 'Nothing starts',
      tone: 'empty',
    })
    // The figures stay the sums the server sent.
    expect(weeks[0][1]).toMatchObject({
      requiredHours: 12,
      assignedHours: 6,
      unfilledHours: 6,
      requirements: 2,
    })
    expect(weeks[0][1].detail).toContain('Partly staffed')
    expect(weeks[0][1].detail).toContain('12 h required, 6 h allocated, 6 h unfilled')
  })

  it('names every state in the legend in the same words as the squares', () => {
    const days = [
      day('2030-09-02', {
        requiredHours: 4,
        unfilledHours: 4,
        requirements: 1,
        fillState: 'unfilled',
      }),
    ]
    const { weeks, legend } = buildHeatmap(summary({ staffing: staffingWith({ days }) }))

    expect(legend.map((entry) => entry.label)).toEqual([
      'Unstaffed',
      'Partly staffed',
      'Fully staffed',
      'Not being filled',
      'Nothing starts',
    ])
    expect(legend.map((entry) => entry.tone)).toEqual([
      'unfilled',
      'partially-filled',
      'fully-filled',
      'not-being-filled',
      'empty',
    ])
    expect(weeks[0][0].tone).toBe(legend[0].tone)
  })
})

describe('commandCentreModel heatmap drill-downs and written list', () => {
  function dayWithWork() {
    return day('2030-09-02', {
      requiredHours: 12,
      assignedHours: 6,
      unfilledHours: 6,
      requirements: 2,
      fillState: 'partially-filled',
    })
  }

  it('links the courses that start on a day to the course screen', () => {
    const requirements = [
      requirement({ id: 12, courseId: 3, courseCode: 'COMS3011', startsAt: '2030-09-02T14:00:00.000Z' }),
      requirement({ id: 13, courseId: 5, courseCode: 'MATH101', startsAt: '2030-09-02T09:00:00.000Z' }),
      requirement({ id: 14, courseId: 3, courseCode: 'COMS3011', startsAt: '2030-09-03T09:00:00.000Z' }),
    ]
    const { weeks } = buildHeatmap(
      summary({
        staffing: staffingWith({
          days: [dayWithWork(), day('2030-09-03', { requiredHours: 4, unfilledHours: 4, requirements: 1, fillState: 'unfilled' })],
          requirements,
        }),
      }),
    )

    expect(weeks[0][0].courses.map((course) => course.code)).toEqual(['COMS3011', 'MATH101'])
    expect(weeks[0][0].courses[0]).toEqual({
      key: 12,
      code: 'COMS3011',
      name: 'Software Design Project',
      path: '/organiser/courses/3',
      linkLabel: 'Open COMS3011',
    })
    expect(weeks[0][0].detail).toContain('Courses: COMS3011, MATH101.')
    // A later day keeps its own course, not the one before it.
    expect(weeks[0][1].courses.map((course) => course.code)).toEqual(['COMS3011'])
    expect(weeks[0][1].detail).toContain('Courses: COMS3011.')
  })

  it('gives a day nothing starts on no courses at all', () => {
    const { weeks } = buildHeatmap(
      summary({ staffing: staffingWith({ days: [day('2030-09-02')], requirements: [requirement()] }) }),
    )

    expect(weeks[0][0].courses).toEqual([])
  })

  it('lists the days with work as written rows carrying the same figures and links', () => {
    const heatmap = buildHeatmap(
      summary({
        staffing: staffingWith({
          days: [dayWithWork(), day('2030-09-03')],
          requirements: [requirement({ id: 12, courseId: 3, startsAt: '2030-09-02T14:00:00.000Z' })],
        }),
      }),
    )

    expect(heatmap.rows).toHaveLength(1)
    expect(heatmap.rows[0]).toMatchObject({
      key: '2030-09-02',
      statusLabel: 'Partly staffed',
      tone: 'partially-filled',
      requiredLabel: '12 h',
      assignedLabel: '6 h',
      unfilledLabel: '6 h',
    })
    expect(heatmap.rows[0].courses[0].path).toBe('/organiser/courses/3')
    expect(heatmap.rowsNote).toBe('1 day of the period has work on it, with the same figures as the squares.')
  })

  it('says nothing about a written list when the period holds no work', () => {
    const heatmap = buildHeatmap(summary())

    expect(heatmap.rows).toEqual([])
    expect(heatmap.rowsNote).toBeNull()
  })

  it('points course and tutor drill-downs at the screens that already exist', () => {
    expect(courseDetailPath(3)).toBe('/organiser/courses/3')
    expect(tutorDetailPath(7)).toBe('/organiser/tutors/7')
    expect(courseDetailPath(null)).toBe('/organiser/courses')
    expect(tutorDetailPath(undefined)).toBe('/organiser/tutors')
  })
})

describe('commandCentreModel budget status', () => {
  it('divides nothing when there is no spend or no budget to divide by', () => {
    const noRate = buildBudgetPanel(summary())
    expect(noRate.status).toBe(BUDGET_STATUS.UNKNOWN)
    expect(noRate.statusLabel).toBe('Spend cannot be worked out')
    expect(noRate.usedPercent).toBeNull()
    expect(noRate.fraction).toBeNull()

    const zeroBudget = buildBudgetPanel(
      summary({ finance: financeWith({ budget: 0, spend: 0, committed: 0, remaining: 0 }) }),
    )
    expect(zeroBudget.status).toBe(BUDGET_STATUS.NO_BUDGET)
    expect(zeroBudget.statusLabel).toBe('No budget set')
    expect(zeroBudget.usedPercent).toBeNull()
    expect(zeroBudget.fraction).toBeNull()
    expect(zeroBudget.full).toBe(false)
  })

  it('says a budget spent to the cent is fully used rather than over or under', () => {
    const budget = buildBudgetPanel(
      summary({ finance: financeWith({ budget: 1500, spend: 1500, committed: 0, remaining: 0 }) }),
    )

    expect(budget.status).toBe(BUDGET_STATUS.FULLY_USED)
    expect(budget.statusLabel).toBe('Budget fully used')
    expect(budget.usedPercent).toBe('100%')
    expect(budget.fraction).toBe(1)
    expect(budget.full).toBe(true)
    expect(budget.overBudget).toBe(false)
  })

  it('writes how far past its budget a period is rather than a bar at its fullest', () => {
    const budget = buildBudgetPanel(
      summary({ finance: financeWith({ budget: 1000, spend: 1270, committed: 0, remaining: -270 }) }),
    )

    expect(budget.status).toBe(BUDGET_STATUS.OVER)
    expect(budget.statusLabel).toBe('Over budget')
    expect(budget.usedPercent).toBe('127%')
    expect(budget.fraction).toBe(1)
    expect(budget.percent).toBe('100%')
    expect(budget.full).toBe(true)
    expect(budget.remainingLabel).toBe('R270.00')
  })

  it('reads no spend at all as inside the budget rather than as nothing to say', () => {
    const budget = buildBudgetPanel(
      summary({ finance: financeWith({ budget: 1000, spend: 0, committed: 0, remaining: 1000 }) }),
    )

    expect(budget.status).toBe(BUDGET_STATUS.WITHIN)
    expect(budget.usedPercent).toBe('0%')
    expect(budget.fraction).toBe(0)
    expect(budget.full).toBe(false)
  })

  it('turns the server totals into a percentage without inventing one', () => {
    const budget = buildBudgetPanel(
      summary({ finance: financeWith({ budget: 2000, spend: 500, committed: 100, remaining: 1500 }) }),
    )

    expect(budget.spendLabel).toBe('R500.00')
    expect(budget.budgetLabel).toBe('R2000.00')
    expect(budget.remainingLabel).toBe('R1500.00')
    expect(budget.usedPercent).toBe('25%')
    expect(budget.statusTone).toBe('success')
  })

  it('claims no percentage when a budgeted course has no rate to price it with', () => {
    const budget = buildBudgetPanel(
      summary({ finance: financeWith({ budget: 1000, spend: 300, committed: 0, remaining: null }) }),
    )

    expect(budget.status).toBe(BUDGET_STATUS.UNKNOWN)
    expect(budget.usedPercent).toBeNull()
    expect(budget.fraction).toBeNull()
  })

  it('never writes NaN or Infinity into a figure, whatever the totals are', () => {
    const totals = [
      {},
      { budget: 0, spend: 0, committed: 0, remaining: 0 },
      { budget: 0, spend: 500, committed: 0, remaining: -500 },
      { budget: 1000, spend: 0, committed: 0, remaining: 1000 },
      { budget: 1000, spend: 1000, committed: 0, remaining: 0 },
      { budget: 1000, spend: 1500, committed: 0, remaining: -500 },
      { budget: 1000, spend: 300, committed: 0, remaining: null },
    ]

    for (const finance of totals) {
      const budget = buildBudgetPanel(summary({ finance: financeWith(finance) }))
      for (const label of [
        budget.percent,
        budget.usedPercent,
        budget.spendLabel,
        budget.budgetLabel,
        budget.committedLabel,
        budget.remainingLabel,
        budget.statusLabel,
        budget.sentence,
      ]) {
        expect(String(label)).not.toMatch(/NaN|Infinity/)
      }
    }
  })
})

describe('commandCentreModel workload capacity and fairness', () => {
  function tutorWith(overrides) {
    return summary({ workload: { tutors: [tutor(overrides)] } })
  }

  it('says what is left of a tutor capacity, from the two figures the server sent', () => {
    const workload = buildWorkloadPanel(
      summary({
        workload: {
          tutors: [
            tutor({ allocatedHours: 6, approvedWorkedHours: 4, shareOfAllocatedHours: 1 }),
            tutor({ tutorId: 8, fullName: 'Ben Tutor', capacityHours: null, allocatedHours: 2 }),
            tutor({ tutorId: 9, fullName: 'Cal Tutor', capacityHours: 40, allocatedHours: 40 }),
            tutor({ tutorId: 10, fullName: 'Dee Tutor', capacityHours: 10, allocatedHours: 12 }),
          ],
        },
      }),
    )

    expect(workload.rows[0].remainingLabel).toBe('34 h')
    expect(workload.rows[0].capacityNote).toBe('34 h of 40 h capacity left.')
    expect(workload.rows[1].remainingLabel).toBeNull()
    expect(workload.rows[1].capacityNote).toBe(
      'No capacity is set for the period, so what is left cannot be worked out.',
    )
    expect(workload.rows[2].remainingLabel).toBe('0 h')
    expect(workload.rows[2].capacityNote).toBe('All 40 h of capacity for the period is allocated.')
    expect(workload.rows[3].remainingLabel).toBe('0 h')
    expect(workload.rows[3].capacityNote).toBe('2 h over the 10 h capacity for the period.')
  })

  it('links each tutor to the tutor screen that already exists', () => {
    const workload = buildWorkloadPanel(tutorWith({ allocatedHours: 4, shareOfAllocatedHours: 1 }))

    expect(workload.rows[0].path).toBe('/organiser/tutors/7')
    expect(workload.rows[0].linkLabel).toBe('Open Ada Tutor')
  })

  it('says how many tutors carry the period without scoring anyone', () => {
    const workload = buildWorkloadPanel(
      summary({
        workload: {
          tutors: [
            tutor({ allocatedHours: 4, shareOfAllocatedHours: 1 }),
            tutor({ tutorId: 8, fullName: 'Ben Tutor', allocatedHours: 2, shareOfAllocatedHours: 0 }),
          ],
        },
      }),
    )

    expect(workload.spreadNote).toBe('2 tutors carrying allocated or approved hours in this period.')
    // The share is the report's figure, and no score, grade or verdict is added
    // to it here or anywhere else in the row.
    expect(workload.rows[0].shareLabel).toBe('100%')
    expect(Object.keys(workload.rows[0]).filter((key) => /score|grade|fair|verdict/i.test(key))).toEqual(
      [],
    )
  })

  it('calls the share an indication rather than a fair-share rule', () => {
    const workload = buildWorkloadPanel(tutorWith({ allocatedHours: 4, shareOfAllocatedHours: 1 }))

    expect(workload.softNote).toMatch(/indicative only/)
    expect(workload.softNote).toMatch(/not a target or a fair-share rule/)
    expect(workload.softNote).toMatch(/report's own figure/)
  })

  it('has nothing to list and nothing to claim when no tutor has hours', () => {
    const workload = buildWorkloadPanel(summary({ workload: { tutors: [tutor()] } }))

    expect(workload.rows).toEqual([])
    expect(workload.emptyNote).toBe('No tutor has allocated or approved hours in this period.')
    expect(workload.spreadNote).toBeNull()
    expect(workload.idleNote).toBe('1 tutor has no allocated or approved hours in this period.')
  })
})
