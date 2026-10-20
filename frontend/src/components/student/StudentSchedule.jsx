import { useState } from 'react'
import { OrganiserIcon } from '../organiser/OrganiserIcon'
import { daysFrom, monthGrid, sameDay, scheduleItems } from '../../features/studentHome'

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const KIND = {
  class: { label: 'Class', icon: 'book-open', tone: 'accent-blue' },
  busy: { label: 'Busy', icon: 'clock', tone: 'accent-orchid' },
  volunteer: { label: 'Volunteering', icon: 'users', tone: 'accent-pink' },
}

function timeRange(item) {
  const time = (value) => value.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${time(item.startsAt)}–${time(item.endsAt)}`
}

function ItemRow({ item, now }) {
  const kind = KIND[item.kind]
  const day = sameDay(item.startsAt, now)
    ? 'Today'
    : item.startsAt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  return (
    <li className={`student-agenda-item ${kind.tone}`}>
      <span className="student-agenda-icon" aria-hidden="true"><OrganiserIcon name={kind.icon} size={18} /></span>
      <span className="student-agenda-words">
        <strong>{item.title}</strong>
        <span>{day} · {timeRange(item)} · {kind.label}</span>
      </span>
    </li>
  )
}

/**
 * "My schedule": a month at a glance with the days that already have plans,
 * and what is coming up in the next seven days. Classes and busy times come
 * from My timetable; volunteer sessions are the ones an organiser approved.
 */
export function StudentSchedule({ slots, requests, now = new Date() }) {
  const [monthOffset, setMonthOffset] = useState(0)
  const monthStart = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1)
  const slotList = slots.status === 'success' ? slots.data : []

  // A month of a student's own entries is a handful of rows; recomputing on
  // render keeps this in step with the timetable and the month shown.
  const monthItems = scheduleItems({ slots: slotList, requests, from: monthStart, to: monthEnd })
  const upcoming = scheduleItems({ slots: slotList, requests, from: now, to: daysFrom(now, 7) }).slice(0, 6)
  const today = upcoming.filter((item) => sameDay(item.startsAt, now))
  const later = upcoming.filter((item) => !sameDay(item.startsAt, now))
  const monthLabel = monthStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  return (
    <section className="home-card student-schedule" aria-labelledby="student-schedule-heading">
      <div className="home-card-heading">
        <h2 id="student-schedule-heading">My schedule</h2>
        <a className="see-all-link" href="/student/timetable">Open timetable</a>
      </div>

      <div className="mini-calendar">
        <div className="mini-calendar-head">
          <button type="button" className="week-picker-step" onClick={() => setMonthOffset((value) => value - 1)} aria-label="Previous month">
            <OrganiserIcon name="chevron-left" size={16} />
          </button>
          <p aria-live="polite">{monthLabel}</p>
          <button type="button" className="week-picker-step" onClick={() => setMonthOffset((value) => value + 1)} aria-label="Next month">
            <OrganiserIcon name="chevron-right" size={16} />
          </button>
        </div>
        <table className="mini-calendar-grid" aria-label={`${monthLabel} calendar`}>
          <thead>
            <tr>{WEEKDAYS.map((day, index) => <th key={index} scope="col" aria-hidden="true">{day}</th>)}</tr>
          </thead>
          <tbody>
            {monthGrid(monthStart).map((week, row) => (
              <tr key={row}>
                {week.map((date, column) => {
                  if (!date) return <td key={column} />
                  const dayItems = monthItems.filter((item) => sameDay(item.startsAt, date))
                  const volunteering = dayItems.some((item) => item.kind === 'volunteer')
                  const classes = [
                    'mini-calendar-day',
                    sameDay(date, now) ? 'today' : '',
                    dayItems.length ? 'has-plans' : '',
                    volunteering ? 'volunteering' : '',
                  ].filter(Boolean).join(' ')
                  return (
                    <td key={column}>
                      <span className={classes}>
                        {date.getDate()}
                        {dayItems.length > 0 && (
                          <span className="visually-hidden">
                            {`, ${dayItems.length} ${dayItems.length === 1 ? 'plan' : 'plans'}${volunteering ? ' including volunteering' : ''}`}
                          </span>
                        )}
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="student-agenda">
        <h3>Coming up</h3>
        {slots.status === 'error' && (
          <p className="status-note" role="status">Your timetable could not be loaded, so only volunteer sessions are shown.</p>
        )}
        {slots.status === 'loading' && <p className="status-note" role="status">Loading your schedule…</p>}
        {slots.status !== 'loading' && upcoming.length === 0 && (
          <p className="home-empty">Nothing planned for the next 7 days.</p>
        )}
        {today.length > 0 && (
          <>
            <p className="student-agenda-group">Today</p>
            <ul className="student-agenda-list">{today.map((item) => <ItemRow key={item.key} item={item} now={now} />)}</ul>
          </>
        )}
        {later.length > 0 && (
          <>
            <p className="student-agenda-group">This week</p>
            <ul className="student-agenda-list">{later.map((item) => <ItemRow key={item.key} item={item} now={now} />)}</ul>
          </>
        )}
      </div>
    </section>
  )
}
