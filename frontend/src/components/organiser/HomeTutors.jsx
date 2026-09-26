import { Link } from 'react-router-dom'
import { ErrorState, LoadingState } from '../shared/StatusMessage'
import { initials, tutorLoads } from '../../features/organiserHome'
import { OrganiserIcon } from './OrganiserIcon'

const AVATAR_ACCENTS = ['indigo', 'magenta', 'violet', 'navy']
const STATUS_TEXT = {
  available: 'Available for more work',
  'near-limit': 'Near weekly limit',
  'limit-reached': 'Weekly limit reached',
  'not-set': 'Weekly limit not set',
}

/** The fullest tutors this week: hours allocated against each tutor's own weekly limit. */
export function HomeTutors({ part, onRetry }) {
  const tutors = part.status === 'success' ? tutorLoads(part.data) : []

  return (
    <section className="home-card" aria-labelledby="home-tutors-heading">
      <div className="home-card-heading">
        <h2 id="home-tutors-heading" className="card-title">
          <span className="card-title-icon accent-magenta"><OrganiserIcon name="users" size={18} /></span>
          Tutors this week
        </h2>
        <Link className="see-all-link" to="/organiser/tutors" aria-label="See all tutors">
          See all
        </Link>
      </div>
      {part.status === 'loading' && <LoadingState title="Loading tutors..." message="Loading this week's workloads." />}
      {part.status === 'error' && <ErrorState title="Tutors unavailable" message="Tutor workloads could not be loaded safely." onRetry={onRetry} />}
      {part.status === 'success' && tutors.length === 0 && <p className="home-empty">No tutors have registered yet.</p>}
      {tutors.length > 0 && (
        <ul className="tutor-load-rows">
          {tutors.map((tutor, index) => (
            <li className={`tutor-load-row capacity-row-${tutor.status}`} key={tutor.id}>
              <span className={`home-avatar accent-${AVATAR_ACCENTS[index % AVATAR_ACCENTS.length]}`} aria-hidden="true">
                {initials(tutor.name)}
              </span>
              <div className="tutor-load-words">
                <p className="tutor-load-top">
                  <span className="tutor-load-name">{tutor.name}</span>
                  <span className="tutor-load-hours">
                    {tutor.weeklyHours == null ? `${tutor.usedHours} h · no limit` : `${tutor.usedHours} / ${tutor.weeklyHours} h`}
                  </span>
                </p>
                <span className="tutor-load-track" aria-hidden="true">
                  <span className="tutor-load-fill" style={{ width: `${(tutor.fraction ?? 0) * 100}%` }} />
                </span>
                <span className="visually-hidden">{STATUS_TEXT[tutor.status]}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
