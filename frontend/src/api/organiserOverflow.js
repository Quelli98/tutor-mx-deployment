import { fetchWithBearerToken } from './client'

export const OVERFLOW_WORK_STATUSES = Object.freeze(['OPEN', 'FILLED', 'CLOSED', 'CANCELLED'])

function isDate(value) {
  return typeof value === 'string' && Number.isFinite(new Date(value).valueOf())
}

function isOverflowWork(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    Number.isInteger(value.id) &&
    Number.isInteger(value.courseId) &&
    typeof value.courseCode === 'string' &&
    typeof value.courseName === 'string' &&
    isDate(value.startsAt) &&
    isDate(value.endsAt) &&
    Number.isFinite(value.hours) &&
    Number.isFinite(value.windowHours) &&
    OVERFLOW_WORK_STATUSES.includes(value.status) &&
    (value.closesAt === null || isDate(value.closesAt)) &&
    (value.sourceRequirementId === null || Number.isInteger(value.sourceRequirementId)) &&
    Number.isInteger(value.pendingClaims) &&
    Number.isInteger(value.acceptedClaims) &&
    isDate(value.createdAt) &&
    isDate(value.updatedAt)
  )
}

function overflowWorkFrom(body) {
  const overflowWork = body?.data?.overflowWork
  if (!isOverflowWork(overflowWork)) {
    throw new Error('The overflow work response did not match the agreed contract.')
  }
  return overflowWork
}

function overflowWorkArrayFrom(body) {
  const overflowWork = body?.data?.overflowWork
  if (!Array.isArray(overflowWork) || !overflowWork.every(isOverflowWork)) {
    throw new Error('The overflow work response did not match the agreed contract.')
  }
  return overflowWork
}

function overflowWorkBody(input, extra = {}) {
  return JSON.stringify({
    courseId: input.courseId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    hours: input.hours,
    closesAt: input.closesAt ?? null,
    ...extra,
  })
}

export async function listOrganiserOverflowWork(tokenOrGetter) {
  const body = await fetchWithBearerToken(
    '/api/organiser/overflow-work',
    {},
    tokenOrGetter,
  )
  const overflowWork = body?.data?.overflowWork
  if (!Array.isArray(overflowWork) || !overflowWork.every(isOverflowWork)) {
    throw new Error('The overflow work response did not match the agreed contract.')
  }
  return overflowWork
}

export async function createOrganiserOverflowWork(input, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    '/api/organiser/overflow-work',
    {
      method: 'POST',
      body: overflowWorkBody(input, {
        sourceRequirementId: input.sourceRequirementId ?? null,
      }),
    },
    tokenOrGetter,
  )
  return overflowWorkArrayFrom(body)
}

export async function updateOrganiserOverflowWork(input, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    `/api/organiser/overflow-work/${input.overflowWorkId}`,
    {
      method: 'PATCH',
      body: overflowWorkBody(input, {
        expectedUpdatedAt: input.expectedUpdatedAt,
      }),
    },
    tokenOrGetter,
  )
  return overflowWorkFrom(body)
}

export async function closeOrganiserOverflowWork(input, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    `/api/organiser/overflow-work/${input.overflowWorkId}/close`,
    {
      method: 'PATCH',
      body: JSON.stringify({ expectedUpdatedAt: input.expectedUpdatedAt }),
    },
    tokenOrGetter,
  )
  return overflowWorkFrom(body)
}
