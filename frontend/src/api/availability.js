import { fetchWithBearerToken } from './client'

export async function submitTimeSlot(input, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    '/api/tutor/time-slots',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    tokenOrGetter,
  )
  const timeSlot = body?.data?.timeSlot
  if (!timeSlot || !Number.isInteger(timeSlot.id)) {
    throw new Error('The availability response did not match the agreed contract.')
  }
  return timeSlot
}
