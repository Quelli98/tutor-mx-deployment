import { useState } from 'react'
import {
  correctTimesheetWorkLog,
  raiseTimesheetDispute,
} from '../api/timesheetCorrections'
import { buildTimeline, formatMoment, hoursLabel } from './timesheetTimeline'

function correctionErrorMessage(error) {
  if (error?.code === 'TIMESHEET_EDIT_LOCKED') {
    return 'This week has already been submitted and cannot be corrected.'
  }
  if (error?.code === 'TIMESHEET_CORRECTION_CONFLICT') {
    return 'The correction was refused: the week changed while it was being saved, or the change breaks the weekly hours limit. Reload and try again.'
  }
  if (error?.code === 'WORK_LOG_NOT_FOUND' || error?.code === 'TIMESHEET_NOT_FOUND') {
    return 'That session is no longer part of this week. Reload the timeline.'
  }
  return 'The correction could not be saved. Try again.'
}

function disputeErrorMessage(error) {
  if (error?.code === 'TIMESHEET_DISPUTE_OPEN') {
    return 'This week already has a dispute waiting for an answer.'
  }
  if (error?.code === 'TIMESHEET_DISPUTE_NOT_ALLOWED') {
    return 'Submit the week for review before disputing a decision about it.'
  }
  return 'The dispute could not be raised. Try again.'
}

/**
 * The correction surface of one week: the ordered timeline, a correction form
 * for a week that is still editable, the declaration a resubmission needs, and
 * the objection that can be raised instead. Everything shown here comes from the
 * history read, so the forms and the timeline can never disagree about the state
 * of the week.
 */
export default function TimesheetCorrectionPanel({
  timesheetId,
  history,
  loading = false,
  tokenOrGetter,
  declared = false,
  onDeclaredChange,
  onCorrected,
  onDisputeChanged,
}) {
  const [workLogId, setWorkLogId] = useState('')
  const [hours, setHours] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(null)
  const [message, setMessage] = useState(null)
  const [disputeReason, setDisputeReason] = useState('')
  const [disputeError, setDisputeError] = useState(null)

  if (!history) {
    return loading ? (
      <div className="timesheet-history">
        <p role="status">Loading the correction timeline...</p>
      </div>
    ) : null
  }

  const timeline = buildTimeline(history)
  const openDispute = history.disputes.find((dispute) => dispute.status === 'OPEN') ?? null
  const lastDeclaration = history.declarations[history.declarations.length - 1] ?? null
  const needsDeclaration = history.timesheet.status === 'RETURNED'
  const canCorrect = history.timesheet.editable && history.workLogs.length > 0
  const selectedWorkLog =
    history.workLogs.find((workLog) => String(workLog.id) === workLogId) ?? null

  function changeWorkLog(value) {
    setWorkLogId(value)
    const workLog = history.workLogs.find((entry) => String(entry.id) === value)
    setHours(workLog ? String(workLog.hours) : '')
    setDescription(workLog ? workLog.description : '')
  }

  function validate() {
    const nextErrors = {}
    if (!selectedWorkLog) nextErrors.workLogId = 'Select the session you are correcting.'

    const hoursNumber = Number(hours)
    if (hours === '') {
      nextErrors.hours = 'Corrected hours are required.'
    } else if (!Number.isFinite(hoursNumber) || hoursNumber <= 0) {
      nextErrors.hours = 'Hours must be a positive number.'
    } else if (hoursNumber > 24) {
      nextErrors.hours = 'Hours cannot exceed 24 for a single session.'
    }
    if (!description.trim()) nextErrors.description = 'Description is required.'

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  async function handleCorrect(event) {
    event.preventDefault()
    if (!validate()) return

    setBusy('correcting')
    setMessage(null)
    try {
      await correctTimesheetWorkLog(
        timesheetId,
        selectedWorkLog.id,
        { hours: Number(hours), description: description.trim() },
        tokenOrGetter,
      )
      setMessage('Correction saved. The figures it replaced stay in the timeline.')
      setWorkLogId('')
      setHours('')
      setDescription('')
      onCorrected()
    } catch (error) {
      setMessage(correctionErrorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  async function handleDispute(event) {
    event.preventDefault()
    if (!disputeReason.trim()) {
      setDisputeError('Explain what you are disputing.')
      return
    }

    setBusy('disputing')
    setDisputeError(null)
    setMessage(null)
    try {
      await raiseTimesheetDispute(timesheetId, disputeReason.trim(), tokenOrGetter)
      setDisputeReason('')
      setMessage('Your dispute has been sent to the organiser.')
      onDisputeChanged()
    } catch (error) {
      setDisputeError(disputeErrorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="timesheet-history">
      <h4>Return and correction timeline</h4>
      {timeline.length === 0 ? (
        <p>Nothing has been returned or corrected for this week yet.</p>
      ) : (
        <ol className="timesheet-timeline">
          {timeline.map((event) => (
            <li key={event.key} className={`timeline-event timeline-${event.kind.toLowerCase()}`}>
              <strong>{event.title}</strong>
              {event.detail && <span> {event.detail}</span>}
              <span className="timeline-moment">{formatMoment(event.at)}</span>
            </li>
          ))}
        </ol>
      )}

      {canCorrect && (
        <form className="tutor-form" onSubmit={handleCorrect} noValidate>
          <h4>Correct a logged session</h4>

          <label htmlFor={`correct-work-log-${timesheetId}`}>Session</label>
          <select
            id={`correct-work-log-${timesheetId}`}
            value={workLogId}
            onChange={(event) => changeWorkLog(event.target.value)}
            aria-invalid={Boolean(errors.workLogId)}
            aria-describedby={errors.workLogId ? `correct-work-log-error-${timesheetId}` : undefined}
          >
            <option value="">Select a logged session</option>
            {history.workLogs.map((workLog) => (
              <option key={workLog.id} value={workLog.id}>
                {workLog.workDate}: {hoursLabel(workLog.hours)} - {workLog.description}
              </option>
            ))}
          </select>
          {errors.workLogId && (
            <p id={`correct-work-log-error-${timesheetId}`} className="error-text">
              {errors.workLogId}
            </p>
          )}

          <label htmlFor={`correct-hours-${timesheetId}`}>Corrected hours</label>
          <input
            id={`correct-hours-${timesheetId}`}
            type="number"
            min="0.5"
            max="24"
            step="0.5"
            value={hours}
            onChange={(event) => setHours(event.target.value)}
            aria-invalid={Boolean(errors.hours)}
            aria-describedby={errors.hours ? `correct-hours-error-${timesheetId}` : undefined}
          />
          {errors.hours && (
            <p id={`correct-hours-error-${timesheetId}`} className="error-text">
              {errors.hours}
            </p>
          )}

          <label htmlFor={`correct-description-${timesheetId}`}>Corrected description</label>
          <input
            id={`correct-description-${timesheetId}`}
            type="text"
            maxLength="500"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            aria-invalid={Boolean(errors.description)}
            aria-describedby={
              errors.description ? `correct-description-error-${timesheetId}` : undefined
            }
          />
          {errors.description && (
            <p id={`correct-description-error-${timesheetId}`} className="error-text">
              {errors.description}
            </p>
          )}

          <button className="secondary-button" type="submit" disabled={busy === 'correcting'}>
            {busy === 'correcting' ? 'Saving...' : 'Save correction'}
          </button>
        </form>
      )}

      {needsDeclaration && (
        <div className="declaration-block">
          <h4>Declaration</h4>
          <p id={`declaration-statement-${timesheetId}`}>{history.declaration.statement}</p>
          <label className="declaration-check" htmlFor={`declaration-${timesheetId}`}>
            <input
              id={`declaration-${timesheetId}`}
              type="checkbox"
              checked={declared}
              onChange={(event) => onDeclaredChange?.(event.target.checked)}
              aria-describedby={`declaration-statement-${timesheetId}`}
            />
            I acknowledge this declaration.
          </label>
          {lastDeclaration && (
            <p className="helper-text">
              Last acknowledged {formatMoment(lastDeclaration.declaredAt)}.
            </p>
          )}
        </div>
      )}

      {openDispute ? (
        <p className="status-note danger" role="alert">
          Dispute open since {formatMoment(openDispute.createdAt)}: {openDispute.reason} - waiting
          for the organiser.
        </p>
      ) : (
        <form className="tutor-form" onSubmit={handleDispute} noValidate>
          <h4>Dispute this decision</h4>

          <label htmlFor={`dispute-reason-${timesheetId}`}>What are you disputing?</label>
          <input
            id={`dispute-reason-${timesheetId}`}
            type="text"
            maxLength="1000"
            value={disputeReason}
            onChange={(event) => setDisputeReason(event.target.value)}
            aria-invalid={Boolean(disputeError)}
            aria-describedby={disputeError ? `dispute-reason-error-${timesheetId}` : undefined}
          />
          {disputeError && (
            <p id={`dispute-reason-error-${timesheetId}`} className="error-text">
              {disputeError}
            </p>
          )}

          <button className="secondary-button" type="submit" disabled={busy === 'disputing'}>
            {busy === 'disputing' ? 'Raising...' : 'Raise a dispute'}
          </button>
        </form>
      )}

      {message && (
        <p className="status-note" role="status">
          {message}
        </p>
      )}
    </div>
  )
}
