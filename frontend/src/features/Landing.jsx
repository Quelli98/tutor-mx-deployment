import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CsamMark } from '../components/shared/CsamMark'
import studentPhoto from '../assets/landing/student.webp'
import tutorPhoto from '../assets/landing/tutor.webp'
import organiserPhoto from '../assets/landing/organiser.webp'
import './Landing.css'

const ROLES = [
  { role: 'STUDENT', name: 'Student', article: 'a', photo: studentPhoto },
  { role: 'TUTOR', name: 'Tutor', article: 'a', photo: tutorPhoto },
  { role: 'ORGANISER', name: 'Organiser', article: 'an', photo: organiserPhoto },
]

// Line drawings on a 24px grid.
const ICONS = {
  cap: ['M2 9.5 12 5l10 4.5-10 4.5L2 9.5Z', 'M6 11.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5', 'M22 9.5v5'],
  code: ['m8 7-5 5 5 5', 'm16 7 5 5-5 5', 'm14 5-4 14'],
  pi: ['M4 7h16', 'M9 7v12', 'M15 7v9a3 3 0 0 0 3 3'],
  sigma: ['M18 5H6l6 7-6 7h12'],
  bulb: ['M9 18h6', 'M10 21h4', 'M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.2.9 2V17h5.2v-1.1c0-.8.3-1.5.9-2A6 6 0 0 0 12 3Z'],
  book: ['M2 5h6a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H2Z', 'M22 5h-6a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h7Z'],
  laptop: ['M4 6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v10H4Z', 'M2 19h20l-2-3H4Z'],
  pencil: ['M4 20l1-4L16 5l3 3L8 19Z', 'm14 7 3 3'],
  calendar: ['M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z', 'M4 10h16', 'M8 2v4', 'M16 2v4'],
  backpack: [
    'M6 8a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2Z',
    'M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1', 'M6 13h12', 'M10 13v3h4v-3',
  ],
  diploma: ['M4 7h14a2 2 0 0 1 0 4H4', 'M4 7a2 2 0 0 0 0 4', 'M9 11v6l2-1.5 2 1.5v-6'],
  setsquare: ['M4 20V4l16 16Z', 'M8 16v-4l4 4Z', 'M4 8h2', 'M4 12h2'],
  graph: ['M3 3v18h18', 'm7 15 4-5 3 3 5-6'],
  infinity: ['M12 12c-2-2.7-4-4-6-4a4 4 0 0 0 0 8c2 0 4-1.3 6-4Zm0 0c2 2.7 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.3-6 4Z'],
  sqrt: ['M3 13h3l3 7 5-16h7'],
  circle: ['M12 5a7 7 0 1 0 0 14a7 7 0 1 0 0-14Z'],
  triangle: ['M12 5l7 13H5Z'],
  plus: ['M12 6v12', 'M6 12h12'],
}

// x is a share of the content column (below 0 or above 1 is the side margin, shown on wide screens
// only). In the hero, y is px from the top; in the roles area, y is a share of the photo height plus
// an optional px offset below it. Tone colours the small shapes; line drawings stay grey.
const HERO_DOODLES = [
  { icon: 'cap', x: 0.77, y: 96, size: 58, rotate: -12, delay: 0 },
  { icon: 'pi', x: 0.93, y: 70, size: 44, rotate: 8, delay: -2.5 },
  { icon: 'code', x: 0.9, y: 168, size: 52, rotate: 10, delay: -5 },
  { icon: 'triangle', tone: 'magenta', x: 0.66, y: 10, size: 20, rotate: 12, delay: -1.5 },
  { icon: 'circle', tone: 'indigo', x: 0.985, y: 128, size: 16, rotate: 0, delay: -3.5 },
  { icon: 'backpack', x: -0.075, y: 40, size: 50, rotate: -10, delay: -6, wide: true },
  { icon: 'plus', tone: 'violet', x: 1.06, y: 250, size: 20, rotate: 0, delay: -4.5, wide: true },
]
const ROLE_DOODLES = [
  { icon: 'bulb', x: 0.314, y: 0.14, size: 50, rotate: 10, delay: -1 },
  { icon: 'triangle', tone: 'violet', x: 0.314, y: 0.42, size: 16, rotate: -10, delay: -3 },
  { icon: 'sigma', x: 0.314, y: 0.68, size: 44, rotate: -8, delay: -4 },
  { icon: 'laptop', x: 0.686, y: 0.24, size: 54, rotate: -8, delay: -2 },
  { icon: 'circle', tone: 'magenta', x: 0.686, y: 0.52, size: 14, rotate: 0, delay: -5 },
  { icon: 'book', x: 0.686, y: 0.76, size: 50, rotate: 8, delay: -6 },
  { icon: 'graph', x: 0.314, y: 1, offset: 127, size: 40, rotate: -6, delay: -2.5 },
  { icon: 'setsquare', x: 0.686, y: 1, offset: 127, size: 40, rotate: 8, delay: -7.5 },
  { icon: 'pencil', x: 0.02, y: 1, offset: 232, size: 46, rotate: -14, delay: -3 },
  { icon: 'infinity', x: 0.22, y: 1, offset: 236, size: 40, rotate: 0, delay: -1.2 },
  { icon: 'sqrt', x: 0.78, y: 1, offset: 236, size: 40, rotate: 6, delay: -4.2 },
  { icon: 'calendar', x: 0.975, y: 1, offset: 232, size: 46, rotate: 10, delay: -7 },
  { icon: 'diploma', x: -0.075, y: 0.45, size: 50, rotate: -12, delay: -2.2, wide: true },
  { icon: 'circle', tone: 'violet', x: 1.07, y: 0.12, size: 18, rotate: 0, delay: -6.5, wide: true },
  { icon: 'plus', tone: 'indigo', x: 1.065, y: 0.9, size: 20, rotate: 0, delay: -3.8, wide: true },
]

function Doodle({ icon, tone, wide, x, y, offset = 0, size, rotate, delay, yUnit }) {
  return (
    <span
      className={`landing-doodle${tone ? ` is-${tone}` : ''}${wide ? ' is-wide' : ''}`}
      style={{
        '--x': x,
        '--y': yUnit === 'px' ? `${y}px` : y,
        '--offset': `${offset}px`,
        '--size': `${size}px`,
        '--rotate': `${rotate}deg`,
        '--delay': `${delay}s`,
      }}
    >
      <svg viewBox="0 0 24 24" focusable="false">
        {ICONS[icon].map((d) => <path key={d} d={d} />)}
      </svg>
    </span>
  )
}

function ScrollArrow() {
  return (
    <svg viewBox="0 0 14 41" aria-hidden="true" focusable="false">
      <path d="M7 0v40M1 34l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

// Cards lean slightly toward the mouse, for a sense of depth.
function tilt(event) {
  if (event.pointerType !== 'mouse' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const card = event.currentTarget
  const box = card.getBoundingClientRect()
  const x = (event.clientX - box.left) / box.width - 0.5
  const y = (event.clientY - box.top) / box.height - 0.5
  card.style.setProperty('--tilt-y', `${(x * 10).toFixed(2)}deg`)
  card.style.setProperty('--tilt-x', `${(-y * 8).toFixed(2)}deg`)
}

function untilt(event) {
  event.currentTarget.style.removeProperty('--tilt-x')
  event.currentTarget.style.removeProperty('--tilt-y')
}

export function Landing({ onCreateAccount, onSignIn, isSubmitting, status }) {
  const [pendingAction, setPendingAction] = useState(null)

  const start = (action, run) => {
    setPendingAction(action)
    run()
  }
  const label = (action, idle) => (isSubmitting && pendingAction === action ? 'Opening...' : idle)

  return (
    <div className="landing" id="top">
      <div className="landing-rings" aria-hidden="true">
        <span className="landing-ring is-a" />
        <span className="landing-ring is-b" />
        <span className="landing-ring is-c" />
      </div>

      <header className="landing-header landing-container">
        <a className="landing-brand" href="#top" aria-label="CSAM Tutor Hub home">
          <CsamMark className="landing-brand-mark" />
          <span className="landing-brand-text">
            <span className="landing-brand-name">CSAM Tutor Hub</span>
            <span className="landing-brand-tagline">School of Computer Science and Applied Mathematics</span>
          </span>
        </a>
        <nav className="landing-nav" aria-label="Homepage">
          <a href="#top" aria-current="page">Home</a>
          <a href="#about">About</a>
          <a href="#roles">How It Works</a>
        </nav>
      </header>

      <main>
        <section className="landing-hero landing-container" aria-labelledby="landing-title">
          <div className="landing-doodles" aria-hidden="true">
            {HERO_DOODLES.map((doodle) => <Doodle key={`${doodle.icon}-${doodle.x}`} {...doodle} yUnit="px" />)}
          </div>
          <h1 id="landing-title" className="landing-title">
            <span>A Better Way to Manage</span> <span>Tutors at CSAM</span>
          </h1>
          <div className="landing-intro" id="about">
            <p>
              Assign tutors to courses by their marks, timetable and weekly hours. Log your hours and submit
              timesheets for sign-off, excuse yourself from a session, or volunteer for work nobody has taken.
            </p>
            <div className="landing-intro-actions">
              <a className="landing-cta" href="#roles">Choose Your Role</a>
              <span className="landing-scroll-hint" aria-hidden="true">
                <ScrollArrow />
                <span>Keep<br />scrolling</span>
              </span>
            </div>
          </div>
        </section>

        <section className="landing-roles-section" id="roles" aria-labelledby="landing-roles-title">
          <h2 id="landing-roles-title" className="visually-hidden">Choose your role</h2>
          <div className="landing-roles-stage landing-container">
            <div className="landing-doodles is-roles" aria-hidden="true">
              {ROLE_DOODLES.map((doodle) => <Doodle key={`${doodle.icon}-${doodle.x}`} {...doodle} yUnit="photo" />)}
            </div>
            <ul className="landing-roles">
              {ROLES.map(({ role, name, article, photo }) => (
                <li
                  key={role}
                  className={`landing-role is-${name.toLowerCase()}`}
                  onPointerMove={tilt}
                  onPointerLeave={untilt}
                >
                  <div className="landing-role-shape">
                    <img src={photo} alt="" width="300" height="460" />
                  </div>
                  <h3 className="landing-role-name">{name}</h3>
                  {role === 'ORGANISER' && (
                    <p className="landing-role-note">Lecturers only · Master Organiser approval required</p>
                  )}
                  <div className="landing-role-actions">
                    <button
                      type="button"
                      className="landing-create"
                      aria-label={role === 'ORGANISER' ? 'Register as an Organiser' : `Create account as ${article} ${name}`}
                      disabled={isSubmitting}
                      onClick={() => start(`signup:${role}`, () => onCreateAccount(role))}
                    >
                      {label(`signup:${role}`, role === 'ORGANISER' ? 'Register as organiser' : 'Create account')}
                    </button>
                    <button
                      type="button"
                      className="landing-signin"
                      disabled={isSubmitting}
                      onClick={() => start(`login:${role}`, () => onSignIn(role))}
                    >
                      {label(`login:${role}`, 'Sign in')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <p className="landing-forgot">
            <Link to="/reset-password">Forgot your password?</Link>
          </p>
          {status.message && status.type === 'error' && (
            <p className="landing-status" role="alert">{status.message}</p>
          )}
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-inner landing-container">
          <strong>CSAM Tutor Hub</strong>
          <span className="landing-footer-separator" aria-hidden="true">·</span>
          <span>School of Computer Science and Applied Mathematics, University of the Witwatersrand</span>
        </div>
      </footer>
    </div>
  )
}
