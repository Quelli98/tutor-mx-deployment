import { addDays, localMonday } from '../components/shared/scheduleWeek'

/**
 * Figures for the organiser's Home page, worked out from what the server sends. Hours are
 * added up only within one kind (allocated with allocated, approved with approved), and money
 * is only ever the server's own spend and budget figures, added up and rounded to cents.
 */

const DAY_MS = 86_400_000
const MAX_REPORT_WEEKS = 52

export function toIsoDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Hours are booked in quarter hours, so rounding to two places only removes float noise.
export function sumHours(rows, field) {
  return Math.round(rows.reduce((total, row) => total + (Number.isFinite(row[field]) ? row[field] : 0), 0) * 100) / 100
}

// The same plain format as the Reports page.
export function money(value) {
  return value === null || value === undefined ? '--' : `R${value.toFixed(2)}`
}

export function isInWeek(isoValue, weekStart) {
  const time = new Date(isoValue).valueOf()
  return time >= weekStart.valueOf() && time < addDays(weekStart, 7).valueOf()
}

/** Open staffing requirements whose session starts in the week, soonest first. */
export function requirementsForWeek(requirements, weekStart) {
  return requirements
    .filter((requirement) => requirement.status === 'OPEN' && isInWeek(requirement.startsAt, weekStart))
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
}

/**
 * The reporting period from the first week of the selected week's year up to and including the
 * selected week, for "budget used this year". The server allows at most 52 weeks.
 */
export function yearToDatePeriod(weekStart) {
  let start = localMonday(new Date(weekStart.getFullYear(), 0, 1))
  let weeks = Math.round((weekStart.valueOf() - start.valueOf()) / (7 * DAY_MS)) + 1
  if (weeks > MAX_REPORT_WEEKS) {
    start = addDays(weekStart, -7 * (MAX_REPORT_WEEKS - 1))
    weeks = MAX_REPORT_WEEKS
  }
  return { weekStart: toIsoDate(start), weeks: Math.max(1, weeks) }
}

/** Spend against budget across the courses that have both, or null when none do. */
export function budgetUsed(courseRows) {
  const counted = courseRows.filter((row) => row.budget !== null && row.spend !== null)
  if (counted.length === 0) return null
  const budget = Math.round(counted.reduce((total, row) => total + row.budget, 0) * 100) / 100
  const spend = Math.round(counted.reduce((total, row) => total + row.spend, 0) * 100) / 100
  if (budget <= 0) return { spend, budget, fraction: spend > 0 ? 1 : 0 }
  return { spend, budget, fraction: spend / budget }
}

export function percent(fraction) {
  return `${Math.round(fraction * 100)}%`
}

const ACCENTS = ['magenta', 'violet', 'indigo']

/**
 * The course cards on Home: the busiest courses this week first (by allocated hours, then code),
 * with how many tutors work on each this week, its hours, its budget used this year and its
 * next session.
 */
export function courseCards(courses, allocations, weekReport, yearReport, weekStart, now = new Date(), limit = 3) {
  const weekRows = new Map((weekReport?.courses ?? []).map((row) => [row.courseId, row]))
  const yearRows = new Map((yearReport?.courses ?? []).map((row) => [row.courseId, row]))
  const active = allocations.filter((allocation) => allocation.status !== 'CANCELLED')

  return courses
    .map((course) => {
      const courseAllocations = active.filter((allocation) => allocation.courseId === course.id)
      const tutorsThisWeek = new Set(
        courseAllocations.filter((allocation) => isInWeek(allocation.startsAt, weekStart)).map((allocation) => allocation.tutorId),
      ).size
      const next = courseAllocations
        .filter((allocation) => new Date(allocation.startsAt) >= now)
        .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))[0]
      const yearRow = yearRows.get(course.id)
      const used = yearRow ? budgetUsed([yearRow]) : null
      return {
        id: course.id,
        code: course.code,
        name: course.name,
        tutorsThisWeek,
        hoursThisWeek: weekRows.get(course.id)?.allocatedHours ?? 0,
        budgetFraction: used ? used.fraction : null,
        nextSession: next ? next.startsAt : null,
      }
    })
    .sort((a, b) => b.hoursThisWeek - a.hoursThisWeek || a.code.localeCompare(b.code))
    .slice(0, limit)
    .map((card, index) => ({ ...card, accent: ACCENTS[index % ACCENTS.length] }))
}

/** Tutors with the fullest week first; tutors without a weekly limit go last. */
export function tutorLoads(tutors, limit = 5) {
  return tutors
    .map((tutor) => ({
      id: tutor.id,
      name: tutor.fullName?.trim() || tutor.email,
      usedHours: tutor.usedHours,
      weeklyHours: tutor.weeklyHours,
      status: tutor.capacityStatus,
      fraction: tutor.weeklyHours ? Math.min(1, tutor.usedHours / tutor.weeklyHours) : null,
    }))
    .sort((a, b) => (b.fraction ?? -1) - (a.fraction ?? -1) || a.name.localeCompare(b.name))
    .slice(0, limit)
}

export function initials(name) {
  const words = String(name ?? '').split(/[\s@.]+/).filter(Boolean)
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)
  return letters.toUpperCase()
}

export function shortDateTime(isoValue) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(isoValue))
}

export function timeRange(startIso, endIso) {
  const format = (value) => new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${format(startIso)} – ${format(endIso)}`
}
