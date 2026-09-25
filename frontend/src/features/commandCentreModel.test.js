import { describe, expect, it } from 'vitest'
import {
  DRILL_DOWN_LABELS,
  DRILL_DOWN_PATHS,
  buildAttentionFeed,
  buildBudgetPanel,
  buildHeatmap,
  buildKpis,
  buildWorkloadPanel,
  isEmptyPeriod,
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
        code: 'COMS3011',
        name: 'Software Design Project',
        spentLabel: 'R1900.00',
        budgetLabel: 'R1500.00',
        overLabel: 'R400.00',
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

describe('commandCentreModel needs-attention feed', () => {
  it('is empty when nothing is short, unclaimed, waiting or overspent', () => {
    const feed = buildAttentionFeed(summary())

    expect(feed.items).toEqual([])
    expect(feed.total).toBe(0)
  })

  it('lists shortages worst first and calls an unfilled one critical', () => {
    const feed = buildAttentionFeed(
      summary({
        staffing: staffingWith({
          requirements: [
            requirement({ id: 1, shortageHours: 2, shortageTutors: 1, fillState: 'partially-filled' }),
            requirement({ id: 2, shortageHours: 8 }),
          ],
        }),
      }),
    )

    expect(feed.items.map((item) => item.key)).toEqual(['staffing-2', 'staffing-1'])
    expect(feed.items[0]).toMatchObject({
      kind: 'staffing-shortage',
      severity: 'critical',
      title: 'COMS3011: 8 h still unfilled',
    })
    expect(feed.items[1].severity).toBe('warning')
    expect(feed.items[1].detail).toMatch(/1 more tutor needed/)
  })

  it('leaves requirements that are covered out of the feed', () => {
    const feed = buildAttentionFeed(
      summary({
        staffing: staffingWith({
          requirements: [
            requirement({ id: 3, assignedHours: 8, shortageHours: 0, shortageTutors: 0, fillState: 'fully-filled' }),
          ],
        }),
      }),
    )

    expect(feed.items).toEqual([])
  })

  it('reads the queues, the unclaimed overflow work and the budgets', () => {
    const feed = buildAttentionFeed(
      summary({
        actions: {
          pendingTimesheets: 3,
          pendingVolunteerClaims: 1,
          pendingExcuses: 2,
          openDisputes: 1,
          total: 7,
        },
        overflow: { openItems: 4, openHours: 12, unclaimedItems: 2 },
        finance: financeWith({ budget: 100, spend: 250, remaining: -150, overBudgetCourses: 1 }),
      }),
    )

    expect(feed.total).toBe(6)
    expect(feed.items.map((item) => item.kind)).toEqual([
      'over-budget',
      'overflow-unclaimed',
      'timesheet-approvals',
      'volunteer-claims',
      'timesheet-disputes',
      'excuse-approvals',
    ])
    expect(feed.items.every((item) => ORGANISER_ROUTES.includes(item.path))).toBe(true)
    expect(feed.items.every((item) => item.linkLabel === DRILL_DOWN_LABELS[item.kind])).toBe(true)
  })

  it('shows the most pressing few and says how many behind them', () => {
    const feed = buildAttentionFeed(
      summary({
        staffing: staffingWith({
          requirements: Array.from({ length: 9 }, (_, index) =>
            requirement({ id: index + 1, shortageHours: 10 - index }),
          ),
        }),
      }),
    )

    expect(feed.items).toHaveLength(8)
    expect(feed.total).toBe(9)
    expect(feed.items[0].title).toBe('COMS3011: 10 h still unfilled')
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
