import { withRetryKey } from './retryKey'
import { fetchWithBearerToken } from './client'

const SOURCES = ['CSV', 'ICS']
const MAX_TEXT_LENGTH = 30_000

function isDateOnly(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function isAcademicTermSummary(value) {
  return !!value && Number.isInteger(value.id) && value.id > 0 &&
    typeof value.name === 'string' && value.name.trim().length > 0 &&
    isDateOnly(value.startsOn) && isDateOnly(value.endsOn) &&
    value.endsOn >= value.startsOn
}

export function isImportRow(value) {
  return !!value && Number.isInteger(value.sourceRow) && value.sourceRow > 0 &&
    ['WEEKLY', 'FORTNIGHTLY', 'ONCE'].includes(value.recurrence) &&
    typeof value.duplicate === 'boolean' &&
    Array.isArray(value.errors) && value.errors.every((item) => typeof item === 'string') &&
    (value.label == null || typeof value.label === 'string')
}

/**
 * Builds the request using the timetable's configured zone, unless the caller
 * supplies an explicit zone for the imported source.
 */
export function buildImportRequest({ source, text, termId, timeZone }) {
  if (!SOURCES.includes(source)) throw new Error('Choose a CSV/pasted timetable or a calendar file.')
  if (typeof text !== 'string' || text.trim().length === 0) throw new Error('Paste or choose a timetable first.')
  if (text.length > MAX_TEXT_LENGTH) throw new Error('That timetable is too large to import.')
  if (termId != null && (!Number.isInteger(termId) || termId <= 0)) throw new Error('Choose the academic term this timetable belongs to.')
  const zone = timeZone || currentTimeZone()
  if (typeof zone !== 'string' || zone.length === 0) throw new Error('A time zone is required to place the entries.')

  return { source, text, timeZone: zone, ...(termId != null ? { termId } : {}) }
}

export function currentTimeZone() {
  return 'Africa/Johannesburg'
}

function previewFrom(body) {
  const preview = body?.data?.preview
  if (
    !preview || !SOURCES.includes(preview.source) ||
    typeof preview.validCount !== 'number' ||
    typeof preview.invalidCount !== 'number' ||
    typeof preview.duplicateCount !== 'number' ||
    !isAcademicTermSummary(preview.term) ||
    !Array.isArray(preview.rows) || !preview.rows.every(isImportRow)
  ) {
    throw new Error('The timetable preview did not match the agreed contract.')
  }
  return preview
}

function commitFrom(body) {
  const result = body?.data?.result
  if (
    !result || typeof result.created !== 'number' ||
    !Array.isArray(result.createdIds) ||
    !Array.isArray(result.skipped) ||
    typeof result.invalidCount !== 'number' ||
    typeof result.duplicateCount !== 'number'
  ) {
    throw new Error('The import result did not match the agreed contract.')
  }
  return result
}

export async function listAcademicTerms(tokenOrGetter) {
  const body = await fetchWithBearerToken('/api/academic-terms', {}, tokenOrGetter)
  const terms = body?.data?.academicTerms
  if (!Array.isArray(terms) || !terms.every(isAcademicTermSummary)) {
    throw new Error('The academic term response did not match the agreed contract.')
  }
  return terms
}

export async function listPublishedAcademicTerms(tokenOrGetter) {
  const body = await fetchWithBearerToken('/api/academic-terms/published', {}, tokenOrGetter)
  const terms = body?.data?.academicTerms
  if (!Array.isArray(terms) || !terms.every(isAcademicTermSummary)) {
    throw new Error('The academic term response did not match the agreed contract.')
  }
  return terms
}

export async function createAcademicTerm(input, tokenOrGetter) {
  const body = await fetchWithBearerToken('/api/organiser/academic-terms', {
    method: 'POST', body: JSON.stringify(input),
  }, tokenOrGetter)
  const term = body?.data?.academicTerm
  if (!isAcademicTermSummary(term)) {
    throw new Error('The academic term response did not match the agreed contract.')
  }
  return term
}

export async function updateAcademicTerm(id, input, tokenOrGetter) {
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid term identifier.')
  const body = await fetchWithBearerToken(`/api/organiser/academic-terms/${id}`, {
    method: 'PATCH', body: JSON.stringify(input),
  }, tokenOrGetter)
  const term = body?.data?.academicTerm
  if (!isAcademicTermSummary(term)) {
    throw new Error('The academic term response did not match the agreed contract.')
  }
  return term
}

export async function deleteAcademicTerm(id, tokenOrGetter) {
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid term identifier.')
  await fetchWithBearerToken(`/api/organiser/academic-terms/${id}`, { method: 'DELETE' }, tokenOrGetter)
}

export async function previewTimetableImport(input, tokenOrGetter) {
  const payload = buildImportRequest(input)
  const body = await fetchWithBearerToken('/api/tutor/time-slots/import/preview', {
    method: 'POST', body: JSON.stringify(payload),
  }, tokenOrGetter)
  return previewFrom(body)
}

export async function commitTimetableImport(input, tokenOrGetter) {
  const payload = buildImportRequest(input)
  return withRetryKey('timetable-import', payload, async (key) => {
    const body = await fetchWithBearerToken('/api/tutor/time-slots/import/commit', {
      method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload),
    }, tokenOrGetter)
    return commitFrom(body)
  })
}
