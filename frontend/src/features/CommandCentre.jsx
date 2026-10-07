import AuditTimeline from './AuditTimeline'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { getCommandCentreSummary } from '../api/organiser'
import { fetchAllNotifications } from '../api/notifications'
import { EmptyState, ErrorState, LoadingState } from '../components/shared/StatusMessage'
import { addDays, localMonday, weekRangeLabel } from '../components/shared/scheduleWeek'
import {
  ALL_FILTER,
  ATTENTION_CATEGORY_LABELS,
  ATTENTION_PRIORITY_LABELS,
  attentionFilterOptions,
  buildAttentionFeed,
  filterAttentionItems,
  resolveAttentionTarget,
} from './attentionFeed'
import {
  DRILL_DOWN_LABELS,
  DRILL_DOWN_PATHS,
  PERIOD_LENGTHS,
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

/** One square per day, the days grouped into the weeks they belong to. The
 * state of a day is written inside its square as well as coloured, and the
 * written list below repeats the same days for anyone the squares do not serve.
 */
function ShortageHeatmap({ heatmap }) {
  const [showList, setShowList] = useState(false)
  const weekdays = heatmap.weeks[0] ?? []

  return (
    <section className="role-card" aria-labelledby="command-centre-staffing-heading">
      <h2 id="command-centre-staffing-heading">Staffing shortages by day</h2>
      <p className="helper-text">
        Each square is a day work starts on, however full that day is. The state is the same one
        the staffing board uses, and it is written in the square.
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
                      <span className="heat-state">{day.statusLabel}</span>
                      {day.requirements > 0 && (
                        <span className="heat-note">{`${formatHours(day.unfilledHours)} unfilled`}</span>
                      )}
                    </span>
                    {day.courses.length > 0 && (
                      <ul className="heat-courses">
                        {day.courses.map((course) => (
                          <li key={course.key}>
                            <Link
                              className="text-link"
                              to={course.path}
                              aria-label={`${course.linkLabel}: ${course.name}`}
                            >
                              {course.code}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                    <span className="visually-hidden">{day.detail}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="heatmap-legend">
        {heatmap.legend.map((entry) => (
          <li key={entry.status}>
            <span className={`heat-swatch heat-${entry.tone}`} aria-hidden="true" />
            {entry.label}
          </li>
        ))}
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

      <div>
        <button
          className="secondary-button"
          type="button"
          aria-expanded={showList}
          aria-controls="command-centre-heatmap-list"
          onClick={() => setShowList((current) => !current)}
        >
          {showList ? 'Hide the written list' : 'Show the written list'}
        </button>
      </div>
      <div id="command-centre-heatmap-list" className="heatmap-written" hidden={!showList}>
        {heatmap.rowsNote && <p className="helper-text">{heatmap.rowsNote}</p>}
        <div className="table-scroll" tabIndex="0" aria-label="Written staffing list table">
          <table className="tutor-table heatmap-table">
            <caption>The same days in words, with the courses that start on each</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">State</th>
                <th scope="col">Required</th>
                <th scope="col">Allocated</th>
                <th scope="col">Unfilled</th>
                <th scope="col">Courses</th>
              </tr>
            </thead>
            <tbody>
              {heatmap.rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td>
                    <span className={`fill-state fill-${row.tone}`}>{row.statusLabel}</span>
                  </td>
                  <td>{row.requiredLabel}</td>
                  <td>{row.assignedLabel}</td>
                  <td>{row.unfilledLabel}</td>
                  <td>
                    {row.courses.length === 0 ? (
                      '-'
                    ) : (
                      <ul className="heat-courses">
                        {row.courses.map((course) => (
                          <li key={course.key}>
                            <Link
                              className="text-link"
                              to={course.path}
                              aria-label={`${course.linkLabel}: ${course.name}`}
                            >
                              {course.code}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function BudgetVisual({ budget }) {
  return (
    <section className="role-card" aria-labelledby="command-centre-budget-heading">
      <h2 id="command-centre-budget-heading">Spend against budget</h2>
      <p className="helper-text">{budget.sentence}</p>
      <div className="gauge-status">
        <span className={`status-badge gauge-${budget.statusTone}`}>{budget.statusLabel}</span>
        {budget.usedPercent !== null && (
          <span className="gauge-percent">{budget.usedPercent} of budget used</span>
        )}
      </div>
      {budget.fraction !== null && (
        <span
          className={`spend-bar${budget.full ? ' spend-bar-full' : ''}`}
          role="meter"
          aria-label={`Budget used: ${budget.spendLabel} of ${budget.budgetLabel}`}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={Math.round(budget.fraction * 100)}
          aria-valuetext={`${budget.usedPercent ?? '--'} of the budget spent`}
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
              </span>{' '}
              <Link className="text-link" to={course.path}>
                {course.linkLabel}
              </Link>
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
        <p className="helper-text">{workload.emptyNote}</p>
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
                <span className="helper-text">{row.capacityNote}</span>
              </div>
              {row.fraction !== null && (
                <span
                  className={`spend-bar${row.over ? ' spend-bar-full' : ''}`}
                  aria-hidden="true"
                >
                  <span className="spend-bar-fill" style={{ width: `${row.fraction * 100}%` }} />
                </span>
              )}
              <Link className="text-link" to={row.path}>
                {row.linkLabel}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {workload.spreadNote && <p className="helper-text">{workload.spreadNote}</p>}
      {workload.idleNote && <p className="helper-text">{workload.idleNote}</p>}
      <p className="helper-text">{workload.softNote}</p>
    </section>
  )
}

/**
 * What needs a person, filtered to the kind of work the organiser chose. Each
 * card is one underlying issue the model identified, carries its category and
 * urgency in words as well as colour, and links only to a target the mapper
 * vouched for - the destination screen keeps responsibility for permission,
 * state and the decision itself, so no action is taken here.
 */
function NeedsAttentionFeed({
  feed,
  filter,
  onFilterChange,
  knownCourseIds,
  knownTutorIds,
  remindersAvailable,
}) {
  const options = attentionFilterOptions(feed.items)
  const visible = filterAttentionItems(feed.items, filter)
  const showingAll = !filter || filter === ALL_FILTER

  return (
    <section className="role-card" aria-labelledby="command-centre-attention-heading">
      <div className="section-heading-row">
        <div>
          <h2 id="command-centre-attention-heading">Needs attention</h2>
          <p className="helper-text">
            Shortages, posted work nobody has claimed, queues waiting on a decision, tutors at or
            near the capacity stated for them, and budgets that have run past what was planned.
            Each card opens the screen that already handles it.
          </p>
        </div>
        {feed.total > 0 && <span className="count-badge">{feed.total}</span>}
      </div>

      <div className="attention-filter" role="group" aria-label="Filter needs attention">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`attention-filter-button${filter === option.value ? ' active' : ''}`}
            aria-pressed={filter === option.value}
            onClick={() => onFilterChange(option.value)}
          >
            {`${option.label} (${option.count})`}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="status-note" role="status">
          {showingAll
            ? 'Nothing needs attention in this period.'
            : `Nothing needs attention in ${ATTENTION_CATEGORY_LABELS[filter]} for this period.`}
        </p>
      ) : (
        <ul className="attention-list">
          {visible.map((item) => {
            const target = resolveAttentionTarget(item, { knownCourseIds, knownTutorIds })

            return (
              <li key={item.id} className={`attention-item attention-${item.priority}`}>
                <div className="attention-body">
                  <div className="attention-meta">
                    <span className="attention-category">
                      {ATTENTION_CATEGORY_LABELS[item.category]}
                    </span>
                    <span className={`attention-priority attention-priority-${item.priority}`}>
                      {ATTENTION_PRIORITY_LABELS[item.priority]}
                    </span>
                  </div>
                  <strong>{item.title}</strong>
                  <p className="helper-text">{item.detail}</p>
                </div>
                {target.ok ? (
                  <Link className="text-link" to={target.path}>
                    {target.linkLabel}
                  </Link>
                ) : (
                  <span className="helper-text">No longer in the current data.</span>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {!remindersAvailable && (
        <p className="helper-text">
          Waiting times come from the reminder read, which could not be completed, so a queue may
          be more urgent than it looks.
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
  const [attentionFilter, setAttentionFilter] = useState(ALL_FILTER)
  const [notifications, setNotifications] = useState([])
  const [remindersAvailable, setRemindersAvailable] = useState(true)

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
        // The reminder read is Member 1's notification store, reused: it is
        // what tells the feed which queues have already waited long enough for
        // a reminder. Every page of it is read, because the reminders the feed
        // folds in are not guaranteed to sit on the first page - a queue item
        // that started waiting earlier than the rest is exactly the one that
        // needs its waiting time shown. It is secondary to the summary, which
        // owns every figure the screen shows: a failed reminder page leaves the
        // queue cards standing on the counts alone, and says so under the feed.
        const [result, reminderRead] = await Promise.all([
          getCommandCentreSummary(
            { weekStart: weekStartIso, weeks },
            getAccessTokenSilently,
          ),
          fetchAllNotifications({ status: 'all' }, getAccessTokenSilently).catch(
            () => null,
          ),
        ])
        if (!isActive()) return

        setSummary(result)
        setNotifications(reminderRead === null ? [] : reminderRead.items)
        setRemindersAvailable(reminderRead !== null)
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

      <AuditTimeline/>
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

          <NeedsAttentionFeed
            feed={buildAttentionFeed(summary, notifications)}
            filter={attentionFilter}
            onFilterChange={setAttentionFilter}
            knownCourseIds={new Set(summary.finance.courses.map((course) => course.courseId))}
            knownTutorIds={new Set(summary.workload.tutors.map((tutor) => tutor.tutorId))}
            remindersAvailable={remindersAvailable}
          />

          <p className="helper-text">
            Every figure was read from the screen behind it for the same weeks, at the moment this
            page was opened. Use Refresh to read them again.
          </p>
        </>
      )}
    </main>
  )
}
