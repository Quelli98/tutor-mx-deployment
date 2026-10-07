import { API_BASE_URL, fetchWithBearerToken } from './client'

export async function getOwnOrganiserApplication(tokenOrGetter) {
  const body = await fetchWithBearerToken(
    '/api/auth/organiser-application/me',
    {},
    tokenOrGetter,
  )
  return body?.data?.application ?? null
}

export async function checkOrganiserApplicationStatus(email) {
  const response = await fetch(`${API_BASE_URL}/api/auth/organiser-application-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body?.error?.message || 'Organiser application status could not be checked.')
    error.code = body?.error?.code || 'REQUEST_FAILED'
    error.status = response.status
    throw error
  }
  return body?.data?.status ?? 'NOT_FOUND'
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
