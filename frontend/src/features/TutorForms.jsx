import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { fetchTutorDashboard } from '../api/tutorDashboard'
import AvailabilityForm from './AvailabilityForm'
import WorkLogForm from './WorkLogForm'
import ExcuseForm from './ExcuseForm'

export default function TutorForms() {
  const { getAccessTokenSilently, user } = useAuth0()
  const [status, setStatus] = useState('loading')
  const [allocations, setAllocations] = useState([])

  const loadSessions = useCallback(async () => {
    setStatus('loading')
    try {
      const dashboard = await fetchTutorDashboard(getAccessTokenSilently)
      setAllocations(dashboard.allocations)
      setStatus('success')
    } catch {
      setAllocations([])
      setStatus('error')
    }
  }, [getAccessTokenSilently])

  useEffect(() => {
    let active = true
    fetchTutorDashboard(getAccessTokenSilently)
      .then((dashboard) => {
        if (!active) return
        setAllocations(dashboard.allocations)
        setStatus('success')
      })
      .catch(() => {
        if (!active) return
        setAllocations([])
        setStatus('error')
      })
    return () => {
      active = false
    }
  }, [getAccessTokenSilently])

  const confirmedAllocations = useMemo(
    () => allocations.filter((allocation) => allocation.status === 'CONFIRMED'),
    [allocations],
  )
  const futureConfirmedAllocations = useMemo(
    () => confirmedAllocations.filter((allocation) => new Date(allocation.startsAt) > new Date()),
    [confirmedAllocations],
  )
  const storageScope = user?.sub ?? null

  if (status === 'loading') {
    return <p className="status-message loading" role="status">Loading your assigned sessions...</p>
  }

  if (status === 'error') {
    return (
      <main id="main-content" className="dashboard-shell">
        <section className="role-card" role="alert">
          <h1>Tutor forms unavailable</h1>
          <p>Your assigned sessions could not be loaded safely.</p>
          <button className="primary-button" type="button" onClick={loadSessions}>Retry</button>
        </section>
      </main>
    )
  }

  return (
    <main id="main-content" className="dashboard-shell tutor-workspace">
      <header>
        <p className="eyebrow">Tutor Mx</p>
        <h1>Availability, Work Log and Excuses</h1>
      </header>
      <div className="tutor-form-grid">
        <AvailabilityForm tokenOrGetter={getAccessTokenSilently} />
        <WorkLogForm
          key={`work-log-${storageScope ?? 'unknown'}`}
          allocations={confirmedAllocations}
          tokenOrGetter={getAccessTokenSilently}
          storageScope={storageScope}
        />
        <ExcuseForm
          key={`excuse-${storageScope ?? 'unknown'}`}
          allocations={futureConfirmedAllocations}
          tokenOrGetter={getAccessTokenSilently}
          storageScope={storageScope}
        />
      </div>
    </main>
  )
}
