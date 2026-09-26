import { EmptyState, ErrorState, LoadingState } from '../shared/StatusMessage'
import { addDays, weekRangeLabel } from '../shared/scheduleWeek'
import {
  courseAccents,
  initials,
  neighbouringWeeks,
  timeRange,
  timetableWeek,
  toIsoDate,
} from '../../features/organiserHome'
import { OrganiserIcon } from './OrganiserIcon'

const TUTOR_ACCENTS = ['pink', 'blue', 'orchid', 'coral']

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

function statusLabel(status) {
  return status === 'CONFIRMED' ? null : status.charAt(0) + status.slice(1).toLowerCase()
}

function longDay(date) {
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

function weekLinkLabel(target, weekStart, step) {
  const adjacent = addDays(weekStart, step * 7).valueOf() === target.weekStart.valueOf()
  const name = adjacent
    ? step < 0 ? 'Previous week' : 'Next week'
    : `Week of ${target.weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`
  return `${name}: ${plural(target.count, 'allocation', 'allocations')}`
}

function TutorChip({ allocation, session, day, disabled, onEdit }) {
  const label = statusLabel(allocation.status)
  const accent = TUTOR_ACCENTS[Math.abs(Number(allocation.tutorId) || 0) % TUTOR_ACCENTS.length]
  return (
    <button
      type="button"
      className={`tutor-chip accent-${accent}`}
      onClick={(event) => onEdit(allocation, event.currentTarget)}
      disabled={disabled}
      aria-label={`${allocation.tutorName}${label ? ` (${label.toLowerCase()})` : ''}, ${session.courseCode}, ${longDay(day)}, ${timeRange(session.startsAt, session.endsAt)}: edit or remove`}
    >
      <span className="tutor-chip-avatar" aria-hidden="true">{initials(allocation.tutorName)}</span>
      <span className="tutor-chip-name">
        {allocation.tutorName}
        {label && <small>{label}</small>}
      </span>
    </button>
  )
}

/**
 * The allocations in the week Home is showing, as a timetable. Each session is a block in its
 * course's colour, and each tutor on it opens the allocation panel, where it can be changed or
 * removed. Links underneath move Home to the nearest earlier or later week with allocations.
 */
export function HomeAllocations({ status, allocations, error, isMutating, weekStart, onWeekChange, onRefresh, onEdit, children, today = new Date() }) {
  const accents = courseAccents(allocations)
  const week = timetableWeek(allocations, weekStart)
  const { previous, next } = neighbouringWeeks(allocations, weekStart)
  const busyDays = week.days.filter((day) => day.sessions.length > 0).length
  const legend = [...new Map(week.days.flatMap((day) => day.sessions).map((session) => [session.courseId, session.courseCode]))]
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
  const todayKey = toIsoDate(today)

  return (
    <section className="home-card" aria-labelledby="current-allocations-heading">
      <div className="home-card-heading">
        <div>
          <h2 id="current-allocations-heading" className="card-title">
            <span className="card-title-icon accent-indigo"><OrganiserIcon name="calendar" size={18} /></span>
            Current allocations
          </h2>
          <p className="helper-text">Choose a tutor to edit or remove their allocation. Hours refresh after every change.</p>
        </div>
        <button type="button" className="see-all-link" onClick={onRefresh} disabled={status === 'loading' || isMutating}>
          {status === 'loading' ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {children}

      {status === 'loading' && <LoadingState title="Loading allocations..." message="Checking the current workload." />}
      {status === 'error' && <ErrorState title="Allocations unavailable" message={error} onRetry={onRefresh} />}
      {status === 'success' && allocations.length === 0 && (
        <EmptyState title="No active allocations" message="Use Allocate a tutor to assign an eligible tutor." />
      )}
      {status === 'success' && allocations.length > 0 && (
        <>
          <div className="timetable-bar">
            <p className="timetable-summary">
              {weekRangeLabel(weekStart)}
              {week.count > 0 && ` · ${plural(week.count, 'allocation', 'allocations')} · ${week.hours} h`}
            </p>
            {legend.length > 0 && (
              <ul className="timetable-legend" aria-hidden="true">
                {legend.map(([courseId, courseCode]) => (
                  <li key={courseId} className={`accent-${accents.get(courseId)}`}>
                    <span className="timetable-legend-dot" />
                    {courseCode}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {week.count === 0 ? (
            <p className="home-empty">No allocations in this week.</p>
          ) : (
            <ol className={`timetable${busyDays >= 4 ? ' is-crowded' : ''}`} aria-label={`Allocations for ${weekRangeLabel(weekStart)}`}>
              {week.days.map((day) => {
                const isToday = toIsoDate(day.date) === todayKey
                return (
                  <li
                    key={toIsoDate(day.date)}
                    className={`timetable-day${day.sessions.length === 0 ? ' is-empty' : ''}${isToday ? ' is-today' : ''}`}
                    aria-current={isToday ? 'date' : undefined}
                  >
                    <h3 className="timetable-day-head">
                      <span className="timetable-weekday" aria-hidden="true">
                        {day.date.toLocaleDateString('en-GB', { weekday: 'short' })}
                      </span>
                      <span className="timetable-date" aria-hidden="true">{day.date.getDate()}</span>
                      <span className="visually-hidden">{longDay(day.date)}{isToday ? ', today' : ''}</span>
                    </h3>
                    {day.sessions.length === 0 ? (
                      <p className="timetable-empty">
                        <span aria-hidden="true">–</span>
                        <span className="visually-hidden">No sessions</span>
                      </p>
                    ) : (
                      <ul className="timetable-sessions">
                        {day.sessions.map((session) => (
                          <li key={session.key} className={`timetable-session accent-${accents.get(session.courseId)}`}>
                            <p className="timetable-time">{timeRange(session.startsAt, session.endsAt)}</p>
                            <p className="timetable-code">{session.courseCode}</p>
                            <p className="timetable-course">{session.courseName}</p>
                            <ul className="timetable-tutors">
                              {session.allocations.map((allocation) => (
                                <li key={allocation.id}>
                                  <TutorChip allocation={allocation} session={session} day={day.date} disabled={isMutating} onEdit={onEdit} />
                                </li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ol>
          )}

          {(previous || next) && (
            <div className="timetable-nav">
              {previous && (
                <button type="button" className="timetable-nav-link" onClick={() => onWeekChange(previous.weekStart)}>
                  <OrganiserIcon name="chevron-left" size={16} />
                  {weekLinkLabel(previous, weekStart, -1)}
                </button>
              )}
              {next && (
                <button type="button" className="timetable-nav-link is-next" onClick={() => onWeekChange(next.weekStart)}>
                  {weekLinkLabel(next, weekStart, 1)}
                  <OrganiserIcon name="chevron-right" size={16} />
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
