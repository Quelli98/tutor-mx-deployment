import { sessionDay, attendanceLabel } from '../components/shared/attendance'
import { useEffect, useMemo, useState } from 'react'
import { submitWorkLog } from '../api/workLog'
import TimesheetSection from './TimesheetSection'

const STORAGE_KEY = 'tutormx.tutorWorkLogs'

function storageKeyFor(scope) {
  return scope ? `${STORAGE_KEY}.${scope}` : STORAGE_KEY
}

function loadStoredDrafts(storageKey) {
  try {
    const raw = window.sessionStorage.getItem(storageKey)
    const stored = raw ? JSON.parse(raw) : []
    if (!Array.isArray(stored)) return []
    return stored.filter(
      (entry) =>
        Number.isInteger(entry?.id) &&
        typeof entry?.workDate === 'string' &&
        typeof entry?.hours === 'number' &&
        typeof entry?.description === 'string',
    )
  } catch {
    return []
  }
}

function persistDrafts(drafts, storageKey) {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(drafts))
  } catch {
    // A blocked or full store must not break the in-page workflow.
  }
}

function sessionLabel(allocation) {
  return `${allocation.courseCode} - ${new Date(allocation.startsAt).toLocaleString()}`
}

function hasSessionEnded(allocation) {
  return new Date() > new Date(allocation.endsAt)
}

export default function WorkLogForm({ allocations = [], tokenOrGetter, storageScope = null }) {
  const [allocationId, setAllocationId] = useState('')
  const [workDate, setWorkDate] = useState('')
  const [hours, setHours] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState('idle')
  const [draftLogs, setDraftLogs] = useState(() =>
    loadStoredDrafts(storageKeyFor(storageScope)),
  )

  const selectedAllocation = useMemo(
    () => allocations.find((allocation) => String(allocation.id) === allocationId),
    [allocationId, allocations],
  )

  function changeAllocation(value) {
    setAllocationId(value)
    const allocation = allocations.find((item) => String(item.id) === value)
    setWorkDate(allocation ? allocation.startsAt.slice(0, 10) : '')
  }

  function validate() {
    const nextErrors = {}
    if (!selectedAllocation) nextErrors.allocationId = 'Please select an assigned session.'
    else if (selectedAllocation.workLogEligible === false) nextErrors.allocationId = 'Approved sick sessions cannot have worked hours.'
    if (!workDate) {
      nextErrors.workDate = 'Date is required.'
    } else if (selectedAllocation && workDate !== sessionDay(selectedAllocation.startsAt)) {
      nextErrors.workDate = 'Date must match the selected session.'
    }

    const hoursNumber = Number(hours)
    if (hours === '') {
      nextErrors.hours = 'Hours worked is required.'
    } else if (!Number.isFinite(hoursNumber) || hoursNumber <= 0) {
      nextErrors.hours = 'Hours must be a positive number.'
    } else if (hoursNumber > 24) {
      nextErrors.hours = 'Hours cannot exceed 24 for a single session.'
    }
    if (!description.trim()) nextErrors.description = 'Description is required.'

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  useEffect(() => {
    persistDrafts(draftLogs, storageKeyFor(storageScope))
  }, [draftLogs, storageScope])

  async function handleSubmit(event) {
    event.preventDefault()
    if (!validate()) return

    setStatus('submitting')
    try {
      const saved = await submitWorkLog(
        {
          allocationId: selectedAllocation.id,
          workDate,
          hours: Number(hours),
          description: description.trim(),
        },
        tokenOrGetter,
      )
      setDraftLogs((previous) => [
        ...previous,
        { ...saved, session: sessionLabel(selectedAllocation) },
      ])
      setStatus('success')
      setAllocationId('')
      setWorkDate('')
      setHours('')
      setDescription('')
    } catch (error) {
      if (error?.code === 'TIMESHEET_LOCKED') {
        setStatus('locked')
      } else {
        setStatus('error')
      }
    }
  }

  return (
    <section className="role-card tutor-form-card">
      <form className="tutor-form" onSubmit={handleSubmit} noValidate>
        <h2>Log worked hours</h2>

        <label htmlFor="work-allocation">Session</label>
        <select
          id="work-allocation"
          value={allocationId}
          onChange={(event) => changeAllocation(event.target.value)}
          aria-invalid={Boolean(errors.allocationId)}
          aria-describedby={errors.allocationId ? 'work-allocation-error' : undefined}
        >
          <option value="">Select a confirmed session</option>
          {allocations.map((allocation) => {
            const ended = hasSessionEnded(allocation)
            return (
              <option key={allocation.id} value={allocation.id} disabled={!ended || allocation.workLogEligible === false}>
                {sessionLabel(allocation)}{allocation.workLogEligible === false ? ` — ${attendanceLabel(allocation)}` : ended ? '' : ' — Session not completed yet'}
              </option>
            )
          })}
        </select>
        {errors.allocationId && (
          <p id="work-allocation-error" className="error-text">{errors.allocationId}</p>
        )}

        <label htmlFor="work-date">Date</label>
        <input
          id="work-date"
          type="date"
          value={workDate}
          onChange={(event) => setWorkDate(event.target.value)}
          aria-invalid={Boolean(errors.workDate)}
          aria-describedby={errors.workDate ? 'work-date-error' : undefined}
        />
        {errors.workDate && <p id="work-date-error" className="error-text">{errors.workDate}</p>}

        <label htmlFor="hours">Hours worked</label>
        <input
          id="hours"
          type="number"
          min="0.5"
          max="24"
          step="0.5"
          value={hours}
          onChange={(event) => setHours(event.target.value)}
          aria-invalid={Boolean(errors.hours)}
          aria-describedby={errors.hours ? 'hours-error' : undefined}
        />
        {errors.hours && <p id="hours-error" className="error-text">{errors.hours}</p>}

        <label htmlFor="description">Description</label>
        <input
          id="description"
          type="text"
          maxLength="500"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          aria-invalid={Boolean(errors.description)}
          aria-describedby={errors.description ? 'description-error' : undefined}
        />
        {errors.description && (
          <p id="description-error" className="error-text">{errors.description}</p>
        )}

        <button className="primary-button" type="submit" disabled={status === 'submitting'}>
          {status === 'submitting' ? 'Saving...' : 'Add to draft'}
        </button>
        {status === 'locked' && (
          <p className="status-note danger" role="alert">
            This week's timesheet has already been submitted and can't be changed.
          </p>
        )}
        {status === 'error' && (
          <p className="status-note danger" role="alert">Worked hours could not be saved. Try again.</p>
        )}
      </form>

      <section className="draft-list" aria-labelledby="draft-work-log-heading">
        <h3 id="draft-work-log-heading">Draft work log</h3>
        {draftLogs.length === 0 ? (
          <p>No entries yet.</p>
        ) : (
          <ul>
            {draftLogs.map((log) => (
              <li key={log.id}>
                <strong>{log.session}</strong>: {log.workDate}, {log.hours}h - {log.description}
              </li>
            ))}
          </ul>
        )}
      </section>

      <TimesheetSection
        savedLogs={draftLogs}
        tokenOrGetter={tokenOrGetter}
        storageScope={storageScope}
      />
    </section>
  )
}
