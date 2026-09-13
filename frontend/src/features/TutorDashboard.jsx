import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { fetchTutorDashboard } from '../api/tutorDashboard'
import { ErrorState } from '../components/shared/StatusMessage'

function formatSessionDate(startsAt, endsAt) {
  const start = new Date(startsAt)
  const end = new Date(endsAt)
  return `${start.toLocaleDateString()} ${start.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

export default function TutorDashboard() {
  const { getAccessTokenSilently } = useAuth0()
  const [status, setStatus] = useState('loading')
  const [data, setData] = useState(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const hasDataRef = useRef(false)
  const isMountedRef = useRef(true)
  const refreshInFlightRef = useRef(false)

  // One load path serves the first load, the error retry and later refreshes.
  // A refresh of already-loaded data keeps the last safe dashboard on screen;
  // only a load that never produced data falls back to the full error state.
  const loadDashboard = useCallback(async () => {
    const isRefresh = hasDataRef.current
    try {
      const result = await fetchTutorDashboard(getAccessTokenSilently)
      if (!isMountedRef.current) return
      hasDataRef.current = true
      setData(result)
      setStatus('success')
      setRefreshFailed(false)
    } catch {
      if (!isMountedRef.current) return
      if (isRefresh) {
        setRefreshFailed(true)
      } else {
        setStatus('error')
      }
    } finally {
      if (isMountedRef.current && isRefresh) {
        setIsRefreshing(false)
      }
    }
  }, [getAccessTokenSilently])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDashboard()
  }, [loadDashboard])

  // Manual and focus-driven refresh entry point. The guard keeps overlapping
  // refreshes (double clicks, focus while refreshing) from stacking requests.
  const refreshDashboard = useCallback(() => {
    if (!hasDataRef.current || refreshInFlightRef.current) return
    refreshInFlightRef.current = true
    setIsRefreshing(true)
    setRefreshFailed(false)
    loadDashboard().finally(() => {
      refreshInFlightRef.current = false
    })
  }, [loadDashboard])

  useEffect(() => {
    // Allocation changes made by an organiser surface without a manual
    // reload: refetch quietly whenever the tutor returns to the Tutor Mx tab.
    const handleWindowFocus = () => refreshDashboard()
    window.addEventListener('focus', handleWindowFocus)
    return () => {
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [refreshDashboard])

  function handleInitialRetry() {
    setStatus('loading')
    loadDashboard()
  }

  if (status === 'loading') {
    return <p className="status-message loading" role="status">Loading your dashboard...</p>
  }

  if (status === 'error') {
    return (
      <main id="main-content" className="dashboard-shell">
        <section className="role-card" role="alert">
          <h1>Dashboard unavailable</h1>
          <p>We could not load your dashboard right now.</p>
          <button className="primary-button" type="button" onClick={handleInitialRetry}>
            Retry
          </button>
        </section>
      </main>
    )
  }

  const { allocations, weeklyLimit, usedHours, remainingHours } = data

  return (
    <main id="main-content" className="dashboard-shell tutor-workspace">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Tutor Mx</p>
          <h1>Your Tutor Dashboard</h1>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={refreshDashboard}
          disabled={isRefreshing}
        >
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      {refreshFailed && (
        <ErrorState
          title="Refresh failed"
          message="Showing your last loaded dashboard. Retry to load your latest assignments and hours."
          onRetry={refreshDashboard}
        />
      )}

      {isRefreshing && (
        <p className="status-message loading" role="status">
          Refreshing your assignments...
        </p>
      )}

      <section className="role-card hours-summary" aria-labelledby="weekly-hours-heading">
        <h2 id="weekly-hours-heading">Weekly hours</h2>
        {weeklyLimit === null || remainingHours === null ? (
          <>
            <p><strong>Weekly hour limit not set yet</strong></p>
            <p className="helper-text">
              {usedHours > 0
                ? `${usedHours} hours are currently allocated this week.`
                : 'You can still use your tutor workspace. Your weekly limit can be configured later.'}
            </p>
          </>
        ) : (
          <>
            <p>
              <strong>{remainingHours} of {weeklyLimit} hours remaining</strong>
            </p>
            <p className="helper-text">{usedHours} hours are currently allocated this week.</p>
          </>
        )}
      </section>

      <section className="role-card" aria-labelledby="assigned-sessions-heading">
        <h2 id="assigned-sessions-heading">Assigned sessions</h2>
        {allocations.length === 0 ? (
          <p>You have no work assigned right now.</p>
        ) : (
          <div className="table-scroll" tabIndex="0" aria-label="Assigned sessions table">
            <table className="tutor-table">
              <caption>Your own proposed and confirmed work</caption>
              <thead>
                <tr>
                  <th scope="col">Course and session</th>
                  <th scope="col">Date and time</th>
                  <th scope="col">Expected hours</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {allocations.map((allocation) => (
                  <tr key={allocation.id}>
                    <td>{allocation.courseCode} - {allocation.courseName}</td>
                    <td>{formatSessionDate(allocation.startsAt, allocation.endsAt)}</td>
                    <td>{allocation.allocatedHours}h</td>
                    <td>{allocation.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
