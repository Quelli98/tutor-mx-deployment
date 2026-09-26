import { useEffect, useId, useMemo, useState } from 'react'
import { addDays, localMonday, localTime, scheduleForWeek, weekRangeLabel } from './scheduleWeek'

const CATEGORY_STYLES = {
  CLASS: { background: '#dbeafe', borderColor: '#3b82f6', color: '#1e40af' },
  UNAVAILABLE: { background: '#f3f4f6', borderColor: '#9ca3af', color: '#374151' },
  TUTORING: { background: '#dcfce7', borderColor: '#22c55e', color: '#166534' },
}

const LEGEND_ITEMS = [
  { category: 'CLASS', label: 'Classes' },
  { category: 'UNAVAILABLE', label: 'Unavailable' },
  { category: 'TUTORING', label: 'Tutoring' },
]

function blockStyle(category) {
  return CATEGORY_STYLES[category] ?? CATEGORY_STYLES.UNAVAILABLE
}

export default function WeeklySchedule({
  slots,
  label = 'Weekly schedule',
  initialDate = new Date(),
  showLegend = false,
  emptyMessage,
}) {
  const headingId = useId()
  const [weekStart, setWeekStart] = useState(() => localMonday(initialDate))
  useEffect(() => {
    setWeekStart(localMonday(initialDate))
  }, [initialDate])
  const days = useMemo(() => scheduleForWeek(slots, weekStart), [slots, weekStart])
  const blocks = days.flatMap((day) => day.blocks)
  const firstHour = Math.floor(Math.min(8 * 60, ...blocks.map((block) => block.startMinute)) / 60)
  const lastHour = Math.ceil(Math.max(18 * 60, ...blocks.map((block) => block.endMinute)) / 60)
  const rows = (lastHour - firstHour) * 4
  const thisWeek = localMonday(new Date()).valueOf() === weekStart.valueOf()

  const hasCategories = blocks.some((b) => b.category && b.category !== 'UNAVAILABLE')
  const activeLegend = hasCategories || showLegend
    ? LEGEND_ITEMS
    : LEGEND_ITEMS.filter((item) => item.category !== 'TUTORING')

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
      {activeLegend.length > 0 && (
        <div className="calendar-legend" role="list" aria-label="Legend">
          {activeLegend.map((item) => (
            <span key={item.category} role="listitem" className="calendar-legend-item">
              <span className="calendar-legend-swatch" style={blockStyle(item.category)} />
              {item.label}
            </span>
          ))}
        </div>
      )}
      {slots.length === 0
        ? <p className="empty-inline">{emptyMessage ?? 'No times added'}</p>
        : blocks.length === 0 && <p className="empty-inline">No entries this week.</p>}
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
              style={{
                ...blockStyle(block.category),
                gridColumn: block.lane,
                gridRow: `${Math.floor((block.startMinute - firstHour * 60) / 15) + 1} / ${Math.ceil((block.endMinute - firstHour * 60) / 15) + 1}`,
              }}>
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
