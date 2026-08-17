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

    async function loadUser() {
      setLoading(true)
      setError('')
      setErrorCode('')

      try {
        const profile = await fetchWithBearerToken(
          '/api/me',
          {},
          getAccessTokenSilently,
        )

        if (ignore) return

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
        if (!ignore) {
          setUser(null)
          setRole(null)
          setError(err?.message || 'Unable to load user profile')
          setErrorCode(err?.code || 'REQUEST_FAILED')
        }
      } finally {
        if (!ignore) {
          setLoading(false)
        }
      }
    }

    loadUser()

    return () => {
      ignore = true
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