import { fetchWithBearerToken } from './client'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const FORTNIGHT_MS = 14 * 24 * 60 * 60 * 1000
const isDate = (value) => typeof value === 'string' && Number.isFinite(new Date(value).valueOf())

const RECURRENCE_VALUES = ['WEEKLY', 'FORTNIGHTLY', 'ONCE']
const CATEGORY_VALUES = ['CLASS', 'UNAVAILABLE']

export function isTimeSlotSummary(value) {
  return !!value && Number.isInteger(value.id) && value.id > 0 &&
    ['BUSY', 'AVAILABLE'].includes(value.type) &&
    isDate(value.startsAt) && isDate(value.endsAt) &&
    new Date(value.endsAt) > new Date(value.startsAt) &&
    (value.recurrence == null || RECURRENCE_VALUES.includes(value.recurrence)) &&
    (value.label == null || typeof value.label === 'string') &&
    (value.recurrenceUntil == null || isDate(value.recurrenceUntil))
}

function maxDuration(recurrence) {
  if (recurrence === 'FORTNIGHTLY') return FORTNIGHT_MS
  if (recurrence === 'WEEKLY') return WEEK_MS
  return Number.POSITIVE_INFINITY
}

function slotPayload(input) {
  const duration = new Date(input.endsAt) - new Date(input.startsAt)
  const recurrence = input.recurrence === 'FORTNIGHTLY' ? 'FORTNIGHTLY'
    : input.recurrence === 'WEEKLY' ? 'WEEKLY' : null
  const category = CATEGORY_VALUES.includes(input.category) ? input.category : 'UNAVAILABLE'
  if (
    input.type !== 'BUSY' || !isDate(input.startsAt) || !isDate(input.endsAt) || duration <= 0 ||
    (recurrence && duration > maxDuration(recurrence)) ||
    (input.label != null && (typeof input.label !== 'string' || input.label.length > 120)) ||
    (recurrence && input.recurrenceUntil != null && (
      !isDate(input.recurrenceUntil) ||
      new Date(input.recurrenceUntil) < new Date(input.startsAt)
    ))
  ) throw new Error('Check the busy time details.')

  return {
    type: 'BUSY', startsAt: input.startsAt, endsAt: input.endsAt,
    ...(recurrence ? { recurrence } : {}),
    label: input.label ?? null,
    recurrenceUntil: recurrence ? (input.recurrenceUntil ?? null) : null,
    category,
    seriesId: input.seriesId ?? null,
  }
}

function slotFrom(body) {
  const timeSlot = body?.data?.timeSlot
  if (!isTimeSlotSummary(timeSlot) || timeSlot.type !== 'BUSY') {
    throw new Error('The availability response did not match the agreed contract.')
  }
  return timeSlot
}

function requireSlotId(id) {
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid busy time identifier.')
}

export async function listOwnTimeSlots(tokenOrGetter) {
  const body = await fetchWithBearerToken('/api/me/time-slots', {}, tokenOrGetter)
  const slots = body?.data?.timeSlots
  if (!Array.isArray(slots) || !slots.every(isTimeSlotSummary)) {
    throw new Error('The availability response did not match the agreed contract.')
  }
  return slots
}

export async function submitTimeSlot(input, tokenOrGetter) {
  const payload = slotPayload(input)
  const body = await fetchWithBearerToken('/api/me/time-slots', {
    method: 'POST', body: JSON.stringify(payload),
  }, tokenOrGetter)
  return slotFrom(body)
}

export async function updateOwnTimeSlot(timeSlotId, input, tokenOrGetter) {
  requireSlotId(timeSlotId)
  const payload = slotPayload(input)
  const body = await fetchWithBearerToken(`/api/me/time-slots/${timeSlotId}`, {
    method: 'PATCH', body: JSON.stringify(payload),
  }, tokenOrGetter)
  return slotFrom(body)
}

export async function deleteOwnTimeSlot(timeSlotId, tokenOrGetter) {
  requireSlotId(timeSlotId)
  await fetchWithBearerToken(`/api/me/time-slots/${timeSlotId}`, { method: 'DELETE' }, tokenOrGetter)
}

function requireOccurrenceDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Choose the week to change.')
}

function occurrencePath(timeSlotId, occurrenceDate) {
  requireSlotId(timeSlotId)
  requireOccurrenceDate(occurrenceDate)
  return `/api/me/time-slots/${timeSlotId}/exceptions/${occurrenceDate}`
}

/** Skips one week of a repeating entry; resolves to the entry with its exceptions. */
export async function skipOccurrence(timeSlotId, occurrenceDate, tokenOrGetter) {
  const body = await fetchWithBearerToken(occurrencePath(timeSlotId, occurrenceDate), {
    method: 'PUT', body: JSON.stringify({ exceptionType: 'CANCELLED' }),
  }, tokenOrGetter)
  return slotFrom(body)
}

/** Moves one week of a repeating entry to a new time. */
export async function moveOccurrence(timeSlotId, occurrenceDate, { newStartsAt, newEndsAt }, tokenOrGetter) {
  const path = occurrencePath(timeSlotId, occurrenceDate)
  if (!isDate(newStartsAt) || !isDate(newEndsAt) || new Date(newEndsAt) <= new Date(newStartsAt)) {
    throw new Error('The new end time must be after the new start time.')
  }
  const body = await fetchWithBearerToken(path, {
    method: 'PUT', body: JSON.stringify({ exceptionType: 'MOVED', newStartsAt, newEndsAt }),
  }, tokenOrGetter)
  return slotFrom(body)
}

/** Puts one week of a repeating entry back to its usual time. */
export async function restoreOccurrence(timeSlotId, occurrenceDate, tokenOrGetter) {
  const body = await fetchWithBearerToken(occurrencePath(timeSlotId, occurrenceDate), { method: 'DELETE' }, tokenOrGetter)
  return slotFrom(body)
}
