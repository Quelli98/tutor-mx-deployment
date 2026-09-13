import { fetchWithBearerToken } from './client'

const TIMESHEET_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED']

function isNullableString(value) {
  return value === null || typeof value === 'string'
}

export function parseTimesheetResponse(body) {
  const timesheet = body?.data?.timesheet
  if (
    !timesheet ||
    !Number.isInteger(timesheet.id) ||
    typeof timesheet.weekStart !== 'string' ||
    !TIMESHEET_STATUSES.includes(timesheet.status) ||
    !isNullableString(timesheet.submittedAt) ||
    !isNullableString(timesheet.reviewedAt) ||
    (timesheet.reviewReason !== null && typeof timesheet.reviewReason !== 'string') ||
    !Number.isFinite(timesheet.totalHours) ||
    timesheet.totalHours < 0
  ) {
    throw new Error('The timesheet response did not match the agreed contract.')
  }
  return timesheet
}

export async function fetchTimesheetStatus(timesheetId, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    `/api/tutor/timesheets/${timesheetId}/status`,
    {},
    tokenOrGetter,
  )
  return parseTimesheetResponse(body)
}

export async function submitTimesheet(timesheetId, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    `/api/tutor/timesheets/${timesheetId}/submit`,
    { method: 'POST' },
    tokenOrGetter,
  )
  return parseTimesheetResponse(body)
}
