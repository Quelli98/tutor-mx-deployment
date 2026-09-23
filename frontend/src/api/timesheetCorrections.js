import { fetchWithBearerToken } from './client'

const TIMESHEET_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED']
const REVISION_KINDS = ['RETURN', 'CORRECTION']
const DISPUTE_STATUSES = ['OPEN', 'RESOLVED']

function isNullableString(value) {
  return value === null || typeof value === 'string'
}

function isNullableNumber(value) {
  return value === null || Number.isFinite(value)
}

function contractError() {
  return new Error('The timesheet correction response did not match the agreed contract.')
}

function isRevision(revision) {
  return (
    Number.isInteger(revision?.id) &&
    REVISION_KINDS.includes(revision.kind) &&
    isNullableNumber(revision.previousHours) &&
    isNullableNumber(revision.newHours) &&
    isNullableString(revision.previousDescription) &&
    isNullableString(revision.newDescription) &&
    isNullableString(revision.reason) &&
    typeof revision.createdAt === 'string'
  )
}

function isDispute(dispute) {
  return (
    Number.isInteger(dispute?.id) &&
    typeof dispute.reason === 'string' &&
    DISPUTE_STATUSES.includes(dispute.status) &&
    typeof dispute.createdAt === 'string' &&
    isNullableString(dispute.resolutionReason) &&
    isNullableString(dispute.resolvedAt)
  )
}

/**
 * The single read the timeline is built from: the sheet, its work logs, every
 * return and correction, each declaration and any dispute. Validating it here
 * keeps a half-understood payload from reaching the tutor as a broken screen.
 */
export function parseTimesheetHistory(body) {
  const history = body?.data?.history
  const timesheet = history?.timesheet
  const declaration = history?.declaration

  if (
    !timesheet ||
    !Number.isInteger(timesheet.id) ||
    typeof timesheet.weekStart !== 'string' ||
    !TIMESHEET_STATUSES.includes(timesheet.status) ||
    typeof timesheet.editable !== 'boolean' ||
    !Number.isFinite(timesheet.totalHours) ||
    !isNullableString(timesheet.submittedAt) ||
    !isNullableString(timesheet.reviewedAt) ||
    !isNullableString(timesheet.reviewReason) ||
    !Array.isArray(history.workLogs) ||
    !Array.isArray(history.revisions) ||
    !Array.isArray(history.declarations) ||
    !Array.isArray(history.disputes) ||
    !declaration ||
    typeof declaration.statementVersion !== 'string' ||
    typeof declaration.statement !== 'string'
  ) {
    throw contractError()
  }

  if (!history.revisions.every(isRevision) || !history.disputes.every(isDispute)) {
    throw contractError()
  }

  return history
}

export async function fetchTimesheetHistory(timesheetId, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    `/api/tutor/timesheets/${timesheetId}/history`,
    {},
    tokenOrGetter,
  )
  return parseTimesheetHistory(body)
}

/**
 * Corrects one logged session. The figures being replaced travel back in the
 * response so the caller can show what changed without a second read.
 */
export async function correctTimesheetWorkLog(timesheetId, workLogId, input, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    `/api/tutor/timesheets/${timesheetId}/work-logs/${workLogId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
    tokenOrGetter,
  )
  const workLog = body?.data?.workLog
  const revision = body?.data?.revision

  if (!workLog || !Number.isInteger(workLog.id) || !isRevision(revision)) {
    throw contractError()
  }

  return { workLog, revision }
}

export async function declareTimesheet(timesheetId, statementVersion, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    `/api/tutor/timesheets/${timesheetId}/declaration`,
    {
      method: 'POST',
      body: JSON.stringify({ statementVersion }),
    },
    tokenOrGetter,
  )
  const declaration = body?.data?.declaration

  if (
    !declaration ||
    !Number.isInteger(declaration.id) ||
    typeof declaration.statementVersion !== 'string' ||
    typeof declaration.declaredAt !== 'string'
  ) {
    throw contractError()
  }

  return declaration
}

export async function raiseTimesheetDispute(timesheetId, reason, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    `/api/tutor/timesheets/${timesheetId}/disputes`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
    tokenOrGetter,
  )
  const dispute = body?.data?.dispute

  if (!isDispute(dispute) || dispute.status !== 'OPEN') {
    throw contractError()
  }

  return dispute
}
