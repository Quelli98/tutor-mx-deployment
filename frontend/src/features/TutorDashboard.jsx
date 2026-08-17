import { useCallback, useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { fetchTutorDashboard } from '../api/tutorDashboard'

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

  const loadDashboard = useCallback(async () => {
    setStatus('loading')
    try {
      const result = await fetchTutorDashboard(getAccessTokenSilently)
      setData(result)
      setStatus('success')
    } catch {
      setData(null)
      setStatus('error')
    }
  }, [getAccessTokenSilently])

  useEffect(() => {
    let active = true
    fetchTutorDashboard(getAccessTokenSilently)
      .then((result) => {
        if (!active) return
        setData(result)
        setStatus('success')
      })
      .catch(() => {
        if (!active) return
        setData(null)
        setStatus('error')
      })
    return () => {
      active = false
    }
  }, [getAccessTokenSilently])

  if (status === 'loading') {
    return <p className="status-message loading" role="status">Loading your dashboard...</p>
  }

  if (status === 'error') {
    return (
      <main id="main-content" className="dashboard-shell">
        <section className="role-card" role="alert">
          <h1>Dashboard unavailable</h1>
          <p>We could not load your dashboard right now.</p>
          <button className="primary-button" type="button" onClick={loadDashboard}>
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
      </header>

      <section className="role-card hours-summary" aria-labelledby="weekly-hours-heading">
        <h2 id="weekly-hours-heading">Weekly hours</h2>
        <p>
          <strong>{remainingHours} of {weeklyLimit} hours remaining</strong>
        </p>
        <p className="helper-text">{usedHours} hours are currently allocated this week.</p>
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
