import { OrganiserIcon } from './OrganiserIcon'

/**
 * Pictures of the workload report. Every value drawn here is a figure the server sent; nothing is
 * added up or converted. The exact figures, with their notes, stay in the tables below the charts,
 * so each chart is described for screen readers by a one-line summary rather than repeating them.
 */

const MAX_ROWS = 8
const PALETTE = ['#17406e', '#fc4c95', '#b82fe2', '#2a0cd8', '#0f8a8a', '#e08a00', '#5b6cff', '#c2185b']

function roundedMax(values) {
  const top = Math.max(1, ...values)
  const step = top <= 10 ? 2 : top <= 50 ? 10 : top <= 200 ? 25 : 100
  return Math.ceil(top / step) * step
}

function ChartCard({ title, icon, accent, summary, more, children }) {
  return (
    <figure className="report-chart">
      <figcaption className="report-chart-title">
        <span className={`card-title-icon accent-${accent}`}>
          <OrganiserIcon name={icon} size={18} />
        </span>
        {title}
      </figcaption>
      <p className="visually-hidden">{summary}</p>
      <div aria-hidden="true">{children}</div>
      {more > 0 && <p className="report-chart-more">and {more} more in the table below</p>}
    </figure>
  )
}

function HoursByCourse({ courses }) {
  const rows = [...courses].sort((a, b) => b.allocatedHours - a.allocatedHours).slice(0, MAX_ROWS)
  const max = roundedMax(rows.flatMap((row) => [row.allocatedHours, row.approvedWorkedHours]))
  return (
    <ChartCard
      title="Hours by course"
      icon="chart-column"
      accent="navy"
      summary="Allocated hours beside approved worked hours for each course; the figures are in the Courses table."
      more={courses.length - rows.length}
    >
      <ul className="chart-legend">
        <li><span className="legend-swatch legend-allocated" />Allocated</li>
        <li><span className="legend-swatch legend-approved" />Approved worked</li>
      </ul>
      <ul className="hbar-list">
        {rows.map((row) => (
          <li key={row.courseId} className="hbar-row">
            <span className="hbar-label">{row.courseCode}</span>
            <span className="hbar-bars">
              <span className="hbar hbar-allocated" style={{ width: `${(row.allocatedHours / max) * 100}%` }}>
                <span className="hbar-value">{row.allocatedHours}</span>
              </span>
              <span className="hbar hbar-approved" style={{ width: `${(row.approvedWorkedHours / max) * 100}%` }}>
                <span className="hbar-value">{row.approvedWorkedHours}</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="chart-axis-note">Hours, 0 to {max}</p>
    </ChartCard>
  )
}

function BudgetByCourse({ courses }) {
  const rows = [...courses]
    .sort((a, b) => (b.budget && b.spend !== null ? b.spend / b.budget : -1) - (a.budget && a.spend !== null ? a.spend / a.budget : -1))
    .slice(0, MAX_ROWS)
  return (
    <ChartCard
      title="Budget used"
      icon="wallet"
      accent="magenta"
      summary="Spend against budget for each course; the sentences in the Courses table say how much is left."
      more={courses.length - rows.length}
    >
      <ul className="budget-rows">
        {rows.map((row) => {
          const known = row.budget !== null && row.spend !== null
          const fraction = known ? (row.budget > 0 ? row.spend / row.budget : row.spend > 0 ? 1 : 0) : null
          return (
            <li key={row.courseId} className={`budget-row${fraction !== null && fraction > 1 ? ' over' : ''}`}>
              <span className="budget-row-top">
                <span className="hbar-label">{row.courseCode}</span>
                <span className="budget-row-figure">
                  {fraction === null ? (row.hourlyRate === null ? 'no rate yet' : 'no budget yet') : `${Math.round(fraction * 100)}%`}
                </span>
              </span>
              <span className={`budget-track${fraction === null ? ' empty' : ''}`}>
                {fraction !== null && <span className="budget-fill" style={{ width: `${Math.min(1, fraction) * 100}%` }} />}
              </span>
            </li>
          )
        })}
      </ul>
    </ChartCard>
  )
}

function arc(cx, cy, r, start, end) {
  const point = (angle) => [cx + r * Math.cos(angle), cy + r * Math.sin(angle)]
  const [x0, y0] = point(start)
  const [x1, y1] = point(end)
  return `M ${x0} ${y0} A ${r} ${r} 0 ${end - start > Math.PI ? 1 : 0} 1 ${x1} ${y1}`
}

function ShareOfWork({ tutors }) {
  const sharing = [...tutors].filter((tutor) => tutor.shareOfAllocatedHours > 0).sort((a, b) => b.shareOfAllocatedHours - a.shareOfAllocatedHours)
  const shown = sharing.slice(0, PALETTE.length - 1)
  const rest = sharing.slice(shown.length).reduce((total, tutor) => total + tutor.shareOfAllocatedHours, 0)
  const slices = [...shown.map((tutor) => ({ name: tutor.fullName, share: tutor.shareOfAllocatedHours })), ...(rest > 0 ? [{ name: 'Everyone else', share: rest }] : [])]
  let angle = -Math.PI / 2
  return (
    <ChartCard
      title="Share of the work"
      icon="chart-pie"
      accent="violet"
      summary="Each tutor's share of the allocated hours; the percentages are in the Tutors table."
      more={0}
    >
      {slices.length === 0 ? (
        <p className="report-chart-empty">No hours were allocated in this period.</p>
      ) : (
        <div className="donut-layout">
          <svg viewBox="0 0 160 160" className="donut">
            <circle cx="80" cy="80" r="58" className="donut-track" />
            {slices.map((slice, index) => {
              const start = angle
              const sweep = Math.min(slice.share, 0.9999) * 2 * Math.PI
              angle += sweep
              return <path key={slice.name} d={arc(80, 80, 58, start, start + sweep)} stroke={PALETTE[index % PALETTE.length]} className="donut-slice" />
            })}
            <text x="80" y="76" textAnchor="middle" className="donut-number">{sharing.length}</text>
            <text x="80" y="96" textAnchor="middle" className="donut-caption">{sharing.length === 1 ? 'tutor' : 'tutors'} working</text>
          </svg>
          <ul className="donut-legend">
            {slices.map((slice, index) => (
              <li key={slice.name}>
                <span className="legend-swatch" style={{ background: PALETTE[index % PALETTE.length] }} />
                <span className="donut-legend-name">{slice.name}</span>
                <span className="donut-legend-share">{(slice.share * 100).toFixed(0)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartCard>
  )
}

function TutorHours({ tutors }) {
  const rows = [...tutors].sort((a, b) => b.allocatedHours - a.allocatedHours).slice(0, MAX_ROWS)
  const max = roundedMax(rows.flatMap((row) => [row.allocatedHours, row.capacityHours ?? 0]))
  return (
    <ChartCard
      title="Tutor hours and limits"
      icon="clock"
      accent="indigo"
      summary="Hours allocated to each tutor, drawn against their weekly limits over the period where one is set."
      more={tutors.length - rows.length}
    >
      <ul className="chart-legend">
        <li><span className="legend-swatch legend-allocated" />Allocated</li>
        <li><span className="legend-swatch legend-capacity" />Limit for the period</li>
      </ul>
      <ul className="hbar-list">
        {rows.map((row) => (
          <li key={row.tutorId} className="hbar-row">
            <span className="hbar-label" title={row.fullName}>{row.fullName}</span>
            <span className="hbar-bars hbar-overlay">
              {row.capacityHours !== null && <span className="hbar hbar-capacity" style={{ width: `${(row.capacityHours / max) * 100}%` }} />}
              <span className="hbar hbar-allocated" style={{ width: `${(row.allocatedHours / max) * 100}%` }}>
                <span className="hbar-value">{row.allocatedHours}</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="chart-axis-note">Hours, 0 to {max}</p>
    </ChartCard>
  )
}

/** Four charts of the report, shown above the detailed tables. */
export function ReportCharts({ courses, tutors }) {
  return (
    <section className="report-charts" aria-labelledby="report-charts-heading">
      <h2 id="report-charts-heading" className="visually-hidden">At a glance</h2>
      {courses.length > 0 && <HoursByCourse courses={courses} />}
      {courses.length > 0 && <BudgetByCourse courses={courses} />}
      {tutors.length > 0 && <ShareOfWork tutors={tutors} />}
      {tutors.length > 0 && <TutorHours tutors={tutors} />}
    </section>
  )
}
