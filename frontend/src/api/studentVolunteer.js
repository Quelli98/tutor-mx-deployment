import { fetchWithBearerToken } from './client'

export async function getVolunteerRequests(tokenOrGetter) {
  const body = await fetchWithBearerToken(
    '/api/student/volunteer-requests',
    {},
    tokenOrGetter,
  )
  const volunteerRequests = body?.data?.volunteerRequests

  if (!Array.isArray(volunteerRequests)) {
    throw new Error('The volunteer-request response did not match the agreed contract.')
  }

  return volunteerRequests
}

export async function volunteerForWork(overflowWorkId, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    '/api/student/volunteer-requests',
    {
      method: 'POST',
      body: JSON.stringify({ overflowWorkId }),
    },
    tokenOrGetter,
  )
  const volunteerRequest = body?.data?.volunteerRequest

  if (
    !volunteerRequest ||
    !Number.isInteger(volunteerRequest.id) ||
    volunteerRequest.overflowWorkId !== overflowWorkId
  ) {
    throw new Error('The volunteer-request response did not match the agreed contract.')
  }

  return volunteerRequest
}

export async function withdrawVolunteerRequest(requestId, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    `/api/student/volunteer-requests/${requestId}/withdraw`,
    { method: 'PATCH' },
    tokenOrGetter,
  )
  const volunteerRequest = body?.data?.volunteerRequest

  if (
    !volunteerRequest ||
    volunteerRequest.id !== requestId ||
    !Number.isInteger(volunteerRequest.overflowWorkId) ||
    volunteerRequest.status !== 'WITHDRAWN'
  ) {
    throw new Error('The volunteer-request response did not match the agreed contract.')
  }

  return volunteerRequest
}
