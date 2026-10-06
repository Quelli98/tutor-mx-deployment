import welcomeScene from '../../assets/redesign/student-support.webp'
import { firstNameOf } from '../shared/personName'
import { OrganiserIcon } from '../organiser/OrganiserIcon'

function greeting(hour) {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function agree(count, one, many) {
  return count === 1 ? one : many
}

function sessionWhen(value) {
  const date = new Date(value)
  return `${date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} at ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`
}

/** One or two short sentences with the figures that matter picked out. */
function Summary({ summary, workReady, requestsReady }) {
  const sentences = []
  if (workReady) {
    sentences.push(summary.openCount > 0
      ? <span key="open"><strong>{summary.openCount}</strong> {agree(summary.openCount, 'session is', 'sessions are')} looking for volunteers.</span>
      : <span key="open">No sessions need volunteers right now.</span>)
  }
  if (requestsReady && summary.nextSession) {
    sentences.push(<span key="next">Your next volunteer session is on <strong>{sessionWhen(summary.nextSession.startsAt)}</strong>.</span>)
  } else if (requestsReady && summary.pendingCount > 0) {
    sentences.push(<span key="pending"><strong>{summary.pendingCount}</strong> {agree(summary.pendingCount, 'request is', 'requests are')} waiting for an organiser.</span>)
  }
  if (sentences.length === 0) {
    return <p className="student-hero-text">Find open tutoring work, volunteer and follow each request outcome.</p>
  }
  return <p className="student-hero-text">{sentences.reduce((all, sentence, index) => index ? [...all, ' ', sentence] : [sentence], [])}</p>
}

/**
 * The Student home banner, after design-refs/student dashboard: a bold colour
 * card that greets the student, sums up their week and offers the two things
 * they most often come to do.
 */
export function StudentHero({ name, summary, workReady, requestsReady, now = new Date() }) {
  const firstName = firstNameOf(name)
  const today = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  function browseWork() {
    const heading = document.getElementById('available-work-heading')
    heading?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    heading?.focus({ preventScroll: true })
  }

  return (
    <section className="student-hero" aria-labelledby="student-hero-title">
      <div className="student-hero-words">
        <p className="student-hero-eyebrow">{greeting(now.getHours())} · {today}</p>
        <h2 id="student-hero-title" className="student-hero-title">
          Welcome back{firstName ? `, ${firstName}` : ''}!
        </h2>
        <Summary summary={summary} workReady={workReady} requestsReady={requestsReady} />
        <div className="student-hero-actions">
          <button type="button" className="student-hero-primary" onClick={browseWork}>
            <OrganiserIcon name="search" size={18} />
            <span>Browse open work</span>
          </button>
          <a className="student-hero-secondary" href="/student/timetable">
            <OrganiserIcon name="calendar" size={18} />
            <span>My timetable</span>
          </a>
        </div>
      </div>
      <span className="student-hero-art" aria-hidden="true">
        <img src={welcomeScene} alt="" width="420" height="281" />
      </span>
    </section>
  )
}
