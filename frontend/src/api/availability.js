import { fetchWithBearerToken } from './client'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const isDate = (value) => typeof value === 'string' && Number.isFinite(new Date(value).valueOf())

export function isTimeSlotSummary(value) {
  return !!value && Number.isInteger(value.id) && value.id > 0 &&
    ['BUSY', 'AVAILABLE'].includes(value.type) &&
    isDate(value.startsAt) && isDate(value.endsAt) &&
    new Date(value.endsAt) > new Date(value.startsAt) &&
    (value.recurrence === null || value.recurrence === 'WEEKLY') &&
    (value.label === null || (typeof value.label === 'string' && value.label.length <= 120)) &&
    (value.recurrenceUntil === null || isDate(value.recurrenceUntil))
}

function slotPayload(input) {
  const duration = new Date(input.endsAt) - new Date(input.startsAt)
  if (
    input.type !== 'BUSY' || !isDate(input.startsAt) || !isDate(input.endsAt) || duration <= 0 ||
    (input.recurrence !== undefined && input.recurrence !== 'WEEKLY') ||
    (input.recurrence === 'WEEKLY' && duration > WEEK_MS) ||
    (input.label != null && (typeof input.label !== 'string' || input.label.length > 120)) ||
    (input.recurrenceUntil != null && (
      input.recurrence !== 'WEEKLY' || !isDate(input.recurrenceUntil) ||
      new Date(input.recurrenceUntil) < new Date(input.startsAt)
    ))
  ) throw new Error('Check the busy time details.')

  return {
    type: 'BUSY', startsAt: input.startsAt, endsAt: input.endsAt,
    ...(input.recurrence === 'WEEKLY' ? { recurrence: 'WEEKLY' } : {}),
    label: input.label ?? null,
    recurrenceUntil: input.recurrenceUntil ?? null,
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
  const body = await fetchWithBearerToken('/api/tutor/time-slots', {}, tokenOrGetter)
  const slots = body?.data?.timeSlots
  if (!Array.isArray(slots) || !slots.every(isTimeSlotSummary)) {
    throw new Error('The availability response did not match the agreed contract.')
  }
  return slots
}

export async function submitTimeSlot(input, tokenOrGetter) {
  const payload = slotPayload(input)
  const body = await fetchWithBearerToken('/api/tutor/time-slots', {
    method: 'POST', body: JSON.stringify(payload),
  }, tokenOrGetter)
  return slotFrom(body)
}

export async function updateOwnTimeSlot(timeSlotId, input, tokenOrGetter) {
  requireSlotId(timeSlotId)
  const payload = slotPayload(input)
  const body = await fetchWithBearerToken(`/api/tutor/time-slots/${timeSlotId}`, {
    method: 'PATCH', body: JSON.stringify(payload),
  }, tokenOrGetter)
  return slotFrom(body)
}

export async function deleteOwnTimeSlot(timeSlotId, tokenOrGetter) {
  requireSlotId(timeSlotId)
  await fetchWithBearerToken(`/api/tutor/time-slots/${timeSlotId}`, { method: 'DELETE' }, tokenOrGetter)
}
