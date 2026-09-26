import { Link } from 'react-router-dom'
import { ErrorState, LoadingState } from '../shared/StatusMessage'
import { requirementsForWeek, timeRange } from '../../features/organiserHome'
import { OrganiserIcon } from './OrganiserIcon'

const ROWS_SHOWN = 5

function dayParts(isoValue) {
  const date = new Date(isoValue)
  return {
    day: date.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase(),
    date: date.getDate(),
    long: date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
  }
}

/** The week's open staffing requirements, soonest first, each one a click away from allocating. */
export function HomeRequirements({ part, weekStart, onAllocate, onRetry }) {
  const requirements = part.status === 'success' ? requirementsForWeek(part.data, weekStart) : []

  return (
    <section className="home-card" aria-labelledby="home-requirements-heading">
      <div className="home-card-heading">
        <h2 id="home-requirements-heading" className="card-title">
          <span className="card-title-icon accent-violet"><OrganiserIcon name="clipboard-plus" size={18} /></span>
          Open requirements
        </h2>
        <Link className="see-all-link" to="/organiser/staffing" aria-label="See all staffing requirements">
          See all
        </Link>
      </div>

      {part.status === 'loading' && <LoadingState title="Loading requirements..." message="Checking which sessions still need tutors." />}
      {part.status === 'error' && (
        <ErrorState title="Requirements unavailable" message="Staffing requirements could not be loaded safely." onRetry={onRetry} />
      )}
      {part.status === 'success' && requirements.length === 0 && (
        <p className="home-empty">No open staffing requirements this week.</p>
      )}
      {part.status === 'success' && requirements.length > 0 && (
        <ul className="requirement-rows">
          {requirements.slice(0, ROWS_SHOWN).map((requirement) => {
            const when = dayParts(requirement.startsAt)
            const short = requirement.shortageTutors
            return (
              <li className="requirement-row" key={requirement.id}>
                <span className="date-tile" aria-hidden="true">
                  <span>{when.day}</span>
                  <strong>{when.date}</strong>
                </span>
                <div className="requirement-row-words">
                  <p className="requirement-row-course">
                    <span className="visually-hidden">{when.long}, </span>
                    {requirement.courseCode}
                  </p>
                  <p className="requirement-row-meta">
                    {timeRange(requirement.startsAt, requirement.endsAt)} · {requirement.tutorsNeeded}{' '}
                    {requirement.tutorsNeeded === 1 ? 'tutor' : 'tutors'} needed
                  </p>
                </div>
                {short > 0 ? (
                  <div className="requirement-row-side">
                    <span className="shortage-chip">{short} short</span>
                    <button
                      type="button"
                      className="secondary-button requirement-allocate"
                      onClick={(event) => onAllocate(requirement, event.currentTarget)}
                      aria-label={`Allocate a tutor to ${requirement.courseCode} on ${when.long} at ${timeRange(requirement.startsAt, requirement.endsAt)}`}
                    >
                      Allocate
                    </button>
                  </div>
                ) : (
                  <span className="staffed-chip">Staffed</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {part.status === 'success' && requirements.length > ROWS_SHOWN && (
        <Link className="home-more-link" to="/organiser/staffing">
          See all {requirements.length} requirements this week
        </Link>
      )}
    </section>
  )
}
