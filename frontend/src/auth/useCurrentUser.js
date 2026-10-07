import { SESSION_EVENT, PERMISSION_EVENT, isSessionLocked } from './sessionState'
import { useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { fetchWithBearerToken } from '../api/client'

export function normalizeRole(rawRole) {
  if (rawRole === null || rawRole === undefined || rawRole === '') return null

  const normalized = String(rawRole).trim().toUpperCase()

  if (normalized === 'ORGANIZER' || normalized === 'ORGANISER') {
    return 'ORGANISER'
  }

  if (normalized === 'MENTOR' || normalized === 'TUTOR') {
    return 'TUTOR'
  }

  if (normalized === 'LEARNER' || normalized === 'STUDENT') {
    return 'STUDENT'
  }

  return normalized
}

export function useCurrentUser({ enabled = true } = {}) {
  const { isAuthenticated, getAccessTokenSilently } = useAuth0()

  const [user, setUser] = useState(null)
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState('')

  useEffect(() => {
    if (!isAuthenticated || !enabled) {
      return undefined
    }

    let ignore = false
    let revision = 0
    let locked = false

    async function loadUser() {
      const request = ++revision
      setLoading(true)
      setError('')
      setErrorCode('')

      try {
        const profile = await fetchWithBearerToken(
          '/api/me',
          {},
          getAccessTokenSilently,
        )

        if (ignore || request !== revision) return

        const roleSource =
          profile?.profile?.role ||
          profile?.role ||
          profile?.user?.role ||
          profile?.data?.role ||
          profile?.data?.profile?.role ||
          profile?.data?.user?.role ||
          null

        setUser(profile)
        setRole(normalizeRole(roleSource))
      } catch (err) {
        if (!ignore && request === revision) {
          setUser(null)
          setRole(null)
          setError(err?.message || 'Unable to load user profile')
          setErrorCode(err?.code || 'REQUEST_FAILED')
        }
      } finally {
        if (!ignore && request === revision) {
          setLoading(false)
        }
      }
    }

    function invalidate(event) {
      locked = true
      revision += 1
      setUser(null); setRole(null); setLoading(false)
      setError(event.detail?.message || 'Your session has expired. Please sign in again.')
      setErrorCode('SESSION_EXPIRED')
    }
    function revalidate() { if (locked) return; setUser(null); setRole(null); loadUser() }
    window.addEventListener(SESSION_EVENT, invalidate)
    window.addEventListener(PERMISSION_EVENT, revalidate)
    window.addEventListener('focus', revalidate)
    if (isSessionLocked()) invalidate({ detail: {} })
    else loadUser()

    return () => {
      ignore = true
      window.removeEventListener(SESSION_EVENT, invalidate)
      window.removeEventListener(PERMISSION_EVENT, revalidate)
      window.removeEventListener('focus', revalidate)
    }
  }, [isAuthenticated, enabled, getAccessTokenSilently])

  if (!isAuthenticated || !enabled) {
    return {
      user: null,
      role: null,
      loading: false,
      error: '',
      errorCode: '',
    }
  }

  return {
    user,
    role,
    loading,
    error,
    errorCode,
  }
}