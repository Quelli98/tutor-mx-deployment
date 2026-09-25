import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { getCommandCentreSummary } from '../api/organiser'
import { EmptyState, ErrorState, LoadingState } from '../components/shared/StatusMessage'
import { addDays, localMonday, weekRangeLabel } from '../components/shared/scheduleWeek'
import {
  DRILL_DOWN_LABELS,
  DRILL_DOWN_PATHS,
  PERIOD_LENGTHS,
  buildAttentionFeed,
  buildBudgetPanel,
  buildHeatmap,
  buildKpis,
  buildWorkloadPanel,
  formatHours,
  isEmptyPeriod,
} from './commandCentreModel'

/**
 * The live summary of the weeks an organiser is looking at: the headline
 * figures, the days the period is short of tutors, spend against budget, who is
 * carrying the work, and what is waiting on a decision. Every figure was worked
 * out by the server and is only arranged here, and each panel links to the
 * screen that already deals with it, so nothing on this page is a second
 * opinion about numbers that exist elsewhere.
 */

function safeErrorMessage(error) {
  if (error?.code === 'PROFILE_NOT_FOUND') {
    return 'We could not find your organiser profile. Ask an administrator to check your account.'
  }
  if (error?.code === 'ROLE_MISMATCH') {
    return 'Your account does not have organiser access.'
  }
  if (error?.code === 'COMMAND_CENTRE_UNAVAILABLE' || error?.code === 'REPORTING_UNAVAILABLE') {
    return 'The command centre is not available right now. Try again later.'
  }
  if (error?.code === 'VALIDATION_ERROR') {
    return error?.message || 'Choose a week starting on a Monday.'
  }
  return 'The command centre could not be loaded safely.'
}

function toIsoDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function KpiCard({ kpi }) {
  return (
    <li>
      <article
        className={`kpi-card kpi-${kpi.tone}`}
        aria-labelledby={`command-centre-kpi-${kpi.key}`}
      >
        <h3 id={`command-centre-kpi-${kpi.key}`}>{kpi.label}</h3>
        <p className="kpi-value">{kpi.value}</p>
        <p className="helper-text">{kpi.detail}</p>
        <Link className="text-link" to={kpi.path}>
          {kpi.linkLabel}
        </Link>
      </article>
    </li>
  )
}

/** One square per day, the days grouped into the weeks they belong to. */
function ShortageHeatmap({ heatmap }) {
  const weekdays = heatmap.weeks[0] ?? []

  return (
    <section className="role-card" aria-labelledby="command-centre-staffing-heading">
      <h2 id="command-centre-staffing-heading">Staffing shortages by day</h2>
      <p className="helper-text">
        Each square is a day work starts on, however full that day is. The state is the same one
        the staffing board uses.
      </p>
      <div className="table-scroll" tabIndex="0" aria-label="Staffing shortage heatmap">
        <table className="tutor-table heatmap-table">
          <caption>Hours required, allocated and still unfilled for each day of the period</caption>
          <thead>
            <tr>
              <th scope="col">Week of</th>
              {weekdays.map((day) => (
                <th key={day.date} scope="col">
                  {day.weekday}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heatmap.weeks.map((week) => (
              <tr key={week[0].date}>
                <th scope="row">{week[0].label}</th>
                {week.map((day) => (
                  <td key={day.date}>
                    <span className={`heat-cell heat-${day.tone}`} aria-hidden="true">
                      <span className="heat-hours">
                        {day.requirements === 0 ? '-' : formatHours(day.requiredHours)}
                      </span>
                      <span className="heat-note">
                        {day.requirements === 0 ? 'nothing starts' : `${formatHours(day.unfilledHours)} unfilled`}
                      </span>
                    </span>
                    <span className="visually-hidden">{day.detail}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="heatmap-legend">
        <li>
          <span className="heat-swatch heat-unfilled" aria-hidden="true" />
          Nothing filled
        </li>
        <li>
          <span className="heat-swatch heat-partially-filled" aria-hidden="true" />
          Partly filled
        </li>
        <li>
          <span className="heat-swatch heat-fully-filled" aria-hidden="true" />
          Fully filled
        </li>
        <li>
          <span className="heat-swatch heat-not-being-filled" aria-hidden="true" />
          Not being filled
        </li>
        <li>
          <span className="heat-swatch heat-empty" aria-hidden="true" />
          Nothing starts
        </li>
      </ul>
      {heatmap.hasWork ? (
        <p className="helper-text">
          {heatmap.unfilledDays === 0
            ? 'Every day something starts is fully covered.'
            : `${heatmap.unfilledDays} of the period's days still have hours unfilled.`}
        </p>
      ) : (
        <p className="helper-text">No requirement starts in this period.</p>
      )}
    </section>
  )
}

function BudgetVisual({ budget }) {
  return (
    <section className="role-card" aria-labelledby="command-centre-budget-heading">
      <h2 id="command-centre-budget-heading">Spend against budget</h2>
      <p className="helper-text">{budget.sentence}</p>
      {budget.fraction !== null && (
        <span
          className={`spend-bar${budget.full ? ' spend-bar-full' : ''}`}
          aria-hidden="true"
        >
          <span className="spend-bar-fill" style={{ width: `${budget.fraction * 100}%` }} />
        </span>
      )}
      <dl className="metric-list">
        <div>
          <dt>Spend</dt>
          <dd>{budget.spendLabel}</dd>
        </div>
        <div>
          <dt>Committed</dt>
          <dd>{budget.committedLabel}</dd>
        </div>
        <div>
          <dt>Budget</dt>
          <dd>{budget.budgetLabel}</dd>
        </div>
        <div>
          <dt>{budget.overBudget ? 'Over by' : 'Left'}</dt>
          <dd>{budget.remainingLabel ?? '--'}</dd>
        </div>
      </dl>
      {budget.unpricedNote && <p className="helper-text">{budget.unpricedNote}</p>}
      {budget.overBudgetCourses.length > 0 && (
        <ul className="command-centre-list">
          {budget.overBudgetCourses.map((course) => (
            <li key={course.key}>
              <strong>{course.code}</strong>{' '}
              <span className="helper-text">
                {course.name}: {course.spentLabel} spent against {course.budgetLabel},{' '}
                {course.overLabel} over.
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link className="text-link" to={DRILL_DOWN_PATHS.budget}>
        {DRILL_DOWN_LABELS.budget}
      </Link>
    </section>
  )
}

function WorkloadVisual({ workload }) {
  return (
    <section className="role-card" aria-labelledby="command-centre-workload-heading">
      <h2 id="command-centre-workload-heading">Who is carrying the work</h2>
      {workload.rows.length === 0 ? (
        <p className="helper-text">No tutor has allocated or approved hours in this period.</p>
      ) : (
        <ul className="workload-list">
          {workload.rows.map((row) => (
            <li key={row.key} className="workload-row">
              <div className="workload-heading">
                <strong>{row.name}</strong>
                <span className="helper-text">
                  {row.allocatedLabel} allocated, {row.approvedLabel} approved, {row.shareLabel} of
                  allocated hours
                  {row.capacityLabel === null ? '' : `, against ${row.capacityLabel} capacity`}
                </span>
              </div>
              {row.fraction !== null && (
                <span
                  className={`spend-bar${row.over ? ' spend-bar-full' : ''}`}
                  aria-hidden="true"
                >
                  <span className="spend-bar-fill" style={{ width: `${row.fraction * 100}%` }} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {workload.idleNote && <p className="helper-text">{workload.idleNote}</p>}
      <p className="helper-text">
        The share is the report&apos;s own figure, so it can never disagree with the reports screen.
      </p>
    </section>
  )
}

function NeedsAttentionFeed({ feed }) {
  return (
    <section className="role-card" aria-labelledby="command-centre-attention-heading">
      <div className="section-heading-row">
        <div>
          <h2 id="command-centre-attention-heading">Needs attention</h2>
          <p className="helper-text">
            Shortages, posted work nobody has claimed, queues waiting on a decision, and budgets
            that have run past what was planned.
          </p>
        </div>
        {feed.total > 0 && <span className="count-badge">{feed.total}</span>}
      </div>

      {feed.items.length === 0 ? (
        <p className="status-note" role="status">
          Nothing needs attention in this period.
        </p>
      ) : (
        <ul className="attention-list">
          {feed.items.map((item) => (
            <li key={item.key} className={`attention-item attention-${item.severity}`}>
              <div className="attention-body">
                <strong>{item.title}</strong>
                <p className="helper-text">{item.detail}</p>
              </div>
              <Link className="text-link" to={item.path}>
                {item.linkLabel}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {feed.total > feed.items.length && (
        <p className="helper-text">
          Showing the {feed.items.length} most pressing of {feed.total}.
        </p>
      )}
    </section>
  )
}

export default function CommandCentre() {
  const { getAccessTokenSilently } = useAuth0()
  const [status, setStatus] = useState('loading')
  const [summary, setSummary] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [selectedMonday, setSelectedMonday] = useState(() => localMonday(new Date()))
  const [weeks, setWeeks] = useState(4)

  const weekStartIso = toIsoDate(selectedMonday)
  const isCurrentWeek = localMonday(new Date()).valueOf() === selectedMonday.valueOf()

  function handleGoToDate(event) {
    const value = event.target.value
    if (!value) return
    const chosen = new Date(`${value}T00:00:00`)
    if (Number.isNaN(chosen.getTime())) return
    // The server only accepts a Monday, so snap to one rather than send a day
    // it would refuse.
    setSelectedMonday(localMonday(chosen))
  }

  const loadSummary = useCallback(
    async (isActive = () => true) => {
      setStatus('loading')
      setErrorMessage('')

      try {
        const result = await getCommandCentreSummary(
          { weekStart: weekStartIso, weeks },
          getAccessTokenSilently,
        )
        if (!isActive()) return

        setSummary(result)
        setStatus('success')
      } catch (err) {
        if (!isActive()) return

        setSummary(null)
        setErrorMessage(safeErrorMessage(err))
        setStatus('error')
      }
    },
    [getAccessTokenSilently, weekStartIso, weeks],
  )

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSummary(() => active)
    return () => {
      active = false
    }
  }, [loadSummary])

  const isEmpty = summary !== null && isEmptyPeriod(summary)

  return (
    <main id="main-content" className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Organiser workspace</p>
          <h1>Command centre</h1>
          <p className="helper-text">
            Staffing, money and the queues for the selected weeks, read together as one summary.
          </p>
        </div>
      </header>

      <section className="role-card" aria-labelledby="command-centre-period-heading">
        <h2 id="command-centre-period-heading">Period</h2>
        <div className="calendar-toolbar">
          <div>
            <strong>{isCurrentWeek ? 'From this week' : 'From selected week'}</strong>
            <span>{weekRangeLabel(selectedMonday)}</span>
          </div>
          <div className="button-row">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setSelectedMonday(addDays(selectedMonday, -7))}
            >
              Previous week
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setSelectedMonday(localMonday(new Date()))}
            >
              This week
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setSelectedMonday(addDays(selectedMonday, 7))}
            >
              Next week
            </button>
            <label className="week-date-picker">
              <span>Go to week</span>
              <input
                type="date"
                value={weekStartIso}
                onChange={handleGoToDate}
                aria-label="Go to week"
              />
            </label>
            <div className="field-group">
              <label htmlFor="command-centre-weeks">Length</label>
              <select
                id="command-centre-weeks"
                value={weeks}
                onChange={(event) => setWeeks(Number(event.target.value))}
              >
                {PERIOD_LENGTHS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="secondary-button"
              type="button"
              disabled={status === 'loading'}
              onClick={() => loadSummary()}
            >
              Refresh
            </button>
          </div>
        </div>
        <p className="helper-text">
          Whole weeks only, each starting on a Monday. Everything below is measured over these
          weeks.
        </p>
      </section>

      {status === 'loading' && (
        <LoadingState
          title="Reading the command centre..."
          message="Gathering staffing, money and the queues for these weeks."
        />
      )}

      {status === 'error' && (
        <ErrorState
          title="Command centre unavailable"
          message={errorMessage}
          onRetry={() => loadSummary()}
        />
      )}

      {status === 'success' && isEmpty && (
        <EmptyState
          title="Nothing in these weeks yet"
          message="No requirements, allocated or approved work, or queues fall in this period. Try another week."
        />
      )}

      {status === 'success' && !isEmpty && (
        <>
          <section className="command-centre-panel" aria-labelledby="command-centre-totals-heading">
            <h2 id="command-centre-totals-heading">At a glance</h2>
            <ul className="kpi-grid">
              {buildKpis(summary).map((kpi) => (
                <KpiCard key={kpi.key} kpi={kpi} />
              ))}
            </ul>
          </section>

          <ShortageHeatmap heatmap={buildHeatmap(summary)} />

          <div className="command-centre-grid">
            <BudgetVisual budget={buildBudgetPanel(summary)} />
            <WorkloadVisual workload={buildWorkloadPanel(summary)} />
          </div>

          <NeedsAttentionFeed feed={buildAttentionFeed(summary)} />

          <p className="helper-text">
            Every figure was read from the screen behind it for the same weeks, at the moment this
            page was opened. Use Refresh to read them again.
          </p>
        </>
      )}
    </main>
  )
}
