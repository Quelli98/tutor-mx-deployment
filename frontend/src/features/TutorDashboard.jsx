import { attendanceLabel } from '../components/shared/attendance'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { fetchTutorDashboard, isValidWeeklyCapacity, saveWeeklyCapacity } from '../api/tutorDashboard'
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
  const [capacityInput, setCapacityInput] = useState('')
  const [capacityError, setCapacityError] = useState('')
  const [capacitySaving, setCapacitySaving] = useState(false)
  const [capacitySuccess, setCapacitySuccess] = useState('')
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

  async function handleCapacitySave(event) {
    event.preventDefault()
    const value = Number(capacityInput)
    if (!capacityInput.trim() || !isValidWeeklyCapacity(value)) {
      setCapacityError('Enter a valid weekly capacity above 0 and no more than 168 hours.')
      return
    }
    setCapacitySaving(true)
    setCapacityError('')
    setCapacitySuccess('')
    try {
      await saveWeeklyCapacity(value, getAccessTokenSilently)
      setCapacitySuccess('Weekly work capacity updated.')
      setCapacityInput('')
      await loadDashboard()
    } catch {
      setCapacityError('Weekly capacity could not be saved. Please try again.')
    } finally {
      setCapacitySaving(false)
    }
  }

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

  const { allocations, weeklyLimit, usedHours, remainingHours, hasSchedule = false } = data
  const setupItems = [
    ...(weeklyLimit == null ? [{ key: 'capacity', label: 'Set your weekly work capacity', detail: 'Tell organisers how many hours you can work each week.', target: 'weekly-capacity-input' }] : []),
    ...(!hasSchedule ? [{ key: 'schedule', label: 'Add your work preferences', detail: 'Add available and busy times so allocation clash checks are accurate.', to: '/tutor/forms' }] : []),
  ]

  return (
    <main id="main-content" className="dashboard-shell tutor-workspace">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Tutor workspace</p>
          <h1>Tutor dashboard</h1>
          <p className="helper-text">Track your assigned sessions and weekly workload.</p>
        </div>
        <div className="button-row">
          <a className="secondary-button" href="/tutor/timetable">View timetable</a>
          <button
            type="button"
            className="secondary-button"
            onClick={refreshDashboard}
            disabled={isRefreshing}
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
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

      <section className={`role-card tutor-setup-card${setupItems.length === 0 ? ' complete' : ''}`} aria-labelledby="setup-checklist-heading">
        <div className="setup-card-heading">
          <div>
            <p className="eyebrow">Getting started</p>
            <h2 id="setup-checklist-heading">Tutor setup</h2>
          </div>
          <span className="setup-progress" aria-label={`${2 - setupItems.length} of 2 setup tasks complete`}>{2 - setupItems.length}/2 complete</span>
        </div>
        {setupItems.length === 0 ? (
          <p className="setup-complete-message"><strong>You are ready for allocations.</strong> Your capacity and schedule are both set.</p>
        ) : (
          <ul className="setup-checklist">
            {setupItems.map((item) => (
              <li key={item.key}>
                <span className="setup-status" aria-hidden="true">○</span>
                <div><strong>{item.label}</strong><p>{item.detail}</p></div>
                {item.to ? <a className="secondary-button" href={item.to}>Open</a> : <button type="button" className="secondary-button" onClick={() => document.getElementById(item.target)?.focus()}>Set now</button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="role-card hours-summary" aria-labelledby="weekly-hours-heading">
        <h2 id="weekly-hours-heading">Weekly work capacity</h2>
        {weeklyLimit === null || remainingHours === null ? (
          <>
            <p><strong>Weekly work capacity not set</strong></p>
            <p className="helper-text">
              {usedHours > 0
                ? `${usedHours} hours are allocated this week, but your weekly capacity has not been set.`
                : 'Set your weekly work capacity in Work Preferences so organisers can allocate sessions.'}
            </p>
          </>
        ) : (
          <>
            <p>
              <strong>{remainingHours} of {weeklyLimit} hours remaining capacity</strong>
            </p>
            <p className="helper-text">{usedHours} hours are allocated this week.</p>
          </>
        )}
      </section>

      <section className="role-card" aria-labelledby="work-preferences-heading">
        <h2 id="work-preferences-heading">Work preferences</h2>
        <p className="helper-text">
          Set how many hours per week you are available for tutoring work. Organisers will see this when allocating sessions.
        </p>
        <form className="inline-form" onSubmit={handleCapacitySave} noValidate>
          <div className="field-group">
            <label htmlFor="weekly-capacity-input">Weekly work capacity (hours)</label>
            <input
              id="weekly-capacity-input"
              type="number"
              min="0.5"
              max="168"
              step="0.5"
              value={capacityInput}
              onChange={(event) => {
                setCapacityInput(event.target.value)
                setCapacityError('')
                setCapacitySuccess('')
              }}
              disabled={capacitySaving}
              placeholder={data?.weeklyLimit != null ? String(data.weeklyLimit) : 'e.g. 10'}
              aria-invalid={Boolean(capacityError)}
              aria-describedby={capacityError ? 'weekly-capacity-error' : undefined}
            />
            {capacityError && (
              <p id="weekly-capacity-error" className="error-text">
                {capacityError}
              </p>
            )}
          </div>
          <button className="primary-button" type="submit" disabled={capacitySaving}>
            {capacitySaving ? 'Saving...' : 'Save capacity'}
          </button>
        </form>
        {capacitySuccess && (
          <p className="status-note" role="status">
            {capacitySuccess}
          </p>
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
                    <td>
                      <span className={`status-badge status-${attendanceLabel(allocation) || allocation.status.toLowerCase()}`}>
                        {attendanceLabel(allocation) || allocation.status.toLowerCase()}
                      </span>
                    </td>
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
