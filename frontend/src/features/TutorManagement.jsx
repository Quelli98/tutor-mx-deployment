import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { listTutors } from '../api/organiser'
import { EmptyState, ErrorState, LoadingState } from '../components/shared/StatusMessage'
import TutorAllocationDetails from './TutorAllocationDetails'

const CAPACITY_TEXT = {
  available: 'Available for more work',
  'near-limit': 'Near weekly limit',
  'limit-reached': 'Weekly limit reached',
  'not-set': 'Weekly limit not set',
}

function safeErrorMessage(error) {
  if (error?.code === 'PROFILE_NOT_FOUND') {
    return 'We could not find your organiser profile. Ask an administrator to check your account.'
  }
  if (error?.code === 'ROLE_MISMATCH') return 'Your account does not have organiser access.'
  return 'Unable to load tutors. Please try again.'
}

function utcDate(value) {
  return new Date(value).toLocaleDateString(undefined, {
    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

export default function TutorManagement() {
  const { getAccessTokenSilently } = useAuth0()
  const [status, setStatus] = useState('loading')
  const [tutors, setTutors] = useState([])
  const [errorMessage, setErrorMessage] = useState('')
  const [searchText, setSearchText] = useState('')
  const [detailsTutor, setDetailsTutor] = useState(null)

  const loadTutors = useCallback(async (isActive = () => true) => {
    setStatus('loading')
    setErrorMessage('')
    try {
      const result = await listTutors(getAccessTokenSilently)
      if (!isActive()) return
      setTutors(result)
      setStatus('success')
    } catch (error) {
      if (!isActive()) return
      setTutors([])
      setErrorMessage(safeErrorMessage(error))
      setStatus('error')
    }
  }, [getAccessTokenSilently])

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTutors(() => active)
    return () => { active = false }
  }, [loadTutors])

  const filteredTutors = useMemo(() => {
    const query = searchText.trim().toLowerCase()
    return tutors.filter((tutor) =>
      tutor.fullName.toLowerCase().includes(query) || tutor.email.toLowerCase().includes(query),
    )
  }, [searchText, tutors])

  return (
    <main id="main-content" className="dashboard-shell">
      <header className="dashboard-header tutor-management-header">
        <div>
          <p className="eyebrow">Organiser workspace</p>
          <h1>Tutor management</h1>
          <p className="helper-text">Search for a tutor by name or email below. Tutors manage their own weekly capacity and schedule. Organisers manage course marks.</p>
        </div>
      </header>
      {status === 'loading' && <LoadingState title="Loading tutors" message="Loading tutor workloads." />}
      {status === 'error' && <ErrorState title="Tutors unavailable" message={errorMessage} onRetry={() => loadTutors()} />}
      {status === 'success' && tutors.length === 0 && <EmptyState title="No tutors available" message="Tutor accounts will appear here after registration." />}
      {status === 'success' && tutors.length > 0 && (
        <section className="role-card tutor-list-card" aria-labelledby="tutor-list-heading">
          <div className="tutor-list-header">
            <div>
              <h2 id="tutor-list-heading">Tutors</h2>
              <p className="tutor-list-meta">{tutors.length} {tutors.length === 1 ? 'tutor' : 'tutors'}</p>
            </div>
            <div className="field-group tutor-search-field">
              <label htmlFor="tutor-search">Search tutors</label>
              <input id="tutor-search" type="search" value={searchText}
                onChange={(event) => setSearchText(event.target.value)} placeholder="Name or email" />
            </div>
          </div>
          <p className="helper-text">Worked hours are recorded worklogs, not necessarily approved. All workload figures and capacity statuses are supplied by the server.</p>
          {filteredTutors.length === 0 ? <p className="empty-inline" role="status">No tutors found.</p> : (
            <div className="tutor-workload-grid">
              {filteredTutors.map((tutor) => (
                <article className="tutor-workload-card" key={tutor.id} aria-labelledby={`tutor-${tutor.id}`}>
                  <div>
                    <h3 id={`tutor-${tutor.id}`}>{tutor.fullName}</h3>
                    <p>{tutor.email}</p>
                  </div>
                  <span className={`capacity-status capacity-${tutor.capacityStatus}`}>{CAPACITY_TEXT[tutor.capacityStatus]}</span>
                  <p className="workload-period">UTC Monday week: {utcDate(tutor.weekStart)} to {utcDate(tutor.weekEnd)}</p>
                  <dl className="workload-facts">
                    <div><dt>Weekly limit</dt><dd>{tutor.weeklyHours == null ? 'Not set' : `${tutor.weeklyHours} h/week`}</dd></div>
                    <div><dt>Currently allocated this week</dt><dd>{tutor.usedHours} h</dd></div>
                    <div><dt>Remaining capacity</dt><dd>{tutor.remainingHours == null ? 'Not set' : `${tutor.remainingHours} h`}</dd></div>
                    <div><dt>Worked this week</dt><dd>{tutor.workedHours} h</dd></div>
                  </dl>
                  <button className="secondary-button" type="button" onClick={() => setDetailsTutor(tutor)}
                    aria-label={`Manage marks and view schedule for ${tutor.fullName}`}>Marks & schedule</button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {detailsTutor && <TutorAllocationDetails key={detailsTutor.id} tutor={detailsTutor} onClose={() => setDetailsTutor(null)} />}
    </main>
  )
}
