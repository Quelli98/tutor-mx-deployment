import { handleAccessFailure, invalidateSession, sessionGeneration } from '../auth/sessionState'
import { useCallback } from 'react'
import { useAuth0 } from '@auth0/auth0-react'

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')

async function readJson(response) {
  return response.json().catch(() => ({}))
}

function messageFrom(body, fallback) {
  return body?.error?.message || fallback
}

export async function fetchResponseWithBearerToken(path, options = {}, tokenOrGetter) {
  const generation = sessionGeneration()
  let token
  try { token =
    typeof tokenOrGetter === 'function'
      ? await tokenOrGetter({
          detailedResponse: false,
          authorizationParams: { audience: import.meta.env.VITE_AUTH0_AUDIENCE },
        })
      : tokenOrGetter
  } catch (error) {
    if (['login_required', 'invalid_grant', 'consent_required', 'interaction_required', 'missing_refresh_token'].includes(error?.error)) invalidateSession()
    throw error
  }

  if (!token) { invalidateSession(); throw new Error('Missing bearer token') }
  if (generation !== sessionGeneration()) throw new Error('Session changed. Please retry.')

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    cache: 'no-store',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  })
  if (!response.ok) {
    const body = await readJson(response)
    const error = new Error(messageFrom(body, 'Request failed'))
    error.code = body?.error?.code || 'REQUEST_FAILED'
    error.status = response.status
    handleAccessFailure(response.status, error.code, path)
    throw error
  }

  if (generation !== sessionGeneration()) throw new Error('Session changed. Please retry.')
  return response
}

export async function fetchWithBearerToken(path, options = {}, tokenOrGetter) {
  const generation = sessionGeneration()
  const body = await readJson(await fetchResponseWithBearerToken(path, options, tokenOrGetter))
  if (generation !== sessionGeneration()) throw new Error('Session changed. Please retry.')
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

export function useApiToken() {
  const { getAccessTokenSilently } = useAuth0()
  return getAccessTokenSilently
}

export function useApiClient() {
  const { getAccessTokenSilently } = useAuth0()

  return useCallback(
    (path, options = {}) =>
      fetchWithBearerToken(path, options, getAccessTokenSilently),
    [getAccessTokenSilently],
  )
}
