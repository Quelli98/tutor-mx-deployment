import { useId, useMemo, useState } from 'react'
import { addDays, localMonday, localTime, scheduleForWeek, weekRangeLabel } from './scheduleWeek'

export default function WeeklySchedule({ slots, label = 'Weekly unavailable schedule', initialDate = new Date() }) {
  const headingId = useId()
  const [weekStart, setWeekStart] = useState(() => localMonday(initialDate))
  const days = useMemo(() => scheduleForWeek(slots, weekStart), [slots, weekStart])
  const blocks = days.flatMap((day) => day.blocks)
  const firstHour = Math.floor(Math.min(8 * 60, ...blocks.map((block) => block.startMinute)) / 60)
  const lastHour = Math.ceil(Math.max(18 * 60, ...blocks.map((block) => block.endMinute)) / 60)
  const rows = (lastHour - firstHour) * 4
  const thisWeek = localMonday(new Date()).valueOf() === weekStart.valueOf()

  return (
    <section className="weekly-schedule" aria-label={label}>
      <div className="calendar-toolbar">
        <div>
          <h4 id={headingId}>{thisWeek ? 'This week' : 'Week schedule'}</h4>
          <p>{weekRangeLabel(weekStart)}</p>
        </div>
        <div className="button-row">
          <button className="secondary-button" type="button" onClick={() => setWeekStart(addDays(weekStart, -7))}>Previous week</button>
          <button className="secondary-button" type="button" onClick={() => setWeekStart(localMonday(new Date()))}>This week</button>
          <button className="secondary-button" type="button" onClick={() => setWeekStart(addDays(weekStart, 7))}>Next week</button>
        </div>
      </div>
      <p className="helper-text">Shaded blocks are unavailable. Free space means available. All times are local.</p>
      {slots.length === 0 ? <p className="empty-inline">No unavailable times added</p>
        : blocks.length === 0 && <p className="empty-inline">No unavailable times this week.</p>}
      <div className="calendar-scroll" role="region" aria-labelledby={headingId} tabIndex={0}>
        <div className="calendar-grid" style={{ gridTemplateRows: `auto repeat(${rows}, minmax(${blocks.length ? 12 : 6}px, auto))` }}>
          <span className="calendar-day-heading">Time</span>
          {days.map((day) => <div className="calendar-day-heading" key={day.date.valueOf()}>
            <strong>{day.date.toLocaleDateString('en-GB', { weekday: 'long' })}</strong>
            <span>{day.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
          </div>)}
          {Array.from({ length: lastHour - firstHour }, (_, index) => (
            <span key={index} className="calendar-hour" style={{ gridColumn: 1, gridRow: `${index * 4 + 2} / span 4` }}>
              {String(firstHour + index).padStart(2, '0')}:00
            </span>
          ))}
          {days.map((day, index) => <div className="calendar-day" key={day.date.valueOf()}
            style={{ gridColumn: index + 2, gridRow: '2 / -1', gridTemplateColumns: `repeat(${day.lanes}, minmax(0, 1fr))` }}>
            {day.blocks.map((block) => <article className="calendar-block" key={block.id}
              style={{ gridColumn: block.lane, gridRow: `${Math.floor((block.startMinute - firstHour * 60) / 15) + 1} / ${Math.ceil((block.endMinute - firstHour * 60) / 15) + 1}` }}>
              <strong>{block.label}</strong>
              <span>{day.date.toLocaleDateString('en-GB', { weekday: 'long' })}</span>
              <span>{localTime(block.startsAt)}–{block.endMinute === 1440 ? '24:00' : localTime(block.endsAt)}</span>
            </article>)}
          </div>)}
        </div>
      </div>
    </section>
  )
}
