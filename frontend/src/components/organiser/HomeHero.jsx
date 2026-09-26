import { requirementsForWeek } from '../../features/organiserHome'
import { useOrganiserName } from './organiserProfile'
import welcomeScene from '../../assets/organiser/scenes/home.webp'

function greeting(hour) {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

/** The colour banner at the top of Home: a greeting and the week in one sentence. */
export function HomeHero({ approvals, week, weekStart, now = new Date() }) {
  const name = useOrganiserName()
  const firstName = name ? name.split(/\s+/)[0] : null
  const today = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  const parts = []
  if (week.requirements.status === 'success') {
    const short = requirementsForWeek(week.requirements.data, weekStart).filter((requirement) => requirement.shortageTutors > 0).length
    parts.push(short > 0 ? `${plural(short, 'session still needs', 'sessions still need')} tutors` : 'every session has its tutors')
  }
  if (approvals.status === 'success') {
    parts.push(
      approvals.totalPending > 0
        ? `${plural(approvals.totalPending, 'request is', 'requests are')} waiting for you`
        : 'nothing is waiting for your approval',
    )
  }
  const summary = parts.length
    ? `This week ${parts.join(', and ')}.`
    : 'Here is how your tutoring week is shaping up.'

  return (
    <section className="page-banner home-hero" aria-labelledby="home-hero-title">
      <div className="page-banner-words">
        <p className="page-banner-eyebrow">{today}</p>
        <h2 id="home-hero-title" className="page-banner-title">
          {greeting(now.getHours())}
          {firstName ? `, ${firstName}` : ''}
        </h2>
        <p className="page-banner-text">{summary}</p>
      </div>
      <span className="page-banner-art">
        <img src={welcomeScene} alt="" width="620" height="232" />
      </span>
    </section>
  )
}
