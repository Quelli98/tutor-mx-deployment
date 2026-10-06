import { DensityToggle } from './DensityToggle'
import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { CsamMark } from './CsamMark'
import { CommandPalette } from './CommandPalette'
import { NotificationBell } from './NotificationBell'
import { OrganiserIcon } from '../organiser/OrganiserIcon'
import { personName } from './personName'
import tutorPhoto from '../../assets/redesign/tutor-online.png'
import studentPhoto from '../../assets/redesign/student-support.webp'

const ROLE_CONFIG = {
  TUTOR: {
    label: 'Tutor',
    photo: tutorPhoto,
    nav: [
      { to: '/tutor', label: 'Tutor workspace', icon: 'house', end: true },
      { to: '/tutor/timetable', label: 'My timetable', icon: 'calendar' },
      { to: '/tutor/swaps', label: 'Tutor swaps', icon: 'users' },
      { to: '/tutor/forms', label: 'Tutor forms', icon: 'clipboard-plus' },
    ],
    cardTitle: 'Your tutoring workspace',
    cardText: 'Keep your availability, work logs and submissions up to date from one place.',
  },
  STUDENT: {
    label: 'Student',
    photo: studentPhoto,
    nav: [
      { to: '/student', label: 'Student workspace', icon: 'book-open', end: true },
      { to: '/student/timetable', label: 'My timetable', icon: 'calendar' },
      { to: '/student/availability', label: 'Find a tutoring time', icon: 'calendar' },
    ],
    cardTitle: 'Find tutoring work',
    cardText: 'Browse open opportunities, volunteer and keep track of your requests.',
  },
}

function profileName(user, auth0User, fallback) {
  const profile = user?.data?.profile ?? user?.profile ?? user
  return personName(profile?.fullName) ?? personName(auth0User?.name) ?? fallback
}

function initialsOf(name) {
  const words = String(name).split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : (words[0] ?? '').slice(0, 2)
  return letters.toUpperCase()
}

function pageKey(pathname, role) {
  if (pathname === '/settings') return 'settings'
  if (role === 'TUTOR' && pathname.startsWith('/tutor/forms')) return 'forms'
  return 'home'
}

export function RoleWorkspaceShell({ role, user, onSignOut, children }) {
  const config = ROLE_CONFIG[role]
  const location = useLocation()
  const { user: auth0User } = useAuth0()
  const [compact, setCompact] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const name = profileName(user, auth0User, config.label)
  const page = pageKey(location.pathname, role)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!menuOpen) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  return (
    <div className={`member-shell member-shell-${role.toLowerCase()}${menuOpen ? ' menu-open' : ''}${compact ? ' compact-mode' : ''}`}>
      <aside id="member-sidebar" className="member-sidebar">
        <div className="organiser-brand">
          <span className="organiser-brand-tile"><CsamMark className="brand-mark" /></span>
          <span className="organiser-brand-words"><strong>CSAM Tutor Hub</strong><span>{config.label}</span></span>
        </div>

        <nav className="organiser-nav" aria-label="CSAM Tutor Hub primary navigation">
          <ul>
            {config.nav.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `organiser-nav-link${isActive ? ' active' : ''}`}
                >
                  <OrganiserIcon name={item.icon} />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <section className="member-sidebar-card" aria-label={`${config.label} workspace tip`}>
          <div className="member-sidebar-photo"><img src={config.photo} alt="" /></div>
          <h2>{config.cardTitle}</h2>
          <p>{config.cardText}</p>
        </section>

        <ul className="organiser-sidebar-footer">
          <li>
            <NavLink to="/settings" className={({ isActive }) => `organiser-nav-link${isActive ? ' active' : ''}`}>
              <OrganiserIcon name="settings" /><span>Account settings</span>
            </NavLink>
          </li>
          <li>
            <button type="button" className="organiser-nav-link" onClick={onSignOut}>
              <OrganiserIcon name="log-out" /><span>Sign out</span>
            </button>
          </li>
        </ul>
      </aside>

      {menuOpen && <div className="organiser-menu-backdrop" aria-hidden="true" onMouseDown={() => setMenuOpen(false)} />}

      <div className="member-main">
        <header className="member-topbar">
          <button
            type="button"
            className="organiser-menu-button"
            aria-expanded={menuOpen}
            aria-controls="member-sidebar"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <OrganiserIcon name={menuOpen ? 'x' : 'menu'} />
            <span>{menuOpen ? 'Close menu' : 'Menu'}</span>
          </button>
          {/* The Student home greets the student in its own banner instead. */}
          {!(role === 'STUDENT' && page === 'home') && (
            <div className="organiser-greeting">
              <span className="organiser-avatar" aria-hidden="true">{initialsOf(name)}</span>
              <div><p className="organiser-greeting-hello">Welcome back</p><p className="organiser-greeting-name">{name}</p></div>
            </div>
          )}
          <div className="organiser-tools">
            <CommandPalette variant="field" role={role} />
            <DensityToggle compact={compact} onChange={setCompact}/><NotificationBell icon={<OrganiserIcon name="bell" size={22} />} />
          </div>
        </header>
        <div className="member-content" data-role={role.toLowerCase()} data-page={page}>{children}</div>
      </div>
    </div>
  )
}
