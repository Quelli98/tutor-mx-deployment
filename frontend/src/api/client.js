import { useCallback } from 'react'
import { useAuth0 } from '@auth0/auth0-react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

async function readJson(response) {
  return response.json().catch(() => ({}))
}

function messageFrom(body, fallback) {
  return body?.error?.message || fallback
}

export async function fetchWithBearerToken(path, options = {}, tokenOrGetter) {
  const token =
    typeof tokenOrGetter === 'function'
      ? await tokenOrGetter({
          detailedResponse: false,
          authorizationParams: { audience: import.meta.env.VITE_AUTH0_AUDIENCE },
        })
      : tokenOrGetter

  if (!token) throw new Error('Missing bearer token')

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  })
  const body = await readJson(response)

  if (!response.ok) {
    const error = new Error(messageFrom(body, 'Request failed'))
    error.code = body?.error?.code || 'REQUEST_FAILED'
    error.status = response.status
    throw error
  }

  return body
}

export async function requestPasswordReset(email) {
  const response = await fetch(`${API_BASE_URL}/api/auth/password-reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  const body = await readJson(response)

  if (!response.ok) {
    throw new Error(messageFrom(body, 'Password reset could not be requested.'))
  }

  return body
}

export function useApiClient() {
  const { getAccessTokenSilently } = useAuth0()

  return useCallback(
    (path, options = {}) =>
      fetchWithBearerToken(path, options, getAccessTokenSilently),
    [getAccessTokenSilently],
  )
}
