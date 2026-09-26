import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { fetchTutorDashboard } from '../api/tutorDashboard'
import AvailabilityForm from './AvailabilityForm'
import TimetableImport from './TimetableImport'
import WorkLogForm from './WorkLogForm'
import ExcuseForm from './ExcuseForm'

export default function TutorForms() {
  const { getAccessTokenSilently, user } = useAuth0()
  const [status, setStatus] = useState('loading')
  const [allocations, setAllocations] = useState([])
  // Bumped when an import lands, so the schedule list above reloads and shows the
  // newly imported entries alongside the hand-entered ones.
  const [scheduleVersion, setScheduleVersion] = useState(0)
  const [activeTab, setActiveTab] = useState('manual')

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
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Tutor workspace</p>
          <h1>Forms and submissions</h1>
          <p className="helper-text">Manage your busy schedule, log completed work and submit excuses.</p>
        </div>
      </header>
      <section className="role-card tutor-form-card" aria-labelledby="add-to-timetable-heading">
        <div>
          <h2 id="add-to-timetable-heading">Add to my timetable</h2>
          <p className="helper-text">
            Import your classes from a file or add them manually. Both methods update the same calendar and block allocations during those times.
          </p>
        </div>
        <div className="timetable-tabs" role="tablist" aria-label="Timetable entry methods">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'manual'}
            aria-controls="tab-panel-manual"
            id="tab-manual"
            className={`timetable-tab-button${activeTab === 'manual' ? ' active' : ''}`}
            onClick={() => setActiveTab('manual')}
          >
            Add manually
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'import'}
            aria-controls="tab-panel-import"
            id="tab-import"
            className={`timetable-tab-button${activeTab === 'import' ? ' active' : ''}`}
            onClick={() => setActiveTab('import')}
          >
            Import timetable
          </button>
        </div>
        <div
          role="tabpanel"
          id="tab-panel-manual"
          aria-labelledby="tab-manual"
          className={`timetable-tab-panel${activeTab === 'manual' ? ' active' : ''}`}
        >
          <AvailabilityForm key={`schedule-${scheduleVersion}`} tokenOrGetter={getAccessTokenSilently} />
        </div>
        <div
          role="tabpanel"
          id="tab-panel-import"
          aria-labelledby="tab-import"
          className={`timetable-tab-panel${activeTab === 'import' ? ' active' : ''}`}
        >
          <TimetableImport
            key={`import-${activeTab}-${scheduleVersion}`}
            tokenOrGetter={getAccessTokenSilently}
            onImported={() => setScheduleVersion((current) => current + 1)}
          />
        </div>
      </section>
      <div className="tutor-form-grid">
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
