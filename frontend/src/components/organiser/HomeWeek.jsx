import { addDays, localMonday, weekRangeLabel } from '../shared/scheduleWeek'
import { budgetUsed, money, percent, requirementsForWeek, sumHours } from '../../features/organiserHome'
import { OrganiserIcon } from './OrganiserIcon'
import { StatTile } from '../shared/StatTile'
import requirementsArt from '../../assets/organiser/calendar.svg'
import approvalsArt from '../../assets/organiser/check-boxes.svg'
import hoursArt from '../../assets/organiser/alarm-clock.svg'
import budgetArt from '../../assets/organiser/wallet.svg'

function figure(part, compute, fallback = 'Unavailable') {
  if (part.status === 'loading') return { value: '…', sub: 'Loading…' }
  if (part.status === 'error') return { value: '—', sub: fallback }
  return compute(part.data)
}

/**
 * "This week": the week picker that every week-based section on Home follows, and four figures
 * for that week (budget is for the year so far, since a course budget covers more than a week).
 */
export function HomeWeek({ weekStart, onWeekChange, week, approvals }) {
  const isCurrentWeek = localMonday(new Date()).valueOf() === weekStart.valueOf()

  const requirements = figure(week.requirements, (data) => {
    const open = requirementsForWeek(data, weekStart)
    const short = open.reduce((total, requirement) => total + requirement.shortageTutors, 0)
    return {
      value: String(open.length),
      sub: short > 0 ? `${short} ${short === 1 ? 'tutor' : 'tutors'} still needed` : 'Every session has its tutors',
    }
  }, 'Requirements could not be loaded')

  const waiting =
    approvals.status === 'loading'
      ? { value: '…', sub: 'Loading…' }
      : approvals.status === 'error'
        ? { value: '—', sub: 'Approvals could not be loaded' }
        : { value: String(approvals.totalPending), sub: 'Timesheets, claims, excuses and disputes' }

  const hours = figure(week.report, (report) => {
    const allocated = sumHours(report.courses, 'allocatedHours')
    const withCapacity = report.tutors.filter((tutor) => tutor.capacityHours !== null)
    return {
      value: `${allocated} h`,
      sub: withCapacity.length > 0 ? `Of ${sumHours(withCapacity, 'capacityHours')} h tutor capacity` : 'No tutor weekly limits set yet',
    }
  }, 'Hours could not be loaded')

  const budget = figure(week.yearReport, (report) => {
    const used = budgetUsed(report.courses)
    return used
      ? { value: percent(used.fraction), sub: `${money(used.spend)} of ${money(used.budget)} this year` }
      : { value: '—', sub: 'No course budgets or rates set' }
  }, 'Budget could not be loaded')

  return (
    <section className="home-section" aria-labelledby="this-week-heading">
      <div className="home-section-heading">
        <h2 id="this-week-heading">{isCurrentWeek ? 'This week' : 'Selected week'}</h2>
        <div className="week-picker" role="group" aria-label="Week shown on Home">
          <button type="button" className="week-picker-step" onClick={() => onWeekChange(addDays(weekStart, -7))} aria-label="Previous week">
            <OrganiserIcon name="chevron-left" size={16} />
          </button>
          <span className="week-picker-label">
            <OrganiserIcon name="calendar" size={16} />
            <span>{weekRangeLabel(weekStart)}</span>
          </span>
          <button type="button" className="week-picker-step" onClick={() => onWeekChange(addDays(weekStart, 7))} aria-label="Next week">
            <OrganiserIcon name="chevron-right" size={16} />
          </button>
          {!isCurrentWeek && (
            <button type="button" className="week-picker-today" onClick={() => onWeekChange(localMonday(new Date()))}>
              This week
            </button>
          )}
        </div>
      </div>
      <ul className="stat-grid">
        <StatTile label="Open requirements" {...requirements} art={requirementsArt} />
        <StatTile label="Waiting for you" {...waiting} art={approvalsArt} />
        <StatTile label="Hours allocated" {...hours} art={hoursArt} />
        <StatTile label="Budget used" {...budget} art={budgetArt} />
      </ul>
    </section>
  )
}
