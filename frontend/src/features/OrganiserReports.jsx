import { useCallback, useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { downloadPayrollExport, getWorkloadReport } from '../api/organiser'
import { EmptyState, ErrorState, LoadingState } from '../components/shared/StatusMessage'
import { addDays, localMonday, weekRangeLabel } from '../components/shared/scheduleWeek'
import { ReportCharts } from '../components/organiser/ReportCharts'

/**
 * Every number on this screen is worked out by the server and shown as it
 * arrives. Nothing here adds hours together or converts hours to money: the
 * three kinds of hours (capacity, allocated, approved worked) stay separate all
 * the way from the query to the table.
 */

const WEEK_LENGTHS = [
  { value: 1, label: '1 week' },
  { value: 4, label: '4 weeks' },
  { value: 12, label: '12 weeks' },
]

function safeErrorMessage(error) {
  if (error?.code === 'PROFILE_NOT_FOUND') {
    return 'We could not find your organiser profile. Ask an administrator to check your account.'
  }
  if (error?.code === 'ROLE_MISMATCH') {
    return 'Your account does not have organiser access.'
  }
  if (error?.code === 'REPORTING_UNAVAILABLE') {
    return 'Reports are not available right now. Try again later.'
  }
  if (error?.code === 'VALIDATION_ERROR') {
    return error?.message || 'Choose a week starting on a Monday.'
  }
  return 'The report could not be loaded safely.'
}

function toIsoDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function hours(value) {
  return `${value} h`
}

// Plain and the same everywhere, rather than a locale format that would read
// differently on each organiser's machine.
function money(value) {
  return value === null || value === undefined ? '--' : `R${value.toFixed(2)}`
}

function percent(fraction) {
  return `${Math.round(fraction * 100)}%`
}

/** How full the bar is. A course with no budget or no rate has no bar. */
function spendFraction(course) {
  if (course.budget === null || course.spend === null) return null
  if (course.budget <= 0) return course.spend > 0 ? 1 : 0
  return Math.min(1, course.spend / course.budget)
}

/** The sentence carries the meaning; the bar only reinforces it. */
function budgetSentence(course) {
  if (course.hourlyRate === null) {
    return 'No hourly rate set for this course, so spend cannot be worked out.'
  }
  if (course.budget === null) {
    return `${money(course.spend)} spent so far. No budget set for this course.`
  }
  if (course.budgetRemaining < 0) {
    return `${money(course.spend)} spent against a ${money(course.budget)} budget, ${money(
      Math.abs(course.budgetRemaining),
    )} over.`
  }
  return `${money(course.spend)} of ${money(course.budget)} spent, ${money(
    course.budgetRemaining,
  )} left.`
}

export default function OrganiserReports() {
  const { getAccessTokenSilently } = useAuth0()
  const [status, setStatus] = useState('loading')
  const [report, setReport] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [selectedMonday, setSelectedMonday] = useState(() => localMonday(new Date()))
  const [weeks, setWeeks] = useState(4)
  const [payrollBusy, setPayrollBusy] = useState(false)
  const [payrollError, setPayrollError] = useState('')

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

  const loadReport = useCallback(
    async (isActive = () => true) => {
      setStatus('loading')
      setErrorMessage('')

      try {
        const result = await getWorkloadReport({ weekStart: weekStartIso, weeks }, getAccessTokenSilently)
        if (!isActive()) return

        setReport(result)
        setStatus('success')
      } catch (err) {
        if (!isActive()) return

        setReport(null)
        setErrorMessage(safeErrorMessage(err))
        setStatus('error')
      }
    },
    [getAccessTokenSilently, weekStartIso, weeks],
  )

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadReport(() => active)
    return () => {
      active = false
    }
  }, [loadReport])

  async function handlePayrollDownload() {
    setPayrollBusy(true)
    setPayrollError('')
    try {
      await downloadPayrollExport({ weekStart: weekStartIso, weeks }, getAccessTokenSilently)
    } catch (error) {
      setPayrollError(error?.message || 'The payroll file could not be downloaded.')
    } finally {
      setPayrollBusy(false)
    }
  }

  const courses = report?.courses ?? []
  const tutors = report?.tutors ?? []

  return (
    <main id="main-content" className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Organiser workspace</p>
          <h1>Reports</h1>
          <p className="helper-text">
            Hours and spend per course, and how the work is spread across tutors.
          </p>
        </div>
      </header>

      <section className="role-card" aria-labelledby="report-period-heading">
        <h2 id="report-period-heading">Reporting period</h2>
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
              <label htmlFor="report-weeks">Length</label>
              <select
                id="report-weeks"
                value={weeks}
                onChange={(event) => setWeeks(Number(event.target.value))}
              >
                {WEEK_LENGTHS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <p className="helper-text">Whole weeks only, each starting on a Monday.</p>
      </section>

      {status === 'loading' && (
        <LoadingState title="Loading the report..." message="Working out hours and spend." />
      )}

      {status === 'error' && (
        <ErrorState title="Report unavailable" message={errorMessage} onRetry={() => loadReport()} />
      )}

      {status === 'success' && courses.length === 0 && tutors.length === 0 && (
        <EmptyState
          title="Nothing to report yet"
          message="Add courses and tutors, and this period will have figures to show."
        />
      )}

      {status === 'success' && (courses.length > 0 || tutors.length > 0) && (
        <ReportCharts courses={courses} tutors={tutors} />
      )}

      {status === 'success' && courses.length > 0 && (
        <section className="role-card" aria-labelledby="course-report-heading">
          <h2 id="course-report-heading">Courses</h2>
          <p className="helper-text">
            Money figures use each course&apos;s current hourly rate, including for work already
            done.
          </p>
          <div className="table-scroll" tabIndex="0" aria-label="Course report table">
            <table className="tutor-table">
              <caption>Hours and spend per course for the selected period</caption>
              <thead>
                <tr>
                  <th scope="col">Course</th>
                  <th scope="col">Allocated</th>
                  <th scope="col">Approved worked</th>
                  <th scope="col">Spend</th>
                  <th scope="col">Committed</th>
                  <th scope="col">Budget</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((course) => {
                  const fraction = spendFraction(course)

                  return (
                    <tr key={course.courseId}>
                      <td>
                        <div className="table-cell-stack">
                          {course.courseCode}
                          <span className="helper-text">{course.courseName}</span>
                        </div>
                      </td>
                      <td>{hours(course.allocatedHours)}</td>
                      <td>{hours(course.approvedWorkedHours)}</td>
                      <td>{money(course.spend)}</td>
                      <td>{money(course.committed)}</td>
                      <td>
                        <div className="table-cell-stack">
                          <span>{budgetSentence(course)}</span>
                          {fraction !== null && (
                            <span
                              className={`spend-bar${fraction >= 1 ? ' spend-bar-full' : ''}`}
                              aria-hidden="true"
                            >
                              <span
                                className="spend-bar-fill"
                                style={{ width: `${fraction * 100}%` }}
                              />
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="helper-text">
            Spend is approved worked hours x rate. Committed is allocated hours x rate: work that
            is booked but not yet done.
          </p>
          <p className="helper-text">
            Approved worked hours only count once a timesheet has been approved, so recent work can
            take a while to appear.
          </p>
        </section>
      )}

      {status === 'success' && tutors.length > 0 && (
        <section className="role-card" aria-labelledby="tutor-report-heading">
          <h2 id="tutor-report-heading">Tutors</h2>
          <div className="table-scroll" tabIndex="0" aria-label="Tutor report table">
            <table className="tutor-table">
              <caption>How the work is spread across tutors for the selected period</caption>
              <thead>
                <tr>
                  <th scope="col">Tutor</th>
                  <th scope="col">Capacity</th>
                  <th scope="col">Allocated</th>
                  <th scope="col">Approved worked</th>
                  <th scope="col">Share of allocated</th>
                </tr>
              </thead>
              <tbody>
                {tutors.map((tutor) => (
                  <tr key={tutor.tutorId}>
                    <td>{tutor.fullName}</td>
                    <td>
                      {tutor.capacityHours === null ? 'Not set' : hours(tutor.capacityHours)}
                    </td>
                    <td>{hours(tutor.allocatedHours)}</td>
                    <td>{hours(tutor.approvedWorkedHours)}</td>
                    <td>{percent(tutor.shareOfAllocatedHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="helper-text">
            Capacity is worked out at today&apos;s weekly limits. Past periods are measured with
            the limit a tutor has now, not the one they had then.
          </p>
        </section>
      )}

      {status === 'success' && (
        <section className="role-card" aria-labelledby="payroll-export-heading">
          <h2 id="payroll-export-heading">Payroll export</h2>
          <p className="helper-text">
            Download a CSV of approved worked hours for the same period. Rows with an open dispute
            are held back until the dispute is resolved.
          </p>
          <div className="button-row">
            <button
              className="primary-button"
              type="button"
              disabled={payrollBusy}
              onClick={handlePayrollDownload}
            >
              {payrollBusy ? 'Preparing file...' : 'Download payroll CSV'}
            </button>
          </div>
          {payrollError && <p className="status-note danger" role="alert">{payrollError}</p>}
        </section>
      )}

      {status === 'success' && (
        <p className="helper-text">
          Allocated hours are counted in the week a session starts; worked hours in the week the
          work was done. For one piece of work these can fall in different weeks.
        </p>
      )}
    </main>
  )
}
