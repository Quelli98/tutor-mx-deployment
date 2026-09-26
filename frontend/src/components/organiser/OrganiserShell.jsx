import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { CsamMark } from '../shared/CsamMark'
import { CommandPalette } from '../shared/CommandPalette'
import { NotificationBell } from '../shared/NotificationBell'
import { OrganiserIcon } from './OrganiserIcon'
import { OrganiserNameContext } from './organiserProfile'
import bulkAllocationArt from '../../assets/organiser/group-project.svg'

const NAV_ITEMS = [
  { to: '/organiser', label: 'Home', icon: 'house' },
  { to: '/organiser/command-centre', label: 'Command centre', icon: 'gauge' },
  { to: '/organiser/courses', label: 'Courses', icon: 'book-open' },
  { to: '/organiser/tutors', label: 'Tutors', icon: 'users' },
  { to: '/organiser/terms', label: 'Academic terms', icon: 'calendar' },
  { to: '/organiser/reports', label: 'Reports', icon: 'chart-column' },
]

// These pages open from cards on Home ("See all", quick actions), so Home stays highlighted.
const HOME_PAGES = ['/organiser/approvals', '/organiser/staffing', '/organiser/overflow']

function profileName(user) {
  const profile = user?.data?.profile ?? user?.profile ?? user
  const name = typeof profile?.fullName === 'string' ? profile.fullName.trim() : ''
  return name || null
}

// Which page is showing, so each page's banner can carry its own illustration.
function pageKey(pathname) {
  if (pathname === '/organiser') return 'home'
  if (pathname.startsWith('/organiser/staffing/bulk')) return 'bulk'
  const match = pathname.match(/^\/organiser\/([a-z-]+)/)
  if (match) return match[1]
  if (pathname.startsWith('/settings')) return 'settings'
  return 'other'
}

function initialsOf(name) {
  const words = name.split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '').slice(0, 2)
  return letters.toUpperCase()
}

/** Scrolls to (and focuses) the element a link's #hash points at, once the page has drawn it. */
function useHashTarget(location) {
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1))
    if (!id) return undefined
    let tries = 0
    const timer = window.setInterval(() => {
      tries += 1
      const target = document.getElementById(id)
      if (target) {
        window.clearInterval(timer)
        if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
        target.focus({ preventScroll: true })
      } else if (tries >= 40) {
        window.clearInterval(timer)
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [location.hash, location.pathname])
}

/**
 * The organiser's frame: a navy sidebar (Home, Command centre, Courses, Tutors, Reports, bulk allocation,
 * account settings and sign out) and a top bar with the greeting, search and notifications.
 * On narrow screens the sidebar becomes a menu that opens over the page.
 */
export function OrganiserShell({ user, onSignOut, children }) {
  const location = useLocation()
  const { user: auth0User } = useAuth0()
  const [menuOpen, setMenuOpen] = useState(false)
  const name = profileName(user) || (typeof auth0User?.name === 'string' && !auth0User.name.includes('@') ? auth0User.name : null) || 'Organiser'
  const onHomePage = location.pathname === '/organiser' || HOME_PAGES.some((path) => location.pathname.startsWith(path))
  const page = pageKey(location.pathname)

  useHashTarget(location)

  useEffect(() => {
    if (!menuOpen) return undefined
    function closeOnEscape(event) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  const closeMenu = () => setMenuOpen(false)

  return (
    <div className={`organiser-shell${menuOpen ? ' menu-open' : ''}`}>
      <div className="organiser-backdrop" aria-hidden="true">
        <span className="organiser-backdrop-ring ring-one" />
        <span className="organiser-backdrop-ring ring-two" />
        <span className="organiser-backdrop-ring ring-three" />
      </div>
      <aside id="organiser-sidebar" className="organiser-sidebar">
        <div className="organiser-brand">
          <span className="organiser-brand-tile">
            <CsamMark className="brand-mark" />
          </span>
          <span className="organiser-brand-words">
            <strong>CSAM Tutor Hub</strong>
            <span>Organiser</span>
          </span>
        </div>

        <nav className="organiser-nav" aria-label="CSAM Tutor Hub primary navigation">
          <ul>
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/organiser'}
                  onClick={closeMenu}
                  className={({ isActive }) =>
                    `organiser-nav-link${isActive || (item.to === '/organiser' && onHomePage) ? ' active' : ''}`
                  }
                >
                  <OrganiserIcon name={item.icon} />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <section className="organiser-sidebar-card" aria-labelledby="sidebar-bulk-heading">
          <span className="organiser-sidebar-card-art">
            <img src={bulkAllocationArt} alt="" width="172" height="111" />
          </span>
          <h2 id="sidebar-bulk-heading">Bulk allocation</h2>
          <p>Fill several open requirements at once. You preview every match first.</p>
          <Link className="organiser-sidebar-card-action" to="/organiser/staffing/bulk" onClick={closeMenu} aria-label="Start bulk allocation">
            Start
          </Link>
        </section>

        <ul className="organiser-sidebar-footer">
          <li>
            <NavLink
              to="/settings"
              onClick={closeMenu}
              className={({ isActive }) => `organiser-nav-link${isActive ? ' active' : ''}`}
            >
              <OrganiserIcon name="settings" />
              <span>Account settings</span>
            </NavLink>
          </li>
          <li>
            <button type="button" className="organiser-nav-link" onClick={onSignOut}>
              <OrganiserIcon name="log-out" />
              <span>Sign out</span>
            </button>
          </li>
        </ul>
      </aside>

      {menuOpen && <div className="organiser-menu-backdrop" aria-hidden="true" onMouseDown={closeMenu} />}

      <div className="organiser-main">
        <header className="organiser-topbar">
          <button
            type="button"
            className="organiser-menu-button"
            aria-expanded={menuOpen}
            aria-controls="organiser-sidebar"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <OrganiserIcon name={menuOpen ? 'x' : 'menu'} />
            <span>{menuOpen ? 'Close menu' : 'Menu'}</span>
          </button>
          {/* Home greets the organiser in its own banner instead. */}
          {page !== 'home' && (
            <div className="organiser-greeting">
              <span className="organiser-avatar" aria-hidden="true">
                {initialsOf(name)}
              </span>
              <div>
                <p className="organiser-greeting-hello">Welcome back</p>
                <p className="organiser-greeting-name">{name}</p>
              </div>
            </div>
          )}
          <div className="organiser-tools">
            <CommandPalette variant="field" />
            <NotificationBell icon={<OrganiserIcon name="bell" size={22} />} />
          </div>
        </header>
        <OrganiserNameContext.Provider value={name === 'Organiser' ? null : name}>
          <div className="organiser-content" data-page={page}>{children}</div>
        </OrganiserNameContext.Provider>
      </div>
    </div>
  )
}
