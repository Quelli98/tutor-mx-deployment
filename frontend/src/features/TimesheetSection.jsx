import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchTimesheetStatus, submitTimesheet } from '../api/timesheet'

const STORAGE_KEY = 'tutormx.tutorTimesheets'

function storageKeyFor(scope) {
  return scope ? `${STORAGE_KEY}.${scope}` : STORAGE_KEY
}

function loadStoredTimesheets(storageKey) {
  try {
    const raw = window.sessionStorage.getItem(storageKey)
    const stored = raw ? JSON.parse(raw) : []
    if (!Array.isArray(stored)) return {}
    const byId = {}
    for (const summary of stored) {
      if (Number.isInteger(summary?.id)) {
        byId[summary.id] = summary
      }
    }
    return byId
  } catch {
    return {}
  }
}

function persistTimesheets(statuses, storageKey) {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(Object.values(statuses)))
  } catch {
    // A blocked or full store must not break the in-page workflow.
  }
}

function submitErrorMessage(error) {
  if (error?.code === 'TIMESHEET_SUBMISSION_CONFLICT') {
    return 'This week has already been sent for review.'
  }
  if (error?.code === 'TIMESHEET_HOURS_INVALID') {
    return 'The logged hours are missing or exceed the weekly hour limit. Add or correct entries and try again.'
  }
  return 'The timesheet could not be submitted. Try again.'
}

function statusLine(summary) {
  if (!summary || summary.status === 'DRAFT') {
    return 'Draft, not submitted yet.'
  }
  if (summary.status === 'SUBMITTED') {
    return 'Submitted for review. Waiting for the organiser decision.'
  }
  if (summary.status === 'APPROVED') {
    return 'Approved by the organiser.'
  }
  return 'Returned by the organiser for correction.'
}

function roundHours(total) {
  return Math.round(total * 100) / 100
}

function mondayFor(workDate) {
  const date = new Date(`${workDate}T12:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return workDate
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}

function weekLabelFor(card) {
  if (card.summary?.weekStart) return card.summary.weekStart
  const dates = card.entries.map((entry) => entry.workDate).sort()
  return dates[0] ? mondayFor(dates[0]) : ''
}

export default function TimesheetSection({ savedLogs = [], tokenOrGetter, storageScope = null }) {
  const storageKey = storageKeyFor(storageScope)
  const [statuses, setStatuses] = useState(() => loadStoredTimesheets(storageKey))
  const [busy, setBusy] = useState({})
  const [messages, setMessages] = useState({})
  const knownIdsRef = useRef([])
  const refreshInFlightRef = useRef(false)

  const cards = useMemo(() => {
    const entriesByTimesheet = new Map()
    for (const log of savedLogs) {
      const group = entriesByTimesheet.get(log.timesheetId) ?? []
      group.push(log)
      entriesByTimesheet.set(log.timesheetId, group)
    }
    const ids = new Set([...entriesByTimesheet.keys(), ...Object.keys(statuses).map(Number)])
    return [...ids]
      .map((id) => ({
        id,
        entries: entriesByTimesheet.get(id) ?? [],
        summary: statuses[id] ?? null,
      }))
      .sort((first, second) => weekLabelFor(second).localeCompare(weekLabelFor(first)))
  }, [savedLogs, statuses])

  useEffect(() => {
    knownIdsRef.current = Object.keys(statuses).map(Number)
  }, [statuses])

  useEffect(() => {
    persistTimesheets(statuses, storageKey)
  }, [statuses, storageKey])

  const refreshStatus = useCallback(
    async (timesheetId) => {
      try {
        const summary = await fetchTimesheetStatus(timesheetId, tokenOrGetter)
        setStatuses((current) => ({ ...current, [timesheetId]: summary }))
        return true
      } catch (error) {
        if (error?.code === 'TIMESHEET_NOT_FOUND') {
          // Left over from another account or removed server-side: drop quietly.
          setStatuses((current) => {
            const next = { ...current }
            delete next[timesheetId]
            return next
          })
        }
        return false
      }
    },
    [tokenOrGetter],
  )

  const refreshAllStatuses = useCallback(async () => {
    if (refreshInFlightRef.current || knownIdsRef.current.length === 0) return
    refreshInFlightRef.current = true
    try {
      await Promise.allSettled(knownIdsRef.current.map((id) => refreshStatus(id)))
    } finally {
      refreshInFlightRef.current = false
    }
  }, [refreshStatus])

  // The organiser decision happens outside this tab: refetch quietly
  // whenever the tutor returns to the Tutor Mx tab.
  useEffect(() => {
    const handleWindowFocus = () => {
      refreshAllStatuses()
    }
    window.addEventListener('focus', handleWindowFocus)
    return () => {
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [refreshAllStatuses])

  useEffect(() => {
    refreshAllStatuses()
  }, [refreshAllStatuses])

  function setBusyFor(timesheetId, value) {
    setBusy((current) => {
      const next = { ...current }
      if (value === undefined) {
        delete next[timesheetId]
      } else {
        next[timesheetId] = value
      }
      return next
    })
  }

  function setMessageFor(timesheetId, text) {
    setMessages((current) => {
      const next = { ...current }
      if (text === undefined) {
        delete next[timesheetId]
      } else {
        next[timesheetId] = text
      }
      return next
    })
  }

  async function handleSubmit(timesheetId) {
    setBusyFor(timesheetId, 'submitting')
    setMessageFor(timesheetId, undefined)
    try {
      const summary = await submitTimesheet(timesheetId, tokenOrGetter)
      setStatuses((current) => ({ ...current, [timesheetId]: summary }))
    } catch (error) {
      if (error?.code === 'TIMESHEET_SUBMISSION_CONFLICT') {
        // Another tab may have submitted already; resync with the server.
        await refreshStatus(timesheetId)
      }
      setMessageFor(timesheetId, submitErrorMessage(error))
    } finally {
      setBusyFor(timesheetId, undefined)
    }
  }

  async function handleCheck(timesheetId) {
    setBusyFor(timesheetId, 'checking')
    setMessageFor(timesheetId, undefined)
    const updated = await refreshStatus(timesheetId)
    if (!updated) {
      setMessageFor(timesheetId, 'The timesheet status could not be checked. Try again.')
    }
    setBusyFor(timesheetId, undefined)
  }

  return (
    <section className="draft-list" aria-labelledby="timesheet-heading">
      <h3 id="timesheet-heading">Weekly timesheets</h3>
      {cards.length === 0 ? (
        <p>No timesheets yet. Logged hours are grouped by week for organiser approval.</p>
      ) : (
        <ul>
          {cards.map((card) => {
            const isBusy = Boolean(busy[card.id])
            const canSubmit =
              !card.summary ||
              card.summary.status === 'DRAFT' ||
              card.summary.status === 'RETURNED'
            const draftTotal = card.entries.reduce(
              (total, entry) => total + Number(entry.hours || 0),
              0,
            )
            const totalHours = card.summary ? card.summary.totalHours : draftTotal
            const weekLabel = weekLabelFor(card)
            return (
              <li key={card.id} className="timesheet-card">
                <p>
                  <strong>Week of {weekLabel}</strong>
                  {card.entries.length > 0 && (
                    <>
                      {' '}
                      ({card.entries.length} {card.entries.length === 1 ? 'entry' : 'entries'},{' '}
                      {roundHours(totalHours)}h)
                    </>
                  )}
                </p>
                <p className="timesheet-status">{statusLine(card.summary)}</p>
                {card.summary?.status === 'RETURNED' && card.summary.reviewReason && (
                  <p className="status-note danger" role="alert">
                    Organiser note: {card.summary.reviewReason}
                  </p>
                )}
                {messages[card.id] && (
                  <p className="status-note danger" role="alert">{messages[card.id]}</p>
                )}
                <div className="timesheet-actions">
                  {canSubmit && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => handleSubmit(card.id)}
                      disabled={isBusy}
                    >
                      {busy[card.id] === 'submitting'
                        ? 'Submitting...'
                        : card.summary?.status === 'RETURNED'
                          ? 'Resubmit for approval'
                          : 'Submit for approval'}
                    </button>
                  )}
                  {card.summary && card.summary.status !== 'DRAFT' && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => handleCheck(card.id)}
                      disabled={isBusy}
                    >
                      {busy[card.id] === 'checking' ? 'Checking...' : 'Check for decision'}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
