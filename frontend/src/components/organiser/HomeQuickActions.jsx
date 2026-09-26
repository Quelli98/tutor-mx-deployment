import { Link } from 'react-router-dom'
import { OrganiserIcon } from './OrganiserIcon'

const LINK_ACTIONS = [
  {
    title: 'Add staffing requirement',
    text: 'Record a session that still needs tutors.',
    icon: 'clipboard-plus',
    accent: 'violet',
    to: '/organiser/staffing#staffing-form-heading',
  },
  {
    title: 'Post overflow work',
    text: 'Offer unfilled work to student volunteers.',
    icon: 'megaphone',
    accent: 'indigo',
    to: '/organiser/overflow#overflow-form-heading',
  },
  {
    title: 'Export payroll',
    text: 'Download approved hours as a CSV file.',
    icon: 'download',
    accent: 'navy',
    to: '/organiser/reports#payroll-export-heading',
  },
]

function TileContent({ title, text, icon }) {
  return (
    <>
      <span className="quick-action-top">
        <span className="quick-action-icon">
          <OrganiserIcon name={icon} size={22} />
        </span>
        <span className="quick-action-go">
          <OrganiserIcon name="arrow-up-right" size={16} />
        </span>
      </span>
      <strong className="quick-action-title">{title}</strong>
      <span className="quick-action-text">{text}</span>
    </>
  )
}

/** Colour tiles for the organiser's everyday tasks. */
export function HomeQuickActions({ onAllocate }) {
  return (
    <section className="home-section" aria-labelledby="quick-actions-heading">
      <div className="home-section-heading">
        <h2 id="quick-actions-heading">Quick actions</h2>
      </div>
      <ul className="quick-action-grid">
        <li>
          <button type="button" className="quick-action accent-magenta" onClick={(event) => onAllocate(event.currentTarget)}>
            <TileContent title="Allocate a tutor" text="Match a session to a tutor by mark, timetable and hours." icon="user-plus" />
          </button>
        </li>
        {LINK_ACTIONS.map((action) => (
          <li key={action.title}>
            <Link className={`quick-action accent-${action.accent}`} to={action.to}>
              <TileContent {...action} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
