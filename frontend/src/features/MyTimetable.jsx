import BookingPanel from './BookingPanel'
import { listBookings } from '../api/scheduling'
import { localMonday } from '../components/shared/scheduleWeek'
import ScheduleEntryPanel from './ScheduleEntryPanel'
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

export default function MyTimetable({ role = 'TUTOR', bookingId }) {
  const { getAccessTokenSilently, user } = useAuth0()
  const [status, setStatus] = useState('loading')
  const [slots, setSlots] = useState([])
  const [allocations, setAllocations] = useState([])
  const [bookings, setBookings] = useState([])
  const [bookingWeek, setBookingWeek] = useState(() => localMonday(new Date()).valueOf())
  const onWeekChange = useCallback(date => setBookingWeek(date.valueOf()), [])
  const [refreshFailed, setRefreshFailed] = useState(false)
  const [jumpDate, setJumpDate] = useState('')
  const loadSequence = useRef(0)
  const hasLoadedRef = useRef(false)
  const isMountedRef = useRef(true)

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    const isRefresh = hasLoadedRef.current
    try {
      const [slotResult, dashboard, bookingResult] = await Promise.all([
        listOwnTimeSlots(getAccessTokenSilently),
        role === 'TUTOR' ? fetchTutorDashboard(getAccessTokenSilently) : Promise.resolve({ allocations: [] }),
        listBookings({ startsAt: new Date(bookingWeek).toISOString(), endsAt: new Date(bookingWeek + 7 * 86400000).toISOString() }, getAccessTokenSilently),
      ])
      if (!isMountedRef.current || sequence !== loadSequence.current) return
      setSlots(slotResult)
      setAllocations(dashboard.allocations)
      setBookings(bookingResult.items)
      hasLoadedRef.current = true
      setStatus('success')
      setRefreshFailed(false)
    } catch {
      if (!isMountedRef.current || sequence !== loadSequence.current) return
      if (isRefresh) {
        setRefreshFailed(true)
      } else {
        setStatus('error')
      }
    }
  }, [getAccessTokenSilently, role, bookingWeek])

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
    ...bookings.filter(b => b.status === 'CONFIRMED' && b.occurrenceStatus !== 'EXCUSED').map(b => ({ id: `booking-${b.id}`, kind: 'allocation', category: 'TUTORING', startsAt: b.startsAt, endsAt: b.endsAt, label: `${b.courseCode} booking · ${role === 'STUDENT' ? b.tutorName : b.studentName}`, occurrenceStatus: b.occurrenceStatus, recurrence: null })),
  ], [slots, allocations, bookings, role])

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
          <p className="eyebrow">{role === 'STUDENT' ? 'Student' : 'Tutor'} workspace</p>
          <h1>My timetable</h1>
          <p className="helper-text">
            {role === 'STUDENT' ? 'Your classes, booked tutoring sessions and unavailable times in one view.' : 'Your classes, tutoring sessions and unavailable times in one view.'}
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

      <section className="role-card" aria-label="Timetable summary">
        <div className="timetable-summary">
          <div>
            <strong>{totalSlots}</strong>
            <span>{totalSlots === 1 ? 'schedule entry' : 'schedule entries'}</span>
          </div>
          {role === 'TUTOR' && <div>
            <strong>{confirmedCount}</strong>
            <span>{confirmedCount === 1 ? 'tutoring session' : 'tutoring sessions'}</span>
          </div>}
        </div>
      </section>

      {role === 'STUDENT' && <ScheduleEntryPanel role={role} tokenOrGetter={getAccessTokenSilently} storageScope={user?.sub ?? null} onChanged={load} />}

      <WeeklySchedule
        slots={combined}
        onWeekChange={onWeekChange}
        label="My timetable"
        showLegend
        emptyMessage="Nothing on your timetable yet. Import your classes or add unavailable times to get started."
        initialDate={jumpDate ? new Date(jumpDate + 'T00:00:00') : new Date()}
      />

      <BookingPanel onChanged={load} bookingId={bookingId} />

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
