import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { listTutors } from '../api/organiser'
import { EmptyState, ErrorState, LoadingState } from '../components/shared/StatusMessage'
import TutorAllocationDetails from './TutorAllocationDetails'
import { addDays, localMonday, weekRangeLabel } from '../components/shared/scheduleWeek'
import { initials } from './organiserHome'
import { photoAt } from '../components/organiser/coverPhotos'
import { OrganiserIcon } from '../components/organiser/OrganiserIcon'

const AVATAR_ACCENTS = ['blue', 'pink', 'orchid', 'coral']

const CAPACITY_TEXT = {
  available: 'Available for more work',
  'near-limit': 'Near weekly capacity',
  'limit-reached': 'Weekly capacity reached',
  'not-set': 'Weekly capacity not set',
}

function safeErrorMessage(error) {
  if (error?.code === 'PROFILE_NOT_FOUND') {
    return 'We could not find your organiser profile. Ask an administrator to check your account.'
  }
  if (error?.code === 'ROLE_MISMATCH') return 'Your account does not have organiser access.'
  return 'Unable to load tutors. Please try again.'
}

function toIsoDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export default function TutorManagement() {
  const { getAccessTokenSilently } = useAuth0()
  const { tutorId } = useParams()
  const [status, setStatus] = useState('loading')
  const [tutors, setTutors] = useState([])
  const [errorMessage, setErrorMessage] = useState('')
  const [searchText, setSearchText] = useState('')
  const [detailsTutor, setDetailsTutor] = useState(null)
  const [selectedMonday, setSelectedMonday] = useState(() => localMonday(new Date()))

  const weekStartIso = toIsoDate(selectedMonday)
  const isCurrentWeek = localMonday(new Date()).valueOf() === selectedMonday.valueOf()

  function handleGoToDate(event) {
    const value = event.target.value
    if (!value) return
    const chosen = new Date(`${value}T00:00:00`)
    if (Number.isNaN(chosen.getTime())) return
    setSelectedMonday(localMonday(chosen))
  }

  const loadTutors = useCallback(async (isActive = () => true) => {
    setStatus('loading')
    setErrorMessage('')
    try {
      const result = await listTutors(getAccessTokenSilently, weekStartIso)
      if (!isActive()) return
      setTutors(result)
      setStatus('success')
    } catch (error) {
      if (!isActive()) return
      setTutors([])
      setErrorMessage(safeErrorMessage(error))
      setStatus('error')
    }
  }, [getAccessTokenSilently, weekStartIso])

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTutors(() => active)
    return () => { active = false }
  }, [loadTutors])

  // A link from the command centre names the tutor it was about. This screen is
  // what carries a tutor's week, so the details open once that week has been
  // read, and only once, so closing them leaves them closed.
  const deepLinkOpened = useRef(false)
  useEffect(() => {
    if (deepLinkOpened.current || !tutorId || status !== 'success') return
    const match = tutors.find((tutor) => String(tutor.id) === String(tutorId))
    if (!match) return
    deepLinkOpened.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetailsTutor(match)
  }, [status, tutorId, tutors])

  const filteredTutors = useMemo(() => {
    const query = searchText.trim().toLowerCase()
    return tutors.filter((tutor) =>
      (tutor.fullName ?? '').toLowerCase().includes(query) || tutor.email.toLowerCase().includes(query),
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
        <ul className="tutor-summary" aria-label="This week's tutors at a glance">
          {[
            ['Tutors', tutors.length, 'users', 'blue'],
            ['Available', tutors.filter((tutor) => tutor.capacityStatus === 'available').length, 'check', 'pink'],
            ['Near or at their limit', tutors.filter((tutor) => ['near-limit', 'limit-reached'].includes(tutor.capacityStatus)).length, 'clock', 'coral'],
            ['Limit not set yet', tutors.filter((tutor) => tutor.capacityStatus === 'not-set').length, 'settings', 'orchid'],
          ].map(([label, count, icon, accent]) => (
            <li className={`tutor-summary-tile accent-${accent}`} key={label}>
              <span className="card-title-icon"><OrganiserIcon name={icon} size={18} /></span>
              <span className="tutor-summary-label">{label}</span>
              <strong className="tutor-summary-count">{count}</strong>
            </li>
          ))}
        </ul>
      )}
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
          <div className="calendar-toolbar">
            <div>
              <strong>{isCurrentWeek ? 'This week' : 'Selected week'}</strong>
              <span>{weekRangeLabel(selectedMonday)}</span>
            </div>
            <div className="button-row">
              <button className="secondary-button" type="button" onClick={() => setSelectedMonday(addDays(selectedMonday, -7))}>Previous week</button>
              <button className="secondary-button" type="button" onClick={() => setSelectedMonday(localMonday(new Date()))}>This week</button>
              <button className="secondary-button" type="button" onClick={() => setSelectedMonday(addDays(selectedMonday, 7))}>Next week</button>
              <label className="week-date-picker">
                <span>Go to week</span>
                <input type="date" value={weekStartIso} onChange={handleGoToDate} aria-label="Go to week" />
              </label>
            </div>
          </div>
          {filteredTutors.length === 0 ? <p className="empty-inline" role="status">No tutors found.</p> : (
            <div className="tutor-workload-grid">
              {filteredTutors.map((tutor, index) => (
                <article className={`tutor-workload-card capacity-card-${tutor.capacityStatus} accent-${AVATAR_ACCENTS[index % AVATAR_ACCENTS.length]}`} key={tutor.id} aria-labelledby={`tutor-${tutor.id}`}>
                  <span className="tutor-card-cover" style={{ backgroundImage: `url(${photoAt(index)})` }} aria-hidden="true" />
                  <div className="tutor-card-head">
                    <span className="tutor-avatar" aria-hidden="true">
                      {initials(tutor.fullName?.trim() || tutor.email)}
                    </span>
                    <div>
                      <h3 id={`tutor-${tutor.id}`}>{tutor.fullName?.trim() || tutor.email}</h3>
                      {tutor.fullName?.trim() && tutor.fullName.trim() !== tutor.email && <p>{tutor.email}</p>}
                    </div>
                  </div>
                  {/* How full the week is; the figures below say the same in words. */}
                  <div className="tutor-card-usage-row" aria-hidden="true">
                    <span className="tutor-card-usage">
                      <span style={{ width: `${tutor.weeklyHours ? Math.min(1, tutor.usedHours / tutor.weeklyHours) * 100 : 0}%` }} />
                    </span>
                    <span className="tutor-card-usage-label">
                      {tutor.weeklyHours ? `${Math.round(Math.min(1, tutor.usedHours / tutor.weeklyHours) * 100)}% booked` : 'No limit'}
                    </span>
                  </div>
                  <dl className="workload-facts">
                    <div className="fact-capacity"><dt>Weekly capacity</dt><dd className={tutor.weeklyHours == null ? 'not-set' : undefined}>{tutor.weeklyHours == null ? 'Not set — setup incomplete' : `${tutor.weeklyHours} h`}</dd></div>
                    <div className="fact-allocated"><dt>Allocated</dt><dd>{tutor.usedHours} h</dd></div>
                    <div className="fact-remaining"><dt>Remaining</dt><dd className={tutor.remainingHours == null ? 'not-set' : undefined}>{tutor.remainingHours == null ? 'Not set' : `${tutor.remainingHours} h`}</dd></div>
                    <div className="fact-worked"><dt>Worked this week</dt><dd>{tutor.workedHours} h</dd></div>
                    <div className="workload-status"><dt>Status</dt><dd className={`capacity-status capacity-${tutor.capacityStatus}`}>{CAPACITY_TEXT[tutor.capacityStatus]}</dd></div>
                  </dl>
                  <button className="secondary-button" type="button" onClick={() => setDetailsTutor(tutor)}
                    aria-label={`Manage marks and view schedule for ${tutor.fullName?.trim() || tutor.email}`}>Marks & schedule</button>
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
