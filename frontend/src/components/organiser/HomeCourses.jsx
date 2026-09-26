import { Link } from 'react-router-dom'
import { EmptyState, LoadingState, ErrorState } from '../shared/StatusMessage'
import { courseCards, percent, shortDateTime } from '../../features/organiserHome'
import { OrganiserIcon } from './OrganiserIcon'
import magentaArt from '../../assets/organiser/local-server.svg'
import violetArt from '../../assets/organiser/database-tables.svg'
import indigoArt from '../../assets/organiser/code-review.svg'

const ART = { magenta: magentaArt, violet: violetArt, indigo: indigoArt }

function BudgetRing({ fraction }) {
  if (fraction === null) {
    return (
      <p className="budget-ring budget-ring-empty">
        <span>No budget</span>
      </p>
    )
  }
  const radius = 27
  const circumference = 2 * Math.PI * radius
  const shown = Math.min(1, Math.max(0, fraction))
  return (
    <p className="budget-ring">
      <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true" focusable="false">
        <circle cx="32" cy="32" r={radius} className="budget-ring-track" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          className="budget-ring-used"
          strokeDasharray={`${circumference * shown} ${circumference}`}
          transform="rotate(-90 32 32)"
        />
      </svg>
      <span className="budget-ring-label">
        <strong>{percent(fraction)}</strong>
        <span>budget</span>
      </span>
      <span className="visually-hidden"> of this year's budget used</span>
    </p>
  )
}

/** The busiest courses this week, like the course cards in the approved design. */
export function HomeCourses({ coursesStatus, courses, allocations, week, weekStart, onRetry }) {
  const reportsReady = week.report.status !== 'loading' && week.yearReport.status !== 'loading'
  const cards = coursesStatus === 'success'
    ? courseCards(courses, allocations, week.report.data, week.yearReport.data, weekStart)
    : []

  return (
    <section className="home-section" aria-labelledby="home-courses-heading">
      <div className="home-section-heading">
        <h2 id="home-courses-heading">Courses</h2>
        <Link className="see-all-link" to="/organiser/courses" aria-label="See all courses">
          See all
        </Link>
      </div>

      {coursesStatus === 'loading' && <LoadingState title="Loading courses..." message="Gathering this week's course figures." />}
      {coursesStatus === 'error' && <ErrorState title="Courses unavailable" message="Courses could not be loaded safely." onRetry={onRetry} />}
      {coursesStatus === 'success' && cards.length === 0 && (
        <EmptyState title="No courses set up" message="Add a course in Courses to see its tutors, hours and budget here." />
      )}
      {cards.length > 0 && (
        <ul className="course-card-grid" aria-busy={!reportsReady}>
          {cards.map((card) => (
            <li className={`course-card accent-${card.accent}`} key={card.id}>
              <div className="course-card-art">
                <img src={ART[card.accent]} alt="" width="240" height="122" />
              </div>
              <div className="course-card-body">
                <span className="course-code-chip">{card.code}</span>
                <h3>{card.name}</h3>
                <div className="course-card-facts">
                  <ul>
                    <li>
                      <OrganiserIcon name="users" size={16} />
                      {card.tutorsThisWeek} {card.tutorsThisWeek === 1 ? 'tutor' : 'tutors'} this week
                    </li>
                    <li>
                      <OrganiserIcon name="clock" size={16} />
                      {card.hoursThisWeek} h this week
                    </li>
                  </ul>
                  <BudgetRing fraction={card.budgetFraction} />
                </div>
              </div>
              <p className="course-card-next">
                {card.nextSession ? (
                  <>
                    Next session <strong>{shortDateTime(card.nextSession)}</strong>
                  </>
                ) : (
                  'No upcoming sessions booked'
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
