import { fetchWithBearerToken } from './client'

const ALLOCATION_STATES = new Set(['PROPOSED', 'CONFIRMED'])

function isFiniteNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isNullableNonNegativeNumber(value) {
  return value === null || isFiniteNonNegativeNumber(value)
}

function isAllocation(value) {
  if (!value || typeof value !== 'object' || 'tutorId' in value) return false

  const startsAt = new Date(value.startsAt)
  const endsAt = new Date(value.endsAt)
  return (
    Number.isInteger(value.id) &&
    value.id > 0 &&
    typeof value.courseCode === 'string' &&
    value.courseCode.length > 0 &&
    typeof value.courseName === 'string' &&
    value.courseName.length > 0 &&
    !Number.isNaN(startsAt.valueOf()) &&
    !Number.isNaN(endsAt.valueOf()) &&
    endsAt > startsAt &&
    typeof value.allocatedHours === 'number' &&
    value.allocatedHours > 0 &&
    value.allocatedHours <= 24 &&
    ALLOCATION_STATES.has(value.status)
  )
}

const OBLIGATION_KINDS = ['LOG_HOURS', 'SUBMIT_TIMESHEET', 'RESUBMIT_TIMESHEET']

function isObligation(value) {
  return Boolean(value) &&
    OBLIGATION_KINDS.includes(value.kind) &&
    typeof value.title === 'string' && value.title.length > 0 &&
    typeof value.weekEnding === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.weekEnding) &&
    (value.dueAt === null || (typeof value.dueAt === 'string' && Number.isFinite(Date.parse(value.dueAt)))) &&
    typeof value.overdue === 'boolean'
}

export function parseTutorDashboardResponse(body) {
  const dashboard = body?.data?.dashboard
  if (
    !dashboard ||
    !Array.isArray(dashboard.allocations) ||
    !dashboard.allocations.every(isAllocation) ||
    !isNullableNonNegativeNumber(dashboard.weeklyLimit) ||
    !isFiniteNonNegativeNumber(dashboard.usedHours) ||
    !isNullableNonNegativeNumber(dashboard.remainingHours) ||
    (dashboard.obligations !== undefined &&
      (!Array.isArray(dashboard.obligations) || !dashboard.obligations.every(isObligation)))
  ) {
    throw new Error('The tutor dashboard response did not match the agreed contract.')
  }

  return { ...dashboard, obligations: dashboard.obligations ?? [] }
}

export async function fetchTutorDashboard(tokenOrGetter) {
  const body = await fetchWithBearerToken('/api/tutor/dashboard', {}, tokenOrGetter)
  return parseTutorDashboardResponse(body)
}

export function isValidWeeklyCapacity(value) {
  return value === null || (
    typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 168 &&
    Math.abs(value * 100 - Math.round(value * 100)) < 1e-9
  )
}

export async function saveWeeklyCapacity(weeklyHours, tokenOrGetter) {
  if (!isValidWeeklyCapacity(weeklyHours)) throw new Error('Invalid weekly capacity.')
  const body = await fetchWithBearerToken('/api/tutor/weekly-capacity', {
    method: 'PATCH', body: JSON.stringify({ weeklyHours }),
  }, tokenOrGetter)
  if (!isValidWeeklyCapacity(body?.data?.weeklyHours)) {
    throw new Error('The weekly capacity response did not match the agreed contract.')
  }
  return body.data.weeklyHours
}
