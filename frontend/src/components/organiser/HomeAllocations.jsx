import { useState } from 'react'
import { EmptyState, ErrorState, LoadingState } from '../shared/StatusMessage'
import { OrganiserIcon } from './OrganiserIcon'

const ROWS_SHOWN = 5

function sessionTime(startIso, endIso) {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const day = (date) => date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  const time = (date) => date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
  return start.toDateString() === end.toDateString()
    ? `${day(start)}, ${time(start)}–${time(end)}`
    : `${day(start)}, ${time(start)} – ${day(end)}, ${time(end)}`
}

function dayParts(isoValue) {
  const date = new Date(isoValue)
  return { day: date.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase(), date: date.getDate() }
}

/** Every current allocation, with edit (in the allocation panel) and remove. */
export function HomeAllocations({ status, allocations, error, isMutating, onRefresh, onEdit, onRemove, children }) {
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? allocations : allocations.slice(0, ROWS_SHOWN)

  return (
    <section className="home-card" aria-labelledby="current-allocations-heading">
      <div className="home-card-heading">
        <div>
          <h2 id="current-allocations-heading" className="card-title">
          <span className="card-title-icon accent-indigo"><OrganiserIcon name="calendar" size={18} /></span>
          Current allocations
        </h2>
          <p className="helper-text">Edit or remove active assignments. Hours refresh after every change.</p>
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
          <ul className="allocation-rows">
            {shown.map((allocation) => {
              const when = dayParts(allocation.startsAt)
              return (
                <li className="allocation-row" key={allocation.id}>
                  <span className="date-tile" aria-hidden="true">
                    <span>{when.day}</span>
                    <strong>{when.date}</strong>
                  </span>
                  <div className="allocation-row-words">
                    <p className="allocation-row-title">
                      <span className={`status-badge status-${allocation.status.toLowerCase()}`}>
                        {allocation.status.toLowerCase()}
                      </span>
                      <strong>{allocation.courseCode}</strong>
                      <span className="allocation-row-course">{allocation.courseName}</span>
                    </p>
                    <p className="allocation-row-meta">
                      {allocation.tutorName} · {allocation.tutorEmail}
                    </p>
                    <p className="allocation-row-meta">
                      {sessionTime(allocation.startsAt, allocation.endsAt)} · {allocation.allocatedHours} hours
                    </p>
                  </div>
                  <div className="allocation-row-actions">
                    <button type="button" className="secondary-button" onClick={(event) => onEdit(allocation, event.currentTarget)} disabled={isMutating}>
                      Edit allocation
                    </button>
                    <button type="button" className="danger-button" onClick={() => onRemove(allocation)} disabled={isMutating}>
                      Remove
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
          {allocations.length > ROWS_SHOWN && (
            <button type="button" className="home-more-link" onClick={() => setShowAll((value) => !value)} aria-expanded={showAll}>
              {showAll ? 'Show fewer allocations' : `Show all ${allocations.length} allocations`}
            </button>
          )}
        </>
      )}
    </section>
  )
}
