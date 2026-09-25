import { describe, expect, it } from 'vitest'
import {
  ALL_FILTER,
  ATTENTION_CATEGORIES,
  ATTENTION_CATEGORY_LABELS,
  ATTENTION_PRIORITY_LABELS,
  attentionFilterOptions,
  buildAttentionFeed,
  filterAttentionItems,
  isOrganiserAttentionRoute,
  resolveAttentionTarget,
} from './attentionFeed'

/** Every screen an attention card may point at: the organiser routes that exist. */
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

function staffingWith(overrides) {
  return { ...summary().staffing, ...overrides }
}

function financeWith(overrides) {
  return { ...summary().finance, ...overrides }
}

/** One row of Member 1's notification store, as its list endpoint sends it. */
function reminder(overrides = {}) {
  return {
    id: 1,
    recipientId: 8,
    type: 'TIMESHEET_REVIEW_DUE',
    title: 'A timesheet has waited two days for review',
    body: 'A submitted timesheet has waited for your review.',
    linkPath: '/organiser/approvals',
    targetType: 'timesheet',
    targetId: 501,
    readAt: null,
    createdAt: '2030-09-04T08:00:00.000Z',
    ...overrides,
  }
}

/** A period with something in every category the feed can show. */
function mixedSummary() {
  return summary({
    staffing: staffingWith({
      requirements: [
        requirement({ id: 2, shortageHours: 8 }),
        requirement({
          id: 1,
          shortageHours: 2,
          shortageTutors: 1,
          fillState: 'partially-filled',
        }),
      ],
    }),
    overflow: { openItems: 4, openHours: 12, unclaimedItems: 2 },
    actions: {
      pendingTimesheets: 2,
      pendingVolunteerClaims: 1,
      pendingExcuses: 1,
      openDisputes: 1,
      total: 5,
    },
    workload: {
      tutors: [
        tutor({ allocatedHours: 40, shareOfAllocatedHours: 1 }),
        tutor({ tutorId: 9, fullName: 'Cal Tutor', allocatedHours: 6, shareOfAllocatedHours: 0 }),
      ],
    },
    finance: financeWith({
      budget: 1500,
      spend: 1500,
      committed: 0,
      remaining: 0,
      courses: [
        course({ courseId: 3, hourlyRate: 30, budget: 500, spend: 900, budgetRemaining: -400 }),
        course({
          courseId: 5,
          courseCode: 'MATH101',
          courseName: 'Calculus I',
          hourlyRate: 30,
          budget: 1000,
          spend: 600,
          committed: 300,
          budgetRemaining: 400,
        }),
      ],
    }),
  })
}

function itemOf(feed, id) {
  return feed.items.find((item) => item.id === id)
}

/** The ids the current read knows, as the screen passes them to the mapper. */
function knownIdsFor(summaryFixture) {
  return {
    knownCourseIds: new Set(summaryFixture.finance.courses.map((row) => row.courseId)),
    knownTutorIds: new Set(summaryFixture.workload.tutors.map((row) => row.tutorId)),
  }
}

describe('attentionFeed builder', () => {
  it('gives the same data the same items, ids, categories and priorities', () => {
    const first = buildAttentionFeed(mixedSummary(), [reminder()])
    const second = buildAttentionFeed(mixedSummary(), [reminder()])

    expect(second.items).toEqual(first.items)
    expect(second.total).toBe(first.total)
  })

  it('names every item by the issue it is about, never by its place in a list', () => {
    const { items } = buildAttentionFeed(mixedSummary())
    for (const item of items) {
      // The documented shape - category, entity, id - with no array index and
      // no random value in it.
      expect(item.id.split(':')).toHaveLength(3)
    }

    // Reading the same requirements in the opposite order changes nothing,
    // because an id is the requirement's own, not its position.
    const partial = requirement({
      id: 1,
      shortageHours: 2,
      shortageTutors: 1,
      fillState: 'partially-filled',
    })
    const forwards = buildAttentionFeed(
      summary({ staffing: staffingWith({ requirements: [partial, requirement({ id: 2 })] }) }),
    )
    const backwards = buildAttentionFeed(
      summary({ staffing: staffingWith({ requirements: [requirement({ id: 2 }), partial] }) }),
    )

    expect(forwards.items.map((item) => item.id)).toEqual([
      'shortage:requirement:2',
      'shortage:requirement:1',
    ])
    expect(backwards.items.map((item) => item.id)).toEqual(forwards.items.map((item) => item.id))
  })

  it('reads a period with every kind of issue as one feed, each item whole', () => {
    const feed = buildAttentionFeed(mixedSummary(), [
      reminder({ id: 1, targetId: 501 }),
      reminder({ id: 2, type: 'VOLUNTEER_CLAIM_DUE', targetId: 601 }),
      reminder({ id: 3, type: 'EXCUSE_REVIEW_DUE', targetId: 701 }),
    ])

    expect(feed.items.map((item) => item.id)).toEqual([
      'shortage:requirement:2',
      'budget:course:3',
      'shortage:requirement:1',
      'shortage:overflow:unclaimed',
      'timesheets:queue:submitted',
      'approvals:queue:volunteer-claims',
      'timesheets:queue:disputes',
      'tutor-capacity:tutor:7',
      'budget:period:fully-used',
      'approvals:queue:excuses',
    ])
    expect(feed.total).toBe(10)

    // Every item travels whole: its category and urgency in words that exist,
    // the reason it needs attention, and the entity it is about.
    for (const item of feed.items) {
      expect(ATTENTION_CATEGORY_LABELS[item.category]).toBeTruthy()
      expect(ATTENTION_PRIORITY_LABELS[item.priority]).toBeTruthy()
      expect(item.title).toBeTruthy()
      expect(item.detail).toBeTruthy()
      expect(item.entity.type).toBeTruthy()
    }
    expect(attentionFilterOptions(feed.items).map((option) => [option.value, option.count])).toEqual(
      [
        ['all', 10],
        ['shortage', 3],
        ['approvals', 2],
        ['timesheets', 2],
        ['tutor-capacity', 1],
        ['budget', 2],
      ],
    )
  })

  it('puts the most urgent first and keeps each item at one urgency', () => {
    const { items } = buildAttentionFeed(mixedSummary())
    const rank = { critical: 0, warning: 1, info: 2 }
    const urgencies = items.map((item) => rank[item.priority])

    expect([...urgencies].sort((first, second) => first - second)).toEqual(urgencies)
    expect(items[0].priority).toBe('critical')
    expect(items[items.length - 1].priority).toBe('info')
  })
})

describe('attentionFeed shortages', () => {
  it('lists each short requirement once, worst first, an unfilled one urgent', () => {
    const feed = buildAttentionFeed(
      summary({
        staffing: staffingWith({
          requirements: [
            requirement({
              id: 1,
              shortageHours: 2,
              shortageTutors: 1,
              fillState: 'partially-filled',
            }),
            requirement({ id: 2, shortageHours: 8 }),
          ],
        }),
      }),
    )

    expect(feed.items.map((item) => item.id)).toEqual([
      'shortage:requirement:2',
      'shortage:requirement:1',
    ])
    expect(feed.items[0]).toMatchObject({
      kind: 'staffing-shortage',
      category: ATTENTION_CATEGORIES.SHORTAGE,
      priority: 'critical',
      title: 'COMS3011: 8 h still unfilled',
      entity: { type: 'requirement', id: 2, label: 'COMS3011' },
    })
    expect(feed.items[0].detail).toContain('Software Design Project on ')
    expect(feed.items[0].detail).toContain('2 more tutors needed.')
    expect(feed.items[1].priority).toBe('warning')
    expect(feed.items[1].detail).toContain('1 more tutor needed.')
  })

  it('leaves requirements that are covered out of the feed', () => {
    const feed = buildAttentionFeed(
      summary({
        staffing: staffingWith({
          requirements: [
            requirement({
              id: 3,
              assignedHours: 8,
              shortageHours: 0,
              shortageTutors: 0,
              fillState: 'fully-filled',
            }),
          ],
        }),
      }),
    )

    expect(feed.items).toEqual([])
  })

  it('counts the posted work nobody has claimed as one shortage item', () => {
    const feed = buildAttentionFeed(
      summary({ overflow: { openItems: 4, openHours: 12, unclaimedItems: 2 } }),
    )

    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toMatchObject({
      id: 'shortage:overflow:unclaimed',
      kind: 'overflow-unclaimed',
      category: ATTENTION_CATEGORIES.SHORTAGE,
      priority: 'warning',
      title: '2 overflow items with no student claims',
      detail: '12 h of posted work is still waiting for a volunteer.',
      entity: { type: 'overflow-queue', id: null, label: 'Overflow work' },
    })
  })

  it('adds no overflow item when every posting has a claim', () => {
    const feed = buildAttentionFeed(
      summary({ overflow: { openItems: 3, openHours: 6, unclaimedItems: 0 } }),
    )

    expect(feed.items).toEqual([])
  })
})

describe('attentionFeed queues and waiting time', () => {
  function queuesSummary(actionsOverrides) {
    return summary({
      actions: {
        pendingTimesheets: 3,
        pendingVolunteerClaims: 1,
        pendingExcuses: 2,
        openDisputes: 1,
        total: 7,
        ...actionsOverrides,
      },
    })
  }

  it('reads each waiting queue as one card that says why it matters', () => {
    const feed = buildAttentionFeed(queuesSummary())

    expect(feed.items.map((item) => item.id)).toEqual([
      'timesheets:queue:submitted',
      'approvals:queue:volunteer-claims',
      'timesheets:queue:disputes',
      'approvals:queue:excuses',
    ])
    expect(feed.items[0]).toMatchObject({
      kind: 'timesheet-approvals',
      category: ATTENTION_CATEGORIES.TIMESHEETS,
      priority: 'warning',
      title: '3 timesheets waiting for approval',
      detail: 'Submitted hours cannot be paid until they are signed off.',
    })
    expect(feed.items[1]).toMatchObject({
      kind: 'volunteer-claims',
      category: ATTENTION_CATEGORIES.APPROVALS,
      title: '1 volunteer claim waiting for a decision',
      detail: 'Students have asked to take on posted work.',
    })
    expect(feed.items[2]).toMatchObject({
      kind: 'timesheet-disputes',
      category: ATTENTION_CATEGORIES.TIMESHEETS,
      title: '1 timesheet dispute still open',
      detail: 'Disputed weeks are held back from payroll until they are answered.',
    })
    expect(feed.items[3]).toMatchObject({
      kind: 'excuse-approvals',
      category: ATTENTION_CATEGORIES.APPROVALS,
      priority: 'info',
      title: '2 excuses waiting for a decision',
      detail: 'Tutors have asked to be excused from allocated work.',
    })
  })

  it('folds the reminders Member 1 already raised into the queue cards', () => {
    const feed = buildAttentionFeed(
      queuesSummary({ pendingTimesheets: 2, pendingExcuses: 1, openDisputes: 0, total: 4 }),
      [
        reminder({ id: 1, targetId: 501 }),
        reminder({ id: 2, targetId: 502 }),
        reminder({ id: 3, type: 'VOLUNTEER_CLAIM_DUE', targetId: 601 }),
        reminder({ id: 4, type: 'EXCUSE_REVIEW_DUE', targetId: 701 }),
      ],
    )

    expect(itemOf(feed, 'timesheets:queue:submitted').detail).toBe(
      'Submitted hours cannot be paid until they are signed off. A review reminder has already been raised for 2 of them.',
    )
    expect(itemOf(feed, 'approvals:queue:volunteer-claims').detail).toBe(
      'Students have asked to take on posted work. A decision reminder has already been raised for 1 of them.',
    )
    expect(itemOf(feed, 'approvals:queue:excuses').detail).toBe(
      'Tutors have asked to be excused from allocated work. A decision reminder has already been raised for 1 of them.',
    )
  })

  it('counts a reminder raised daily for the same item as one underlying issue', () => {
    const feed = buildAttentionFeed(
      queuesSummary({
        pendingVolunteerClaims: 0,
        pendingExcuses: 0,
        openDisputes: 0,
        total: 3,
      }),
      [
        reminder({ id: 1, targetId: 501 }),
        reminder({ id: 2, targetId: 501 }),
        reminder({ id: 3, targetId: 501 }),
      ],
    )

    expect(feed.items).toHaveLength(1)
    expect(itemOf(feed, 'timesheets:queue:submitted').detail).toContain(
      'A review reminder has already been raised for 1 of them.',
    )
  })

  it('never claims more overdue items than the queue still holds', () => {
    const feed = buildAttentionFeed(
      queuesSummary({
        pendingTimesheets: 1,
        pendingVolunteerClaims: 0,
        pendingExcuses: 0,
        openDisputes: 0,
        total: 1,
      }),
      [
        reminder({ id: 1, targetId: 501 }),
        reminder({ id: 2, targetId: 502 }),
        reminder({ id: 3, targetId: 503 }),
      ],
    )

    expect(itemOf(feed, 'timesheets:queue:submitted').detail).toBe(
      'Submitted hours cannot be paid until they are signed off. A review reminder has already been raised for 1 of them.',
    )
  })

  it('ignores reminder rows it cannot pin to an item, and tutor-facing ones', () => {
    const feed = buildAttentionFeed(
      queuesSummary({
        pendingVolunteerClaims: 0,
        pendingExcuses: 0,
        openDisputes: 0,
        total: 2,
      }),
      [
        null,
        42,
        reminder({ id: 1, targetId: null }),
        reminder({ id: 2, targetId: 0 }),
        reminder({ id: 3, targetId: '501' }),
        reminder({ id: 4, type: 'TIMESHEET_RESUBMIT_DUE', targetId: 501 }),
      ],
    )

    expect(itemOf(feed, 'timesheets:queue:submitted').detail).toBe(
      'Submitted hours cannot be paid until they are signed off.',
    )
  })
})

describe('attentionFeed tutor capacity', () => {
  it('surfaces only the tutors whose stated capacity is fully taken', () => {
    const feed = buildAttentionFeed(
      summary({
        workload: {
          tutors: [
            tutor({ allocatedHours: 40, shareOfAllocatedHours: 1 }),
            tutor({ tutorId: 8, fullName: 'Ben Tutor', capacityHours: 10, allocatedHours: 12 }),
            tutor({ tutorId: 9, fullName: 'Cal Tutor', allocatedHours: 6, shareOfAllocatedHours: 0 }),
            tutor({ tutorId: 10, fullName: 'Dee Tutor', capacityHours: null, allocatedHours: 5 }),
            tutor({ tutorId: 11, fullName: 'Eve Tutor', allocatedHours: 0 }),
          ],
        },
      }),
    )

    expect(feed.items.map((item) => item.id)).toEqual([
      'tutor-capacity:tutor:7',
      'tutor-capacity:tutor:8',
    ])
    expect(feed.items[0]).toMatchObject({
      kind: 'tutor-capacity',
      category: ATTENTION_CATEGORIES.TUTOR_CAPACITY,
      priority: 'warning',
      title: 'Ada Tutor has no capacity left for the period',
      detail: 'All 40 h of capacity is allocated.',
      entity: { type: 'tutor', id: 7, label: 'Ada Tutor' },
    })
    expect(feed.items[1]).toMatchObject({
      title: 'Ben Tutor is over the capacity stated for the period',
      detail: '12 h allocated against 10 h capacity, 2 h over.',
      entity: { type: 'tutor', id: 8, label: 'Ben Tutor' },
    })
  })

  it('invents no near-capacity threshold of its own', () => {
    // No rule anywhere in the application says how close is too close, so a
    // tutor merely approaching capacity stays on the workload panel, which
    // already says how full they are.
    const feed = buildAttentionFeed(
      summary({
        workload: { tutors: [tutor({ allocatedHours: 39, shareOfAllocatedHours: 1 })] },
      }),
    )

    expect(feed.items).toEqual([])
  })

  it('leaves tutors with no stated capacity to the workload panel rather than guessing', () => {
    const feed = buildAttentionFeed(
      summary({
        workload: {
          tutors: [
            tutor({ tutorId: 10, fullName: 'Dee Tutor', capacityHours: null, allocatedHours: 50 }),
          ],
        },
      }),
    )

    expect(feed.items).toEqual([])
  })
})

describe('attentionFeed budgets', () => {
  it('names each course the server figures put over budget', () => {
    const feed = buildAttentionFeed(
      summary({
        finance: financeWith({
          budget: 500,
          spend: 900,
          committed: 0,
          remaining: -400,
          overBudgetCourses: 1,
          courses: [
            course({ courseId: 3, hourlyRate: 30, budget: 500, spend: 900, budgetRemaining: -400 }),
          ],
        }),
      }),
    )

    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toMatchObject({
      id: 'budget:course:3',
      kind: 'budget-course',
      category: ATTENTION_CATEGORIES.BUDGET,
      priority: 'critical',
      title: 'COMS3011 is over budget',
      detail: 'R900.00 spent against R500.00 budget, R400.00 over.',
      entity: { type: 'course', id: 3, label: 'COMS3011' },
    })
  })

  it('claims nothing about courses whose remaining figure is missing or still positive', () => {
    const feed = buildAttentionFeed(
      summary({
        finance: financeWith({
          courses: [
            course({ courseId: 3, hourlyRate: 30, budget: 1500, spend: 1100, budgetRemaining: 400 }),
            course({
              courseId: 5,
              courseCode: 'MATH101',
              hourlyRate: 30,
              budget: 1000,
              spend: null,
              budgetRemaining: null,
            }),
          ],
        }),
      }),
    )

    expect(feed.items).toEqual([])
  })

  it('adds one period card when the budget is spent to the cent', () => {
    const feed = buildAttentionFeed(
      summary({
        finance: financeWith({ budget: 1500, spend: 1500, committed: 0, remaining: 0 }),
      }),
    )

    expect(feed.items).toHaveLength(1)
    expect(feed.items[0]).toMatchObject({
      id: 'budget:period:fully-used',
      kind: 'budget-fully-used',
      category: ATTENTION_CATEGORIES.BUDGET,
      priority: 'warning',
      title: `The period's budget is fully used`,
      detail: 'R1500.00 of R1500.00 spent, nothing left to spend.',
    })
  })

  it('says nothing about budget when the money cannot be worked out', () => {
    const feed = buildAttentionFeed(
      summary({
        finance: financeWith({ budget: 1500, spend: null, committed: null, remaining: null }),
      }),
    )

    expect(feed.items).toEqual([])
  })
})

describe('attentionFeed empty states', () => {
  it('is empty when nothing is short, unclaimed, waiting, full or overspent', () => {
    const feed = buildAttentionFeed(summary())

    expect(feed.items).toEqual([])
    expect(feed.total).toBe(0)
  })

  it('adds no item the data does not support, however close it looks', () => {
    const feed = buildAttentionFeed(
      summary({
        staffing: staffingWith({
          requirements: [
            requirement({
              id: 3,
              assignedHours: 8,
              shortageHours: 0,
              shortageTutors: 0,
              fillState: 'fully-filled',
            }),
          ],
        }),
        overflow: { openItems: 3, openHours: 6, unclaimedItems: 0 },
        workload: { tutors: [tutor({ allocatedHours: 39, shareOfAllocatedHours: 1 })] },
        finance: financeWith({
          budget: 1500,
          spend: 1100,
          committed: 300,
          remaining: 400,
          overBudgetCourses: 0,
          courses: [
            course({
              courseId: 3,
              hourlyRate: 30,
              budget: 1500,
              spend: 1100,
              budgetRemaining: 400,
            }),
          ],
        }),
      }),
    )

    expect(feed.items).toEqual([])
    expect(feed.total).toBe(0)
  })

  it('still offers every category when there is nothing to show', () => {
    expect(attentionFilterOptions([])).toEqual([
      { value: ALL_FILTER, label: 'All', count: 0 },
      { value: ATTENTION_CATEGORIES.SHORTAGE, label: 'Shortages', count: 0 },
      { value: ATTENTION_CATEGORIES.APPROVALS, label: 'Approvals', count: 0 },
      { value: ATTENTION_CATEGORIES.TIMESHEETS, label: 'Timesheets', count: 0 },
      { value: ATTENTION_CATEGORIES.TUTOR_CAPACITY, label: 'Tutor capacity', count: 0 },
      { value: ATTENTION_CATEGORIES.BUDGET, label: 'Budget', count: 0 },
    ])
  })
})

describe('attentionFeed duplicate sources', () => {
  it('keeps one issue one card however many places carry it', () => {
    const feed = buildAttentionFeed(
      summary({
        staffing: staffingWith({
          requirements: [requirement({ id: 12 }), requirement({ id: 12 })],
        }),
        actions: {
          pendingTimesheets: 3,
          pendingVolunteerClaims: 0,
          pendingExcuses: 0,
          openDisputes: 0,
          total: 3,
        },
      }),
      [
        reminder({ id: 1, targetId: 501 }),
        reminder({ id: 2, targetId: 501 }),
        reminder({ id: 3, targetId: 501 }),
      ],
    )

    // The duplicated requirement row and the reminder raised daily for the
    // same waiting timesheet are one shortage and one queue, not six cards.
    expect(feed.items.map((item) => item.id)).toEqual([
      'shortage:requirement:12',
      'timesheets:queue:submitted',
    ])
    expect(feed.total).toBe(2)
  })

  it('never lets a reminder become a card of its own', () => {
    const feed = buildAttentionFeed(summary(), [
      reminder({ id: 1, targetId: 501 }),
      reminder({ id: 2, type: 'VOLUNTEER_CLAIM_DUE', targetId: 601 }),
      reminder({ id: 3, type: 'EXCUSE_REVIEW_DUE', targetId: 701 }),
    ])

    // Reminders for queues that have since cleared stand for nothing: the
    // summary's counts are the authority on what still waits.
    expect(feed.items).toEqual([])
    expect(feed.total).toBe(0)
  })
})

describe('attentionFeed deep-link mapper', () => {
  it('links every kind of card to an organiser screen that already exists', () => {
    const feed = buildAttentionFeed(mixedSummary())

    for (const item of feed.items) {
      const target = resolveAttentionTarget(item, knownIdsFor(mixedSummary()))

      expect(target.ok).toBe(true)
      expect(target.path.startsWith('/organiser/')).toBe(true)
      expect(
        ORGANISER_ROUTES.includes(target.path) ||
          /^\/organiser\/(courses|tutors)\/\d+$/.test(target.path),
      ).toBe(true)
      expect(target.linkLabel).toBeTruthy()
    }
  })

  it('points each card at the screen that already handles that work', () => {
    const feed = buildAttentionFeed(mixedSummary())

    expect(resolveAttentionTarget(itemOf(feed, 'shortage:requirement:2'))).toEqual({
      ok: true,
      path: '/organiser/staffing',
      linkLabel: 'Open staffing requirements',
    })
    expect(resolveAttentionTarget(itemOf(feed, 'shortage:overflow:unclaimed'))).toEqual({
      ok: true,
      path: '/organiser/overflow',
      linkLabel: 'Open overflow work',
    })
    for (const id of [
      'timesheets:queue:submitted',
      'approvals:queue:volunteer-claims',
      'approvals:queue:excuses',
      'timesheets:queue:disputes',
    ]) {
      expect(resolveAttentionTarget(itemOf(feed, id))).toEqual({
        ok: true,
        path: '/organiser/approvals',
        linkLabel: 'Open approval queues',
      })
    }
    expect(
      resolveAttentionTarget(itemOf(feed, 'tutor-capacity:tutor:7'), {
        knownTutorIds: new Set([7, 9]),
      }),
    ).toEqual({ ok: true, path: '/organiser/tutors/7', linkLabel: 'Open Ada Tutor' })
    expect(
      resolveAttentionTarget(itemOf(feed, 'budget:course:3'), { knownCourseIds: new Set([3, 5]) }),
    ).toEqual({ ok: true, path: '/organiser/courses/3', linkLabel: 'Open COMS3011' })
    expect(resolveAttentionTarget(itemOf(feed, 'budget:period:fully-used'))).toEqual({
      ok: true,
      path: '/organiser/reports',
      linkLabel: 'Open reports',
    })
  })

  it('refuses an item that is not an item', () => {
    for (const malformed of [null, undefined, 'timesheet-approvals', 42, {}, { kind: 42 }]) {
      expect(resolveAttentionTarget(malformed)).toEqual({ ok: false, reason: 'malformed-item' })
    }
  })

  it('refuses a kind no rule knows, whatever the item points at', () => {
    expect(
      resolveAttentionTarget({
        id: 'shortage:class:1',
        kind: 'class-schedule',
        category: ATTENTION_CATEGORIES.SHORTAGE,
        priority: 'critical',
        title: 'A timetable clash',
        detail: 'Two sessions share a room.',
        entity: { type: 'class', id: 1, label: 'Class' },
      }),
    ).toEqual({ ok: false, reason: 'unknown-kind' })
  })

  it('refuses an entity card whose id is missing or unusable', () => {
    for (const id of [null, undefined, 0, -7, 2.5, '7', Number.NaN]) {
      expect(resolveAttentionTarget({ kind: 'tutor-capacity', entity: { id, label: 'X' } })).toEqual(
        { ok: false, reason: 'missing-id' },
      )
      expect(resolveAttentionTarget({ kind: 'budget-course', entity: { id, label: 'Y' } })).toEqual({
        ok: false,
        reason: 'missing-id',
      })
    }

    // No entity at all is no id either.
    expect(resolveAttentionTarget({ kind: 'tutor-capacity' })).toEqual({
      ok: false,
      reason: 'missing-id',
    })
  })

  it('refuses an entity the current data no longer lists', () => {
    const tutorCard = { kind: 'tutor-capacity', entity: { id: 7, label: 'Ada Tutor' } }
    const courseCard = { kind: 'budget-course', entity: { id: 3, label: 'COMS3011' } }

    expect(resolveAttentionTarget(tutorCard, { knownTutorIds: new Set([8]) })).toEqual({
      ok: false,
      reason: 'stale-target',
    })
    expect(resolveAttentionTarget(courseCard, { knownCourseIds: new Set([9]) })).toEqual({
      ok: false,
      reason: 'stale-target',
    })
    // An id the latest read does still know links as normal...
    expect(resolveAttentionTarget(tutorCard, { knownTutorIds: new Set([7, 8]) }).ok).toBe(true)
    // ...and with no ids to check against, the destination screen stays the judge.
    expect(resolveAttentionTarget(tutorCard).ok).toBe(true)
    // Course ids do not speak for tutors, nor tutors for courses.
    expect(resolveAttentionTarget(tutorCard, { knownCourseIds: new Set([9]) }).ok).toBe(true)
  })

  it('refuses a route the organiser screens do not serve', () => {
    // An id that is a positive integer but not one the router writes as a
    // plain route id still builds a path - and the mapper declines to vouch
    // for it.
    expect(
      resolveAttentionTarget({ kind: 'tutor-capacity', entity: { id: 1e21, label: 'Far Tutor' } }),
    ).toEqual({ ok: false, reason: 'forbidden-route' })
    expect(
      resolveAttentionTarget({ kind: 'budget-course', entity: { id: 1e21, label: 'Far Course' } }),
    ).toEqual({ ok: false, reason: 'forbidden-route' })
  })

  it('keeps every route it can offer inside the organiser screens', () => {
    for (const path of [...ORGANISER_ROUTES, '/organiser/courses/3', '/organiser/tutors/7']) {
      expect(isOrganiserAttentionRoute(path)).toBe(true)
    }

    // Routes another role owns, screens that do not exist, and malformed paths.
    for (const path of [
      '/tutor/approvals',
      '/tutor/schedule',
      '/admin/users',
      '/organiser/secret',
      '/organiser/courses/abc',
      '/organiser/courses/3/edit',
      '/organiser/tutors/7/extra',
      '',
      'organiser/approvals',
      'javascript:alert(1)',
    ]) {
      expect(isOrganiserAttentionRoute(path)).toBe(false)
    }
    expect(isOrganiserAttentionRoute(null)).toBe(false)
    expect(isOrganiserAttentionRoute(undefined)).toBe(false)
    expect(isOrganiserAttentionRoute(42)).toBe(false)
  })
})

describe('attentionFeed filters', () => {
  it('offers the All view plus every category, each with its count', () => {
    const feed = buildAttentionFeed(mixedSummary())

    expect(attentionFilterOptions(feed.items)).toEqual([
      { value: ALL_FILTER, label: 'All', count: 10 },
      { value: ATTENTION_CATEGORIES.SHORTAGE, label: 'Shortages', count: 3 },
      { value: ATTENTION_CATEGORIES.APPROVALS, label: 'Approvals', count: 2 },
      { value: ATTENTION_CATEGORIES.TIMESHEETS, label: 'Timesheets', count: 2 },
      { value: ATTENTION_CATEGORIES.TUTOR_CAPACITY, label: 'Tutor capacity', count: 1 },
      { value: ATTENTION_CATEGORIES.BUDGET, label: 'Budget', count: 2 },
    ])
  })

  it('shows one category at a time, and the All view everything', () => {
    const { items } = buildAttentionFeed(mixedSummary())

    expect(filterAttentionItems(items, ALL_FILTER)).toHaveLength(10)
    expect(
      filterAttentionItems(items, ATTENTION_CATEGORIES.SHORTAGE).map((item) => item.id),
    ).toEqual(['shortage:requirement:2', 'shortage:requirement:1', 'shortage:overflow:unclaimed'])
    expect(
      filterAttentionItems(items, ATTENTION_CATEGORIES.BUDGET).map((item) => item.id),
    ).toEqual(['budget:course:3', 'budget:period:fully-used'])
  })

  it('returns nothing for a category with no items, rather than inventing any', () => {
    const { items } = buildAttentionFeed(
      summary({ staffing: staffingWith({ requirements: [requirement()] }) }),
    )

    expect(filterAttentionItems(items, ATTENTION_CATEGORIES.BUDGET)).toEqual([])
    expect(filterAttentionItems(items, ATTENTION_CATEGORIES.APPROVALS)).toEqual([])
    expect(filterAttentionItems(items, ATTENTION_CATEGORIES.TIMESHEETS)).toEqual([])
  })
})
