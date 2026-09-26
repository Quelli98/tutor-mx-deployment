import {
  BUDGET_STATUS,
  DRILL_DOWN_LABELS,
  DRILL_DOWN_PATHS,
  budgetStatusFor,
  countLabel,
  courseDetailPath,
  dayLabel,
  formatHours,
  formatMoney,
  tutorDetailPath,
} from './commandCentreModel'

/**
 * The Needs Attention feed's model (S3-M6-3). It is a presentation layer over
 * reads that already exist: every figure, state and count an item carries is one
 * the Command Centre summary or Member 1's notification store already worked
 * out, and every quick action is a link to a screen that already handles the
 * issue. Nothing here decides an approval, fills a shortage or re-checks a
 * permission - the destination screen keeps doing all of that.
 *
 * Where each category's data comes from:
 *
 * SHORTAGE - the summary's open staffing requirements, each with the shortage
 * hours and fill state the staffing service computed, plus the count of posted
 * overflow work no student has claimed.
 *
 * APPROVALS / TIMESHEETS - the queue lengths the summary counted from the
 * approval and dispute reads. The waiting-time context is Member 1's reminder
 * store reused: a TIMESHEET_REVIEW_DUE, VOLUNTEER_CLAIM_DUE or EXCUSE_REVIEW_DUE
 * notification is the application's own statement that a queue item has waited
 * past its reminder threshold, so those rows are folded into the queue's card
 * rather than shown beside it. No second alert storage is created.
 *
 * Returned timesheets are the tutor's action, and the only reminder for them
 * (TIMESHEET_RESUBMIT_DUE) is addressed to the tutor, so no organiser-facing
 * source for them exists; the organiser's returned/overdue view is the overdue
 * submitted timesheets above plus the open disputes the summary already counts.
 *
 * TUTOR CAPACITY - the workload report's allocated hours against the capacity it
 * states, judged by the application's own near-limit rule rather than by a
 * threshold of this feed's own: the tutor screens already treat a tutor as near
 * their limit from 80% of the stated limit upwards (see NEAR_CAPACITY_SHARE
 * below). A tutor with no capacity stated cannot be judged, so they stay on the
 * workload panel, which already shows how full each one is.
 *
 * BUDGET - the per-course rows the server already flagged (budgetRemaining
 * below zero), and the period-level "fully used" state the budget panel already
 * derives from the totals. No approaching-budget threshold is invented.
 */

/** The categories the feed can be filtered by, in the order the filter reads. */
export const ATTENTION_CATEGORIES = Object.freeze({
  SHORTAGE: 'shortage',
  APPROVALS: 'approvals',
  TIMESHEETS: 'timesheets',
  TUTOR_CAPACITY: 'tutor-capacity',
  BUDGET: 'budget',
})

const CATEGORY_ORDER = Object.freeze([
  ATTENTION_CATEGORIES.SHORTAGE,
  ATTENTION_CATEGORIES.APPROVALS,
  ATTENTION_CATEGORIES.TIMESHEETS,
  ATTENTION_CATEGORIES.TUTOR_CAPACITY,
  ATTENTION_CATEGORIES.BUDGET,
])

/** The words on the filter buttons, one per category, plus the All view. */
export const ATTENTION_CATEGORY_LABELS = Object.freeze({
  [ATTENTION_CATEGORIES.SHORTAGE]: 'Shortages',
  [ATTENTION_CATEGORIES.APPROVALS]: 'Approvals',
  [ATTENTION_CATEGORIES.TIMESHEETS]: 'Timesheets',
  [ATTENTION_CATEGORIES.TUTOR_CAPACITY]: 'Tutor capacity',
  [ATTENTION_CATEGORIES.BUDGET]: 'Budget',
})

/** The filter value that shows every category at once. */
export const ALL_FILTER = 'all'

/**
 * How urgent a card is, in the three words the feed already colour-codes by.
 * The priority of a kind never varies with the data behind it, so the same
 * state always produces the same order; only the copy below it changes.
 */
export const ATTENTION_PRIORITY_LABELS = Object.freeze({
  critical: 'Urgent',
  warning: 'Soon',
  info: 'For information',
})

const PRIORITY_ORDER = Object.freeze({ critical: 0, warning: 1, info: 2 })

/**
 * The share of a tutor's stated capacity at which the application itself calls
 * them near their limit. This is not a threshold invented here: the tutor
 * screens already use it in the SQL that states a tutor's capacity state
 * (src/services/allocation-queries.ts, getTutorWorkloads: usedHours at or above
 * weeklyLimit * 0.8 is "near-limit"). The report's capacity hours are that same
 * weekly limit measured over the period's weeks, so the same share of the two
 * period figures the report sends is the same rule.
 */
const NEAR_CAPACITY_SHARE = 0.8

/**
 * Every route an attention card may point at. These are the organiser screens
 * that already exist, so a card can never manufacture a route another role owns
 * or one the router does not serve; the two detail screens are matched by their
 * own pattern because their id is a plain positive integer the mapper checked
 * before the path was built. This list is defence in depth - the real gate is
 * the role guard the destination route already carries, which a link never
 * bypasses.
 */
const ATTENTION_ROUTE_ALLOWLIST = Object.freeze([
  '/organiser',
  '/organiser/courses',
  '/organiser/tutors',
  '/organiser/staffing',
  '/organiser/staffing/bulk',
  '/organiser/reports',
  '/organiser/approvals',
  '/organiser/overflow',
])

const COURSE_DETAIL_ROUTE = /^\/organiser\/courses\/\d+$/
const TUTOR_DETAIL_ROUTE = /^\/organiser\/tutors\/\d+$/

/** True only for a route the organiser role can open, as the router serves it. */
export function isOrganiserAttentionRoute(path) {
  if (typeof path !== 'string' || path.length === 0) return false
  if (ATTENTION_ROUTE_ALLOWLIST.includes(path)) return true
  return COURSE_DETAIL_ROUTE.test(path) || TUTOR_DETAIL_ROUTE.test(path)
}

/**
 * How each kind of item finds the screen that handles it. Fixed-route kinds
 * point at the queue screen that already deals with that work; entity kinds
 * point at the course or tutor screen the search results and the command
 * centre already publish. No kind constructs a route from anything unchecked.
 */
const TARGET_RULES = Object.freeze({
  'staffing-shortage': {
    route: () => DRILL_DOWN_PATHS['staffing-shortage'],
    linkLabel: () => DRILL_DOWN_LABELS['staffing-shortage'],
  },
  'overflow-unclaimed': {
    route: () => DRILL_DOWN_PATHS['overflow-unclaimed'],
    linkLabel: () => DRILL_DOWN_LABELS['overflow-unclaimed'],
  },
  'timesheet-approvals': {
    route: () => DRILL_DOWN_PATHS['timesheet-approvals'],
    linkLabel: () => DRILL_DOWN_LABELS['timesheet-approvals'],
  },
  'volunteer-claims': {
    route: () => DRILL_DOWN_PATHS['volunteer-claims'],
    linkLabel: () => DRILL_DOWN_LABELS['volunteer-claims'],
  },
  'excuse-approvals': {
    route: () => DRILL_DOWN_PATHS['excuse-approvals'],
    linkLabel: () => DRILL_DOWN_LABELS['excuse-approvals'],
  },
  'timesheet-disputes': {
    route: () => DRILL_DOWN_PATHS['timesheet-disputes'],
    linkLabel: () => DRILL_DOWN_LABELS['timesheet-disputes'],
  },
  'tutor-capacity': {
    entity: 'tutor',
    route: (item) => tutorDetailPath(item.entity.id),
    linkLabel: (item) => `Open ${item.entity.label}`,
  },
  'budget-course': {
    entity: 'course',
    route: (item) => courseDetailPath(item.entity.id),
    linkLabel: (item) => `Open ${item.entity.label}`,
  },
  'budget-fully-used': {
    route: () => DRILL_DOWN_PATHS['over-budget'],
    linkLabel: () => DRILL_DOWN_LABELS['over-budget'],
  },
})

/**
 * The feed's deep-link mapper. It is the only place an attention item becomes a
 * route, and it refuses anything it cannot vouch for: an item that is not an
 * item, a kind no rule knows, an entity id that is missing or not a positive
 * integer, an entity the current data no longer lists (a course or tutor read
 * after the feed was built), and a route outside the organiser screens. A
 * refused target renders without a link rather than navigating somewhere stale,
 * and the destination screen still re-checks permission and state on arrival -
 * a link is never the authority.
 */
export function resolveAttentionTarget(item, options = {}) {
  if (!item || typeof item !== 'object' || typeof item.kind !== 'string') {
    return { ok: false, reason: 'malformed-item' }
  }

  const rule = TARGET_RULES[item.kind]
  if (!rule) {
    return { ok: false, reason: 'unknown-kind' }
  }

  if (rule.entity) {
    const entityId = item.entity?.id
    if (!Number.isInteger(entityId) || entityId <= 0) {
      return { ok: false, reason: 'missing-id' }
    }
    // Staleness is only claimed where the current data can show it: when the
    // caller passed the ids the latest read knows, an entity absent from them
    // is no longer there to link to. Without those ids there is nothing to
    // check against, and the destination screen remains the final judge.
    const knownIds =
      rule.entity === 'course' ? options.knownCourseIds : options.knownTutorIds
    if (knownIds instanceof Set && !knownIds.has(entityId)) {
      return { ok: false, reason: 'stale-target' }
    }
  }

  const path = rule.route(item)
  if (!isOrganiserAttentionRoute(path)) {
    return { ok: false, reason: 'forbidden-route' }
  }

  return { ok: true, path, linkLabel: rule.linkLabel(item) }
}

/**
 * The distinct workflow items Member 1's due reminders have already been raised
 * for. Reminders repeat once a day per recipient, so the same waiting timesheet
 * can carry several rows; counting distinct target ids is what keeps one
 * underlying issue one item. Rows without a usable target id are ignored.
 */
function dueReminderTargets(notifications) {
  const timesheetReview = new Set()
  const volunteerClaim = new Set()
  const excuseReview = new Set()

  for (const notification of Array.isArray(notifications) ? notifications : []) {
    if (!notification || typeof notification !== 'object') continue
    const targetId = notification.targetId
    if (!Number.isInteger(targetId) || targetId <= 0) continue

    if (notification.type === 'TIMESHEET_REVIEW_DUE') {
      timesheetReview.add(targetId)
    } else if (notification.type === 'VOLUNTEER_CLAIM_DUE') {
      volunteerClaim.add(targetId)
    } else if (notification.type === 'EXCUSE_REVIEW_DUE') {
      excuseReview.add(targetId)
    }
  }

  return { timesheetReview, volunteerClaim, excuseReview }
}

/**
 * The overdue part of a queue's sentence, from the reminders above. The count
 * is clamped to the queue length the summary still reports, because a reminder
 * can outlive the item it was raised for: the queue is the authoritative count
 * of what is still waiting, so the card never claims more overdue items than
 * there are items.
 */
function overdueSentence(reminderCount, queueCount, noun) {
  const overdue = Math.min(reminderCount, queueCount)
  if (overdue <= 0) return null
  return `A ${noun} reminder has already been raised for ${overdue} of them.`
}

function joinSentences(...sentences) {
  return sentences.filter(Boolean).join(' ')
}

/**
 * Why a tutor who is near, but not at, their stated capacity is on the feed:
 * the hours that put them there, what is left, and the application's own share
 * that decides it, so the reason can be checked rather than taken on trust.
 */
function nearCapacitySentence(tutor, overBy) {
  return `${formatHours(tutor.allocatedHours)} allocated of ${formatHours(
    tutor.capacityHours,
  )} capacity, ${formatHours(-overBy)} left. The application marks a tutor as near their limit once ${Math.round(
    NEAR_CAPACITY_SHARE * 100,
  )}% of the stated capacity is allocated.`
}

/**
 * What needs a person, as one structured item per underlying issue. Each item
 * carries its stable identity (`category:entity:id`, never an array index or a
 * random value), its category and priority, the reason it needs attention, and
 * the entity it is about; the mapper above turns the item into its link.
 *
 * The same issue arriving through more than one source collapses to one item:
 * items are collected into a map keyed by id, so a duplicate requirement row or
 * a repeated reminder cannot produce a second card, and a reminder never adds a
 * card of its own - it only adds waiting-time context to the queue card that
 * already carries the issue it is about.
 *
 * The feed is ordered by priority and, within a priority, keeps the order the
 * figures were read in: the biggest shortage first, then the queues, the
 * tutors and the budgets.
 */
export function buildAttentionFeed(summary, notifications = []) {
  const items = new Map()
  const add = (item) => {
    if (!items.has(item.id)) items.set(item.id, item)
  }

  const short = (summary.staffing.requirements ?? [])
    .filter((requirement) => requirement.shortageHours > 0)
    .sort(
      (first, second) =>
        second.shortageHours - first.shortageHours || first.id - second.id,
    )

  for (const requirement of short) {
    add({
      id: `shortage:requirement:${requirement.id}`,
      kind: 'staffing-shortage',
      category: ATTENTION_CATEGORIES.SHORTAGE,
      priority: requirement.fillState === 'unfilled' ? 'critical' : 'warning',
      title: `${requirement.courseCode}: ${formatHours(requirement.shortageHours)} still unfilled`,
      detail: `${requirement.courseName} on ${dayLabel(
        String(requirement.startsAt ?? '').slice(0, 10),
      )}. ${countLabel(requirement.shortageTutors, 'more tutor')} needed.`,
      entity: { type: 'requirement', id: requirement.id, label: requirement.courseCode },
    })
  }

  if (summary.overflow.unclaimedItems > 0) {
    add({
      id: 'shortage:overflow:unclaimed',
      kind: 'overflow-unclaimed',
      category: ATTENTION_CATEGORIES.SHORTAGE,
      priority: 'warning',
      title: `${countLabel(summary.overflow.unclaimedItems, 'overflow item')} with no student claims`,
      detail: `${formatHours(summary.overflow.openHours)} of posted work is still waiting for a volunteer.`,
      entity: { type: 'overflow-queue', id: null, label: 'Overflow work' },
    })
  }

  const reminders = dueReminderTargets(notifications)
  const { actions } = summary

  if (actions.pendingTimesheets > 0) {
    add({
      id: 'timesheets:queue:submitted',
      kind: 'timesheet-approvals',
      category: ATTENTION_CATEGORIES.TIMESHEETS,
      priority: 'warning',
      title: `${countLabel(actions.pendingTimesheets, 'timesheet')} waiting for approval`,
      detail: joinSentences(
        'Submitted hours cannot be paid until they are signed off.',
        overdueSentence(
          reminders.timesheetReview.size,
          actions.pendingTimesheets,
          'review',
        ),
      ),
      entity: { type: 'timesheet-queue', id: null, label: 'Timesheet approvals' },
    })
  }

  if (actions.pendingVolunteerClaims > 0) {
    add({
      id: 'approvals:queue:volunteer-claims',
      kind: 'volunteer-claims',
      category: ATTENTION_CATEGORIES.APPROVALS,
      priority: 'warning',
      title: `${countLabel(actions.pendingVolunteerClaims, 'volunteer claim')} waiting for a decision`,
      detail: joinSentences(
        'Students have asked to take on posted work.',
        overdueSentence(
          reminders.volunteerClaim.size,
          actions.pendingVolunteerClaims,
          'decision',
        ),
      ),
      entity: { type: 'volunteer-claim-queue', id: null, label: 'Volunteer claims' },
    })
  }

  if (actions.pendingExcuses > 0) {
    add({
      id: 'approvals:queue:excuses',
      kind: 'excuse-approvals',
      category: ATTENTION_CATEGORIES.APPROVALS,
      priority: 'info',
      title: `${countLabel(actions.pendingExcuses, 'excuse')} waiting for a decision`,
      detail: joinSentences(
        'Tutors have asked to be excused from allocated work.',
        overdueSentence(reminders.excuseReview.size, actions.pendingExcuses, 'decision'),
      ),
      entity: { type: 'excuse-queue', id: null, label: 'Excuses' },
    })
  }

  if (actions.openDisputes > 0) {
    add({
      id: 'timesheets:queue:disputes',
      kind: 'timesheet-disputes',
      category: ATTENTION_CATEGORIES.TIMESHEETS,
      priority: 'warning',
      title: `${countLabel(actions.openDisputes, 'timesheet dispute')} still open`,
      detail: 'Disputed weeks are held back from payroll until they are answered.',
      entity: { type: 'dispute-queue', id: null, label: 'Timesheet disputes' },
    })
  }

  for (const tutor of summary.workload.tutors ?? []) {
    // Only the two figures the report states decide this, at the application's
    // own near-limit share: a tutor is surfaced once allocated hours reach that
    // share of the stated capacity. A tutor with no capacity stated cannot be
    // judged, so they are left to the workload panel rather than guessed at.
    if (tutor.capacityHours === null || tutor.capacityHours === undefined) continue
    if (!(tutor.allocatedHours > 0)) continue
    if (!(tutor.allocatedHours >= tutor.capacityHours * NEAR_CAPACITY_SHARE)) continue

    const overBy = tutor.allocatedHours - tutor.capacityHours

    add({
      id: `tutor-capacity:tutor:${tutor.tutorId}`,
      kind: 'tutor-capacity',
      category: ATTENTION_CATEGORIES.TUTOR_CAPACITY,
      priority: overBy >= 0 ? 'warning' : 'info',
      title:
        overBy > 0
          ? `${tutor.fullName} is over the capacity stated for the period`
          : overBy === 0
            ? `${tutor.fullName} has no capacity left for the period`
            : `${tutor.fullName} is near the capacity stated for the period`,
      detail:
        overBy > 0
          ? `${formatHours(tutor.allocatedHours)} allocated against ${formatHours(
              tutor.capacityHours,
            )} capacity, ${formatHours(overBy)} over.`
          : overBy === 0
            ? `All ${formatHours(tutor.capacityHours)} of capacity is allocated.`
            : nearCapacitySentence(tutor, overBy),
      entity: { type: 'tutor', id: tutor.tutorId, label: tutor.fullName },
    })
  }

  for (const course of summary.finance.courses ?? []) {
    if (course.budgetRemaining === null || course.budgetRemaining === undefined) continue
    if (!(course.budgetRemaining < 0)) continue

    add({
      id: `budget:course:${course.courseId}`,
      kind: 'budget-course',
      category: ATTENTION_CATEGORIES.BUDGET,
      priority: 'critical',
      title: `${course.courseCode} is over budget`,
      detail: `${formatMoney(course.spend)} spent against ${formatMoney(
        course.budget,
      )} budget, ${formatMoney(Math.abs(course.budgetRemaining))} over.`,
      entity: { type: 'course', id: course.courseId, label: course.courseCode },
    })
  }

  if (budgetStatusFor(summary.finance) === BUDGET_STATUS.FULLY_USED) {
    add({
      id: 'budget:period:fully-used',
      kind: 'budget-fully-used',
      category: ATTENTION_CATEGORIES.BUDGET,
      priority: 'warning',
      title: `The period's budget is fully used`,
      detail: `${formatMoney(summary.finance.spend)} of ${formatMoney(
        summary.finance.budget,
      )} spent, nothing left to spend.`,
      entity: { type: 'period-budget', id: null, label: 'Budget' },
    })
  }

  const ordered = [...items.values()].sort(
    (first, second) =>
      PRIORITY_ORDER[first.priority] - PRIORITY_ORDER[second.priority],
  )

  return {
    items: ordered,
    total: ordered.length,
  }
}

/** The filter buttons the feed offers: the All view plus every category. */
export function attentionFilterOptions(items) {
  const counts = new Map(CATEGORY_ORDER.map((category) => [category, 0]))
  for (const item of Array.isArray(items) ? items : []) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1)
  }

  return [
    { value: ALL_FILTER, label: 'All', count: items.length },
    ...CATEGORY_ORDER.map((category) => ({
      value: category,
      label: ATTENTION_CATEGORY_LABELS[category],
      count: counts.get(category) ?? 0,
    })),
  ]
}

/**
 * The items one filter shows. The filter works on the structured items, so
 * every view is the same single feed read from a different angle and an item
 * can never appear under two categories at once.
 */
export function filterAttentionItems(items, filter) {
  if (!filter || filter === ALL_FILTER) return [...items]
  return items.filter((item) => item.category === filter)
}
