import { fetchWithBearerToken } from './client'

const ALLOCATION_STATES = new Set(['PROPOSED', 'CONFIRMED'])

function isFiniteNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
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

export function parseTutorDashboardResponse(body) {
  const dashboard = body?.data?.dashboard
  if (
    !dashboard ||
    !Array.isArray(dashboard.allocations) ||
    !dashboard.allocations.every(isAllocation) ||
    !isFiniteNonNegativeNumber(dashboard.weeklyLimit) ||
    !isFiniteNonNegativeNumber(dashboard.usedHours) ||
    !isFiniteNonNegativeNumber(dashboard.remainingHours)
  ) {
    throw new Error('The tutor dashboard response did not match the agreed contract.')
  }

  return dashboard
}

export async function fetchTutorDashboard(tokenOrGetter) {
  const body = await fetchWithBearerToken('/api/tutor/dashboard', {}, tokenOrGetter)
  return parseTutorDashboardResponse(body)
}
