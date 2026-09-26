import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { getWorkloadReport } from '../../api/organiser'
import { addDays } from '../shared/scheduleWeek'
import { ErrorState, LoadingState } from '../shared/StatusMessage'
import { sumHours, toIsoDate } from '../../features/organiserHome'
import { OrganiserIcon } from './OrganiserIcon'

const PERIODS = [4, 8, 12]
const WIDTH = 640
const HEIGHT = 240
const PLOT_TOP = 12
const PLOT_BOTTOM = 200
const PLOT_LEFT = 44

function weekLabel(isoDate) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// Four even steps on the scale, each a round number (0, 20, 40, 60, 80 rather than 0, 19, 38…).
const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]

function niceMax(value) {
  const wanted = Math.max(value * 1.1, 4) / 4
  const step = STEPS.find((candidate) => candidate >= wanted) ?? Math.ceil(wanted / 1000) * 1000
  return step * 4
}

/**
 * Hours allocated against hours approved, week by week, ending with the week chosen on Home.
 * Each week is the server's own one-week workload report; weeks already fetched are kept.
 */
export function HoursChart({ weekStart }) {
  const { getAccessTokenSilently } = useAuth0()
  const [period, setPeriod] = useState(8)
  const [status, setStatus] = useState('loading')
  const [series, setSeries] = useState([])
  const cache = useRef(new Map())
  const lastIso = toIsoDate(weekStart)

  const load = useCallback(
    async (isActive = () => true) => {
      const last = new Date(`${lastIso}T00:00:00`)
      const weeks = Array.from({ length: period }, (_, index) => toIsoDate(addDays(last, -7 * (period - 1 - index))))
      const missing = weeks.filter((iso) => !cache.current.has(iso))
      if (missing.length > 0) setStatus('loading')
      try {
        const reports = await Promise.all(
          missing.map((iso) => getWorkloadReport({ weekStart: iso, weeks: 1 }, getAccessTokenSilently)),
        )
        missing.forEach((iso, index) => {
          cache.current.set(iso, {
            allocated: sumHours(reports[index].courses, 'allocatedHours'),
            approved: sumHours(reports[index].courses, 'approvedWorkedHours'),
          })
        })
        if (!isActive()) return
        setSeries(weeks.map((iso) => ({ iso, ...cache.current.get(iso) })))
        setStatus('success')
      } catch {
        if (!isActive()) return
        setSeries([])
        setStatus('error')
      }
    },
    [getAccessTokenSilently, lastIso, period],
  )

  useEffect(() => {
    let active = true
    load(() => active)
    return () => {
      active = false
    }
  }, [load])

  const max = niceMax(Math.max(0, ...series.flatMap((week) => [week.allocated, week.approved])))
  const plotWidth = WIDTH - PLOT_LEFT
  const slot = series.length ? plotWidth / series.length : plotWidth
  const barWidth = Math.min(16, Math.max(6, slot / 3.2))
  const y = (value) => PLOT_BOTTOM - (value / max) * (PLOT_BOTTOM - PLOT_TOP)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((share) => max * share)

  return (
    <section className="home-card" aria-labelledby="home-hours-heading">
      <div className="home-card-heading">
        <h2 id="home-hours-heading" className="card-title">
          <span className="card-title-icon accent-navy"><OrganiserIcon name="chart-column" size={18} /></span>
          Hours per week
        </h2>
        <div className="segmented" role="group" aria-label="Weeks shown">
          {PERIODS.map((weeks) => (
            <button key={weeks} type="button" aria-pressed={period === weeks} onClick={() => setPeriod(weeks)}>
              {weeks} weeks
            </button>
          ))}
        </div>
      </div>
      <ul className="chart-legend">
        <li><span className="legend-swatch legend-allocated" aria-hidden="true" />Allocated</li>
        <li><span className="legend-swatch legend-approved" aria-hidden="true" />Approved</li>
      </ul>

      {status === 'loading' && <LoadingState title="Loading hours..." message="Working out each week's hours." />}
      {status === 'error' && <ErrorState title="Hours unavailable" message="The weekly hours could not be loaded safely." onRetry={() => load()} />}
      {status === 'success' && (
        <>
          <svg className="hours-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Hours allocated and approved for the ${period} weeks to ${weekLabel(lastIso)}`}>
            {ticks.map((tick) => (
              <g key={tick}>
                <line className="chart-grid" x1={PLOT_LEFT} x2={WIDTH} y1={y(tick)} y2={y(tick)} />
                <text className="chart-axis" x={PLOT_LEFT - 10} y={y(tick) + 4} textAnchor="end">{tick}</text>
              </g>
            ))}
            {series.map((week, index) => {
              const x = PLOT_LEFT + index * slot + slot / 2
              const last = index === series.length - 1
              return (
                <g key={week.iso}>
                  {last && <rect className="chart-focus" x={x - slot / 2 + 3} y={PLOT_TOP - 6} width={slot - 6} height={PLOT_BOTTOM - PLOT_TOP + 6} rx="10" />}
                  <rect className="chart-bar-allocated" x={x - barWidth - 2} y={y(week.allocated)} width={barWidth} height={PLOT_BOTTOM - y(week.allocated)} rx="4">
                    <title>{`Week of ${weekLabel(week.iso)}: ${week.allocated} h allocated`}</title>
                  </rect>
                  <rect className="chart-bar-approved" x={x + 2} y={y(week.approved)} width={barWidth} height={PLOT_BOTTOM - y(week.approved)} rx="4">
                    <title>{`Week of ${weekLabel(week.iso)}: ${week.approved} h approved`}</title>
                  </rect>
                  {(series.length <= 8 || index % 2 === series.length % 2 || last) && (
                    <text className={`chart-axis${last ? ' chart-axis-current' : ''}`} x={x} y={PLOT_BOTTOM + 22} textAnchor="middle">
                      {weekLabel(week.iso)}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
          <table className="visually-hidden">
            <caption>Hours allocated and approved per week</caption>
            <thead>
              <tr><th scope="col">Week starting</th><th scope="col">Allocated</th><th scope="col">Approved</th></tr>
            </thead>
            <tbody>
              {series.map((week) => (
                <tr key={week.iso}><th scope="row">{weekLabel(week.iso)}</th><td>{week.allocated} h</td><td>{week.approved} h</td></tr>
              ))}
            </tbody>
          </table>
          <p className="helper-text">Allocated hours count in the week a session starts; approved hours once a timesheet is approved.</p>
        </>
      )}
    </section>
  )
}
