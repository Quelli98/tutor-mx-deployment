import { attendanceLabel, sickStyle } from '../components/shared/attendance'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { listOwnTimeSlots } from '../api/availability'
import { fetchTutorDashboard } from '../api/tutorDashboard'
import { ErrorState } from '../components/shared/StatusMessage'
import WeeklySchedule from '../components/shared/WeeklySchedule'
import { sessionLengthText } from '../components/shared/scheduleWeek'

function toSlotEntries(slots) {
  return slots
    .filter((slot) => slot.type === 'BUSY')
    .map((slot) => ({
      ...slot,
      kind: 'slot',
      category: slot.category ?? 'UNAVAILABLE',
    }))
}

function toAllocationEntries(allocations) {
  return allocations
    .filter((allocation) => allocation.status === 'CONFIRMED' && allocation.occurrenceStatus !== 'EXCUSED')
    .map((allocation) => ({
      id: `alloc-${allocation.id}`,
      occurrenceStatus: allocation.occurrenceStatus,
      excusePending: allocation.excusePending,
      startsAt: allocation.startsAt,
      endsAt: allocation.endsAt,
      label: `${allocation.courseCode} – ${allocation.courseName}`,
      recurrence: null,
      recurrenceUntil: null,
      category: 'TUTORING',
      kind: 'allocation',
      allocatedHours: allocation.allocatedHours,
      status: allocation.status,
    }))
}

export default function MyTimetable() {
  const { getAccessTokenSilently } = useAuth0()
  const [status, setStatus] = useState('loading')
  const [slots, setSlots] = useState([])
  const [allocations, setAllocations] = useState([])
  const [refreshFailed, setRefreshFailed] = useState(false)
  const [jumpDate, setJumpDate] = useState('')
  const hasLoadedRef = useRef(false)
  const isMountedRef = useRef(true)

  const load = useCallback(async () => {
    const isRefresh = hasLoadedRef.current
    try {
      const [slotResult, dashboard] = await Promise.all([
        listOwnTimeSlots(getAccessTokenSilently),
        fetchTutorDashboard(getAccessTokenSilently),
      ])
      if (!isMountedRef.current) return
      setSlots(slotResult)
      setAllocations(dashboard.allocations)
      hasLoadedRef.current = true
      setStatus('success')
      setRefreshFailed(false)
    } catch {
      if (!isMountedRef.current) return
      if (isRefresh) {
        setRefreshFailed(true)
      } else {
        setStatus('error')
      }
    }
  }, [getAccessTokenSilently])

  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  const combined = useMemo(() => [
    ...toSlotEntries(slots),
    ...toAllocationEntries(allocations),
  ], [slots, allocations])

  const confirmedCount = allocations.filter((a) => a.status === 'CONFIRMED' && a.occurrenceStatus !== 'EXCUSED').length
  const totalSlots = slots.filter((s) => s.type === 'BUSY').length

  function handleRetry() {
    setStatus('loading')
    load()
  }

  if (status === 'loading') {
    return <p className="status-message loading" role="status">Loading your timetable...</p>
  }

  if (status === 'error') {
    return (
      <main id="main-content" className="dashboard-shell">
        <section className="role-card" role="alert">
          <h1>Timetable unavailable</h1>
          <p>Your timetable could not be loaded right now.</p>
          <button className="primary-button" type="button" onClick={handleRetry}>Retry</button>
        </section>
      </main>
    )
  }

  return (
    <main id="main-content" className="dashboard-shell tutor-workspace">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Tutor workspace</p>
          <h1>My timetable</h1>
          <p className="helper-text">
            Your classes, tutoring sessions and unavailable times in one view.
          </p>
        </div>
        <div className="button-row">
          <label className="timetable-jump" htmlFor="timetable-jump-date">
            <span className="visually-hidden">Jump to week</span>
            <input id="timetable-jump-date" type="date" value={jumpDate}
              onChange={(event) => setJumpDate(event.target.value)} />
          </label>
        </div>
      </header>

      {refreshFailed && (
        <ErrorState
          title="Refresh failed"
          message="Showing your last loaded timetable. Retry to load the latest version."
          onRetry={handleRetry}
        />
      )}

      <section className="role-card" aria-labelledby="timetable-summary-heading">
        <div className="timetable-summary">
          <div>
            <strong>{totalSlots}</strong>
            <span>{totalSlots === 1 ? 'schedule entry' : 'schedule entries'}</span>
          </div>
          <div>
            <strong>{confirmedCount}</strong>
            <span>{confirmedCount === 1 ? 'tutoring session' : 'tutoring sessions'}</span>
          </div>
        </div>
      </section>

      <WeeklySchedule
        slots={combined}
        label="My timetable"
        showLegend
        emptyMessage="Nothing on your timetable yet. Import your classes or add unavailable times to get started."
        initialDate={jumpDate ? new Date(jumpDate + 'T00:00:00') : new Date()}
      />

      {allocations.filter((a) => a.status === 'CONFIRMED' && a.occurrenceStatus !== 'EXCUSED').length > 0 && (
        <section className="role-card" aria-labelledby="tutoring-sessions-heading">
          <h2 id="tutoring-sessions-heading">Tutoring sessions</h2>
          <p className="helper-text">Confirmed allocations from organisers.</p>
          {allocations.filter((a) => a.status === 'CONFIRMED' && a.occurrenceStatus !== 'EXCUSED').length === 0
            ? <p>No confirmed tutoring sessions.</p>
            : <ul className="detail-record-list" aria-label="Confirmed tutoring sessions">
              {allocations
                .filter((a) => a.status === 'CONFIRMED' && a.occurrenceStatus !== 'EXCUSED')
                .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
                .map((allocation) => {
                  const start = new Date(allocation.startsAt)
                  const end = new Date(allocation.endsAt)
                  return (
                    <li key={allocation.id} style={allocation.occurrenceStatus === 'SKIPPED' ? sickStyle : undefined}>
                      <strong>{allocation.courseCode} – {allocation.courseName}</strong>
                      {attendanceLabel(allocation) && <span>{attendanceLabel(allocation)}</span>}
                      <span>{start.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                      <span>{start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}–{end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                      <span>{sessionLengthText(start, end)}</span>
                    </li>
                  )
                })}
              </ul>}
        </section>
      )}
    </main>
  )
}
