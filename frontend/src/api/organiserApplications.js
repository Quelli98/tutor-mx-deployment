import { fetchWithBearerToken } from './client'

export async function getOwnOrganiserApplication(tokenOrGetter) {
  const body = await fetchWithBearerToken(
    '/api/auth/organiser-application/me',
    {},
    tokenOrGetter,
  )
  return body?.data?.application ?? null
}

export async function listOrganiserApplications(tokenOrGetter) {
  const body = await fetchWithBearerToken(
    '/api/master-organiser/organiser-applications',
    {},
    tokenOrGetter,
  )
  return Array.isArray(body?.data?.applications) ? body.data.applications : []
}

export async function approveOrganiserApplication(applicationId, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    `/api/master-organiser/organiser-applications/${applicationId}/approve`,
    { method: 'POST' },
    tokenOrGetter,
  )
  return body?.data?.application ?? null
}

export async function rejectOrganiserApplication(applicationId, reviewReason, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    `/api/master-organiser/organiser-applications/${applicationId}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ reviewReason: reviewReason || null }),
    },
    tokenOrGetter,
  )
  return body?.data?.application ?? null
}
