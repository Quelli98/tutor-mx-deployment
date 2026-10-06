import welcomeScene from '../../assets/redesign/student-support.webp'
import { firstNameOf } from '../shared/personName'

function greeting(hour) {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

function sessionWhen(value) {
  const date = new Date(value)
  return `${date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} at ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`
}

/** The colour banner at the top of the Student home: a greeting and the week in a sentence. */
export function StudentHero({ name, summary, workReady, requestsReady, now = new Date() }) {
  const firstName = firstNameOf(name)
  const today = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  const parts = []
  if (workReady) {
    parts.push(summary.openCount > 0
      ? `${plural(summary.openCount, 'session is', 'sessions are')} looking for volunteers`
      : 'no sessions need volunteers right now')
  }
  if (requestsReady && summary.nextSession) {
    parts.push(`your next volunteer session is on ${sessionWhen(summary.nextSession.startsAt)}`)
  } else if (requestsReady && summary.pendingCount > 0) {
    parts.push(`${plural(summary.pendingCount, 'request is', 'requests are')} waiting for an organiser`)
  }
  const sentence = parts.length
    ? `${parts.join(', and ')}.`
    : 'Find open tutoring work, volunteer and follow each request outcome.'

  return (
    <section className="page-banner student-hero" aria-labelledby="student-hero-title">
      <div className="page-banner-words">
        <p className="page-banner-eyebrow">{today}</p>
        <h2 id="student-hero-title" className="page-banner-title">
          {greeting(now.getHours())}
          {firstName ? `, ${firstName}` : ''}
        </h2>
        <p className="page-banner-text">{sentence.charAt(0).toUpperCase() + sentence.slice(1)}</p>
      </div>
      <span className="page-banner-art">
        <img src={welcomeScene} alt="" width="620" height="232" />
      </span>
    </section>
  )
}
