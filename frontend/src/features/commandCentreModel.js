/**
 * The Command Centre's view model. Every figure it shows is one the server
 * worked out: this module arranges them for the screen - which cards the
 * dashboard has, which day a requirement falls on, how wide a bar is - and
 * never adds hours together or turns them into money itself. That is why the
 * summary arrives as one read: the cards, the heatmap and the feed are all
 * measured over the same weeks.
 */

/** The same three period lengths the reports screen offers, so the two agree. */
export const PERIOD_LENGTHS = Object.freeze([
  { value: 1, label: '1 week' },
  { value: 4, label: '4 weeks' },
  { value: 12, label: '12 weeks' },
])

/**
 * Where each kind of work is dealt with. Every one of these is a screen that
 * already exists, so a drill-down never lands on a page that is not there.
 */
export const DRILL_DOWN_PATHS = Object.freeze({
  allocated: '/organiser',
  required: '/organiser/staffing',
  unfilled: '/organiser/staffing/bulk',
  spend: '/organiser/reports',
  budget: '/organiser/reports',
  actions: '/organiser/approvals',
  'staffing-shortage': '/organiser/staffing',
  'overflow-unclaimed': '/organiser/overflow',
  'volunteer-claims': '/organiser/approvals',
  'timesheet-approvals': '/organiser/approvals',
  'excuse-approvals': '/organiser/approvals',
  'timesheet-disputes': '/organiser/approvals',
  'over-budget': '/organiser/reports',
})

/** The words on the link that takes an organiser from a figure to the screen behind it. */
export const DRILL_DOWN_LABELS = Object.freeze({
  allocated: 'Allocation board',
  required: 'Open staffing requirements',
  unfilled: 'Fill shortages',
  spend: 'Open reports',
  budget: 'Open reports',
  actions: 'Open approval queues',
  'staffing-shortage': 'Open staffing requirements',
  'overflow-unclaimed': 'Open overflow work',
  'volunteer-claims': 'Open approval queues',
  'timesheet-approvals': 'Open approval queues',
  'excuse-approvals': 'Open approval queues',
  'timesheet-disputes': 'Open approval queues',
  'over-budget': 'Open reports',
})

/**
 * How full a day of staffing is, in words rather than in colour. The state the
 * server stated for a day is used as it stands; the staffing service's own rule
 * is repeated below only for a day the server gave figures for and no state,
 * and it invents no threshold of its own - nothing left to fill is fully
 * staffed, some hours allocated is partly staffed, none allocated is unstaffed.
 */
export const STAFFING_STATUS = Object.freeze({
  FULLY_STAFFED: 'fully-staffed',
  PARTIALLY_STAFFED: 'partially-staffed',
  UNSTAFFED: 'unstaffed',
  NOT_BEING_FILLED: 'not-being-filled',
  NO_WORK: 'no-work',
})

/** The written words for each state, so a colour is never the only reading. */
export const STAFFING_STATUS_LABELS = Object.freeze({
  [STAFFING_STATUS.FULLY_STAFFED]: 'Fully staffed',
  [STAFFING_STATUS.PARTIALLY_STAFFED]: 'Partly staffed',
  [STAFFING_STATUS.UNSTAFFED]: 'Unstaffed',
  [STAFFING_STATUS.NOT_BEING_FILLED]: 'Not being filled',
  [STAFFING_STATUS.NO_WORK]: 'Nothing starts',
})

/** The staffing board's own colour names, so the two screens agree. */
export const STAFFING_STATUS_TONES = Object.freeze({
  [STAFFING_STATUS.FULLY_STAFFED]: 'fully-filled',
  [STAFFING_STATUS.PARTIALLY_STAFFED]: 'partially-filled',
  [STAFFING_STATUS.UNSTAFFED]: 'unfilled',
  [STAFFING_STATUS.NOT_BEING_FILLED]: 'not-being-filled',
  [STAFFING_STATUS.NO_WORK]: 'empty',
})

/** The order the legend reads in: the states that need a person come first. */
const LEGEND_STATUSES = Object.freeze([
  STAFFING_STATUS.UNSTAFFED,
  STAFFING_STATUS.PARTIALLY_STAFFED,
  STAFFING_STATUS.FULLY_STAFFED,
  STAFFING_STATUS.NOT_BEING_FILLED,
  STAFFING_STATUS.NO_WORK,
])

/** The server's own fill state, mapped onto the words this screen shows. */
const FILL_STATE_STATUS = Object.freeze({
  'fully-filled': STAFFING_STATUS.FULLY_STAFFED,
  'partially-filled': STAFFING_STATUS.PARTIALLY_STAFFED,
  unfilled: STAFFING_STATUS.UNSTAFFED,
  'not-being-filled': STAFFING_STATUS.NOT_BEING_FILLED,
})

/**
 * The state of one day of staffing, from the figures the server sent for it.
 * The server's own state wins when it sent one; otherwise the staffing
 * service's rule decides, which is why a day with no requirements left to fill
 * is fully staffed however much was allocated to it.
 */
export function staffingStatusFor({
  requirements = 0,
  fillState = null,
  status = 'OPEN',
  assignedHours = 0,
  shortageHours = 0,
} = {}) {
  if (!(requirements > 0)) return STAFFING_STATUS.NO_WORK
  if (FILL_STATE_STATUS[fillState]) return FILL_STATE_STATUS[fillState]
  if (status !== 'OPEN') return STAFFING_STATUS.NOT_BEING_FILLED
  if (shortageHours === 0) return STAFFING_STATUS.FULLY_STAFFED
  return assignedHours > 0 ? STAFFING_STATUS.PARTIALLY_STAFFED : STAFFING_STATUS.UNSTAFFED
}

/** The written words for a state, and a plain admission when it is not known. */
export function staffingStatusLabel(status) {
  return STAFFING_STATUS_LABELS[status] ?? 'State not known'
}

/**
 * Where the course screen and the tutor screen already live. The search results
 * publish these same paths, so a drill-down lands on the page an organiser
 * reaches from anywhere else rather than on a second copy of either screen.
 */
export function courseDetailPath(courseId) {
  return courseId === null || courseId === undefined
    ? '/organiser/courses'
    : `/organiser/courses/${courseId}`
}

export function tutorDetailPath(tutorId) {
  return tutorId === null || tutorId === undefined
    ? '/organiser/tutors'
    : `/organiser/tutors/${tutorId}`
}

/** How the period stands against its budget, in the money the server sent. */
export const BUDGET_STATUS = Object.freeze({
  OVER: 'over',
  FULLY_USED: 'fully-used',
  WITHIN: 'within',
  NO_BUDGET: 'no-budget',
  UNKNOWN: 'unknown',
})

export const BUDGET_STATUS_LABELS = Object.freeze({
  [BUDGET_STATUS.OVER]: 'Over budget',
  [BUDGET_STATUS.FULLY_USED]: 'Budget fully used',
  [BUDGET_STATUS.WITHIN]: 'Within budget',
  [BUDGET_STATUS.NO_BUDGET]: 'No budget set',
  [BUDGET_STATUS.UNKNOWN]: 'Spend cannot be worked out',
})

export const BUDGET_STATUS_TONES = Object.freeze({
  [BUDGET_STATUS.OVER]: 'danger',
  [BUDGET_STATUS.FULLY_USED]: 'warning',
  [BUDGET_STATUS.WITHIN]: 'success',
  [BUDGET_STATUS.NO_BUDGET]: 'neutral',
  [BUDGET_STATUS.UNKNOWN]: 'neutral',
})

/**
 * The budget position in one word, from the totals the server worked out. A
 * spend it could not work out is unknown rather than zero, a budget of zero is
 * no budget rather than a division with no answer, and a budget spent to the
 * cent is said to be fully used rather than over or under.
 */
export function budgetStatusFor({ budget = null, spend = null, remaining = null } = {}) {
  if (spend === null || remaining === null) return BUDGET_STATUS.UNKNOWN
  if (remaining < 0) return BUDGET_STATUS.OVER
  if (budget === null || budget <= 0) return BUDGET_STATUS.NO_BUDGET
  if (remaining === 0) return BUDGET_STATUS.FULLY_USED
  return BUDGET_STATUS.WITHIN
}

const SEVERITY_ORDER = Object.freeze({ critical: 0, warning: 1, info: 2 })

/** How much of the feed a screenful shows before it says how many are left. */
const MAX_ATTENTION_ITEMS = 8

export function formatHours(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100) / 100} h` : '--'
}

// Plain and the same everywhere, rather than a locale format that would read
// differently on each organiser's machine.
export function formatMoney(value) {
  return value === null || value === undefined ? '--' : `R${value.toFixed(2)}`
}

export function formatPercent(fraction) {
  return Number.isFinite(fraction) ? `${Math.round(fraction * 100)}%` : '--'
}

function countLabel(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/**
 * A date from the server, read as the plain day it names. The server buckets
 * work by the day it starts on, so the label is taken from the date itself
 * rather than from an instant that would shift in another timezone, and it is
 * written the same on every machine rather than in the browser's own locale.
 */
export function dayLabel(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

export function weekdayLabel(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    timeZone: 'UTC',
  })
}

function spendDetail(finance) {
  if (finance.spend === null) {
    return 'No hourly rate is set, so spend cannot be worked out.'
  }
  if (finance.unpricedCourses > 0) {
    return `Excludes ${countLabel(finance.unpricedCourses, 'course')} with no rate set.`
  }
  return 'Money owed for approved work.'
}

function budgetDetail(finance) {
  if (finance.budget === null) {
    return 'No budget is set for the courses in this period.'
  }
  if (finance.overBudgetCourses > 0) {
    return `${countLabel(finance.overBudgetCourses, 'course')} over budget.`
  }
  if (finance.remaining === null) {
    return 'A budgeted course has no rate, so what is left cannot be worked out.'
  }
  return `${formatMoney(finance.remaining)} left to spend.`
}

function actionsDetail(actions) {
  const waiting = [
    [actions.pendingTimesheets, 'timesheet'],
    [actions.pendingVolunteerClaims, 'volunteer claim'],
    [actions.pendingExcuses, 'excuse'],
    [actions.openDisputes, 'dispute'],
  ]
    .filter(([count]) => count > 0)
    .map(([count, noun]) => countLabel(count, noun))

  return waiting.length === 0
    ? 'Nothing is waiting on you in this period.'
    : `Waiting on you: ${waiting.join(', ')}.`
}

export function buildKpis(summary) {
  const { staffing, finance, actions } = summary

  return [
    {
      key: 'allocated',
      label: 'Allocated hours',
      value: formatHours(staffing.assignedHours),
      detail: `Booked across ${countLabel(staffing.openRequirements, 'open requirement')}.`,
      tone: 'neutral',
      path: DRILL_DOWN_PATHS.allocated,
      linkLabel: DRILL_DOWN_LABELS.allocated,
    },
    {
      key: 'required',
      label: 'Required hours',
      value: formatHours(staffing.requiredHours),
      detail: `${countLabel(staffing.openRequirements, 'requirement')} still open in this period.`,
      tone: 'neutral',
      path: DRILL_DOWN_PATHS.required,
      linkLabel: DRILL_DOWN_LABELS.required,
    },
    {
      key: 'unfilled',
      label: 'Unfilled work',
      value: formatHours(staffing.unfilledHours),
      detail:
        staffing.unfilledRequirements === 0
          ? 'Every open requirement is covered.'
          : `${countLabel(staffing.unfilledRequirements, 'requirement')} short of tutors.`,
      tone: staffing.unfilledHours > 0 ? 'danger' : 'success',
      path: DRILL_DOWN_PATHS.unfilled,
      linkLabel: DRILL_DOWN_LABELS.unfilled,
    },
    {
      key: 'spend',
      label: 'Spend',
      value: formatMoney(finance.spend),
      detail: spendDetail(finance),
      tone: 'neutral',
      path: DRILL_DOWN_PATHS.spend,
      linkLabel: DRILL_DOWN_LABELS.spend,
    },
    {
      key: 'budget',
      label: 'Budget',
      value: formatMoney(finance.budget),
      detail: budgetDetail(finance),
      tone: finance.overBudgetCourses > 0 ? 'danger' : 'neutral',
      path: DRILL_DOWN_PATHS.budget,
      linkLabel: DRILL_DOWN_LABELS.budget,
    },
    {
      key: 'actions',
      label: 'Outstanding actions',
      value: String(actions.total),
      detail: actionsDetail(actions),
      tone: actions.total > 0 ? 'warning' : 'success',
      path: DRILL_DOWN_PATHS.actions,
      linkLabel: DRILL_DOWN_LABELS.actions,
    },
  ]
}

/**
 * The period as a week per row, so a run of short days is visible at a glance.
 * Each cell is a day the server already summed, its state is the staffing
 * service's own description of how filled that day is, and it says that state
 * in words as well as in colour. The courses that start on a day are the same
 * requirement rows the server bucketed onto it, linked to the course screen.
 */
export function buildHeatmap(summary) {
  // The staffing service buckets a requirement onto the day it starts on, so
  // a day's courses are grouped the same way rather than by a second rule.
  const byDay = new Map()
  for (const requirement of summary.staffing.requirements) {
    const date = String(requirement.startsAt ?? '').slice(0, 10)
    const rows = byDay.get(date)
    if (rows) {
      rows.push(requirement)
    } else {
      byDay.set(date, [requirement])
    }
  }

  const days = summary.staffing.days.map((day) => {
    const status = staffingStatusFor({
      requirements: day.requirements,
      fillState: day.fillState,
      assignedHours: day.assignedHours,
      shortageHours: day.unfilledHours,
    })
    const statusLabel = staffingStatusLabel(status)
    const courses = (byDay.get(day.date) ?? []).map((requirement) => ({
      key: requirement.id,
      code: requirement.courseCode,
      name: requirement.courseName,
      path: courseDetailPath(requirement.courseId),
      linkLabel: `Open ${requirement.courseCode}`,
    }))
    const sums = `${formatHours(day.requiredHours)} required, ${formatHours(
      day.assignedHours,
    )} allocated, ${formatHours(day.unfilledHours)} unfilled`

    return {
      key: day.date,
      date: day.date,
      weekday: weekdayLabel(day.date),
      label: dayLabel(day.date),
      requirements: day.requirements,
      requiredHours: day.requiredHours,
      assignedHours: day.assignedHours,
      unfilledHours: day.unfilledHours,
      fillState: day.fillState,
      status,
      statusLabel,
      tone: STAFFING_STATUS_TONES[status],
      courses,
      detail:
        day.requirements === 0
          ? `No requirements start on ${dayLabel(day.date)}.`
          : `${statusLabel}. ${countLabel(day.requirements, 'requirement')} starting: ${sums}.${
              courses.length === 0
                ? ''
                : ` Courses: ${courses.map((course) => course.code).join(', ')}.`
            }`,
    }
  })

  const weeks = []
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7))
  }

  const withWork = days.filter((day) => day.requirements > 0)

  return {
    weeks,
    hasWork: withWork.length > 0,
    unfilledDays: days.filter((day) => day.unfilledHours > 0).length,
    // The legend and the written list are built from the same days and the same
    // states as the squares above them, so the two can never drift apart.
    legend: LEGEND_STATUSES.map((status) => ({
      status,
      label: STAFFING_STATUS_LABELS[status],
      tone: STAFFING_STATUS_TONES[status],
    })),
    rows: withWork.map((day) => ({
      key: day.date,
      label: day.label,
      statusLabel: day.statusLabel,
      tone: day.tone,
      requiredLabel: formatHours(day.requiredHours),
      assignedLabel: formatHours(day.assignedHours),
      unfilledLabel: formatHours(day.unfilledHours),
      courses: day.courses,
      detail: day.detail,
    })),
    rowsNote:
      withWork.length === 0
        ? null
        : withWork.length === 1
          ? '1 day of the period has work on it, with the same figures as the squares.'
          : `${withWork.length} days of the period have work on them, with the same figures as the squares.`,
  }
}

function budgetSentence(finance) {
  if (finance.spend === null) {
    return 'No hourly rate is set for a course with work in this period, so spend cannot be worked out.'
  }
  if (finance.budget === null) {
    return `${formatMoney(finance.spend)} spent so far. No budget is set for these courses.`
  }
  if (finance.remaining === null) {
    return `${formatMoney(finance.spend)} of ${formatMoney(
      finance.budget,
    )} spent. A budgeted course has no rate, so what is left cannot be worked out.`
  }
  if (finance.remaining < 0) {
    return `${formatMoney(finance.spend)} spent against a ${formatMoney(
      finance.budget,
    )} budget, ${formatMoney(Math.abs(finance.remaining))} over.`
  }
  return `${formatMoney(finance.spend)} of ${formatMoney(
    finance.budget,
  )} spent, ${formatMoney(finance.remaining)} left.`
}

/**
 * Spend against budget as one bar, plus the courses the server has already
 * flagged as over budget. The bar is a fraction of two figures the server sent;
 * the list is that same flag, so the two can never disagree.
 */
export function buildBudgetPanel(summary) {
  const finance = summary.finance
  // A bar needs a budget to read a spend against, and it is only drawn when
  // what is left can be worked out too: a budget total that includes a course
  // with no rate has a spend total short by that course's work, so a bar drawn
  // from it would read as a position rather than as the half-answer it is. A
  // budget of zero is not divided by at all.
  const gaugeable =
    finance.budget !== null &&
    finance.budget > 0 &&
    finance.spend !== null &&
    finance.remaining !== null
  const fraction = gaugeable ? Math.min(1, finance.spend / finance.budget) : null
  // The bar can only be so full, so the true figure is written beside it: a
  // period well past its budget says so rather than reading as exactly full.
  const usedPercent = gaugeable ? formatPercent(finance.spend / finance.budget) : null
  const status = budgetStatusFor(finance)

  return {
    fraction,
    usedPercent,
    status,
    statusLabel: BUDGET_STATUS_LABELS[status],
    statusTone: BUDGET_STATUS_TONES[status],
    sentence: budgetSentence(finance),
    unpricedNote:
      finance.unpricedCourses === 0
        ? null
        : `No hourly rate is set for ${countLabel(
            finance.unpricedCourses,
            'course',
          )} in this period, so their spend is not counted.`,
    full: fraction !== null && fraction >= 1,
    percent: fraction === null ? null : formatPercent(fraction),
    spendLabel: formatMoney(finance.spend),
    budgetLabel: formatMoney(finance.budget),
    committedLabel: formatMoney(finance.committed),
    remainingLabel:
      finance.remaining === null ? null : formatMoney(Math.abs(finance.remaining)),
    overBudget: finance.remaining !== null && finance.remaining < 0,
    overBudgetCourses: finance.courses
      .filter((course) => course.budgetRemaining !== null && course.budgetRemaining < 0)
      .map((course) => ({
        key: course.courseId,
        id: course.courseId,
        code: course.courseCode,
        name: course.courseName,
        spentLabel: formatMoney(course.spend),
        budgetLabel: formatMoney(course.budget),
        overLabel: formatMoney(Math.abs(course.budgetRemaining)),
        path: courseDetailPath(course.courseId),
        linkLabel: `Open ${course.courseCode}`,
      })),
    unpricedCourses: finance.unpricedCourses,
  }
}

function capacityNoteFor(tutor, capacityLeft) {
  if (tutor.capacityHours === null) {
    return 'No capacity is set for the period, so what is left cannot be worked out.'
  }
  if (capacityLeft < 0) {
    return `${formatHours(-capacityLeft)} over the ${formatHours(tutor.capacityHours)} capacity for the period.`
  }
  if (capacityLeft === 0) {
    return `All ${formatHours(tutor.capacityHours)} of capacity for the period is allocated.`
  }
  return `${formatHours(capacityLeft)} of ${formatHours(tutor.capacityHours)} capacity left.`
}

/**
 * Who is carrying the period, in the order the report lists them. The bar is
 * the tutor's allocated hours against their capacity, what is left is those two
 * figures the server sent subtracted - never a fresh guess about capacity - and
 * the share is the report's own figure rather than a second opinion about
 * fairness. Nothing here marks a tutor as fairly or unfairly loaded.
 */
export function buildWorkloadPanel(summary) {
  const tutors = summary.workload.tutors
  const withWork = tutors.filter(
    (tutor) => tutor.allocatedHours > 0 || tutor.approvedWorkedHours > 0,
  )
  const idleTutors = tutors.length - withWork.length

  return {
    rows: withWork.map((tutor) => {
      const capacityLeft =
        tutor.capacityHours === null ? null : tutor.capacityHours - tutor.allocatedHours

      return {
        key: tutor.tutorId,
        name: tutor.fullName,
        path: tutorDetailPath(tutor.tutorId),
        linkLabel: `Open ${tutor.fullName}`,
        allocatedLabel: formatHours(tutor.allocatedHours),
        approvedLabel: formatHours(tutor.approvedWorkedHours),
        shareLabel: formatPercent(tutor.shareOfAllocatedHours),
        capacityLabel:
          tutor.capacityHours === null ? null : formatHours(tutor.capacityHours),
        remainingLabel: capacityLeft === null ? null : formatHours(Math.max(0, capacityLeft)),
        capacityNote: capacityNoteFor(tutor, capacityLeft),
        fraction:
          tutor.capacityHours === null || tutor.capacityHours <= 0
            ? null
            : Math.min(1, tutor.allocatedHours / tutor.capacityHours),
        over:
          tutor.capacityHours !== null && tutor.allocatedHours > tutor.capacityHours,
      }
    }),
    emptyNote: 'No tutor has allocated or approved hours in this period.',
    spreadNote:
      withWork.length === 0
        ? null
        : `${countLabel(withWork.length, 'tutor')} carrying allocated or approved hours in this period.`,
    idleTutors,
    idleNote:
      idleTutors === 0
        ? null
        : `${countLabel(idleTutors, 'tutor')} has no allocated or approved hours in this period.`,
    // The share is the report's figure, and it is described as what it is: an
    // indication of how the work fell, not a score or a rule to pass.
    softNote:
      "The share is the report's own figure for how the period's allocated hours are spread. It is indicative only, not a target or a fair-share rule.",
  }
}

/**
 * What needs a person, in the order it needs one: the staffing the period is
 * short of, work nobody has claimed, the queues waiting on a decision, and the
 * budgets that have run past what was planned. Each item comes from a figure the
 * server sent - a shortage, a queue length, a count - and points at the screen
 * that already handles it.
 */
export function buildAttentionFeed(summary) {
  const items = []

  const short = summary.staffing.requirements
    .filter((requirement) => requirement.shortageHours > 0)
    .sort((first, second) => second.shortageHours - first.shortageHours)

  for (const requirement of short) {
    items.push({
      key: `staffing-${requirement.id}`,
      kind: 'staffing-shortage',
      severity: requirement.fillState === 'unfilled' ? 'critical' : 'warning',
      title: `${requirement.courseCode}: ${formatHours(requirement.shortageHours)} still unfilled`,
      detail: `${requirement.courseName} on ${dayLabel(requirement.startsAt.slice(0, 10))}. ${countLabel(
        requirement.shortageTutors,
        'more tutor',
      )} needed.`,
    })
  }

  if (summary.overflow.unclaimedItems > 0) {
    items.push({
      key: 'overflow-unclaimed',
      kind: 'overflow-unclaimed',
      severity: 'warning',
      title: `${countLabel(summary.overflow.unclaimedItems, 'overflow item')} with no student claims`,
      detail: `${formatHours(summary.overflow.openHours)} of posted work is still waiting for a volunteer.`,
    })
  }

  if (summary.actions.pendingTimesheets > 0) {
    items.push({
      key: 'timesheet-approvals',
      kind: 'timesheet-approvals',
      severity: 'warning',
      title: `${countLabel(summary.actions.pendingTimesheets, 'timesheet')} waiting for approval`,
      detail: 'Submitted hours cannot be paid until they are signed off.',
    })
  }

  if (summary.actions.pendingVolunteerClaims > 0) {
    items.push({
      key: 'volunteer-claims',
      kind: 'volunteer-claims',
      severity: 'warning',
      title: `${countLabel(summary.actions.pendingVolunteerClaims, 'volunteer claim')} waiting for a decision`,
      detail: 'Students have asked to take on posted work.',
    })
  }

  if (summary.actions.pendingExcuses > 0) {
    items.push({
      key: 'excuse-approvals',
      kind: 'excuse-approvals',
      severity: 'info',
      title: `${countLabel(summary.actions.pendingExcuses, 'excuse')} waiting for a decision`,
      detail: 'Tutors have asked to be excused from allocated work.',
    })
  }

  if (summary.actions.openDisputes > 0) {
    items.push({
      key: 'timesheet-disputes',
      kind: 'timesheet-disputes',
      severity: 'warning',
      title: `${countLabel(summary.actions.openDisputes, 'timesheet dispute')} still open`,
      detail: 'Disputed weeks are held back from payroll until they are answered.',
    })
  }

  if (summary.finance.overBudgetCourses > 0) {
    items.push({
      key: 'over-budget',
      kind: 'over-budget',
      severity: 'critical',
      title: `${countLabel(summary.finance.overBudgetCourses, 'course')} over budget`,
      detail: 'Approved work has passed what was planned for the period.',
    })
  }

  // Critical first, then warnings, then anything worth knowing. The sort is
  // stable, so within a severity the list keeps the order the figures were
  // read in: the biggest shortage first, then the queues.
  const ordered = items
    .map((item) => ({
      ...item,
      path: DRILL_DOWN_PATHS[item.kind],
      linkLabel: DRILL_DOWN_LABELS[item.kind],
    }))
    .sort(
      (first, second) =>
        SEVERITY_ORDER[first.severity] - SEVERITY_ORDER[second.severity],
    )

  return {
    items: ordered.slice(0, MAX_ATTENTION_ITEMS),
    total: ordered.length,
  }
}

/**
 * True when the period holds nothing at all: no work, no money, no queues. The
 * screen says so once rather than drawing empty panels that look like a fault.
 */
export function isEmptyPeriod(summary) {
  return (
    summary.staffing.requirements.length === 0 &&
    summary.finance.courses.length === 0 &&
    summary.workload.tutors.length === 0 &&
    summary.actions.total === 0 &&
    summary.overflow.openItems === 0
  )
}
