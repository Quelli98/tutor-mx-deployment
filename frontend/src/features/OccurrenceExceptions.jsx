import { useMemo, useState } from 'react'
import { moveOccurrence, restoreOccurrence, skipOccurrence } from '../api/availability'
import { upcomingOccurrences } from '../components/shared/scheduleWeek'

function localValue(date) {
  const local = new Date(date.valueOf() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function dayLabel(occurrenceDate) {
  return new Date(`${occurrenceDate}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

function timeLabel(value) {
  return new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function describe(exception) {
  if (exception.exceptionType === 'CANCELLED' || !exception.newStartsAt) {
    return `Skipped on ${dayLabel(exception.occurrenceDate)}`
  }
  const moved = new Date(exception.newStartsAt)
  return `Moved from ${dayLabel(exception.occurrenceDate)} to ${moved.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  })}, ${timeLabel(exception.newStartsAt)}–${timeLabel(exception.newEndsAt)}`
}

/** "Change one week": skip or move a single occurrence, and put it back. */
export default function OccurrenceExceptions({ slot, tokenOrGetter, onUpdated, disabled = false }) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState('')
  const [mode, setMode] = useState('CANCELLED')
  const [newStart, setNewStart] = useState('')
  const [newEnd, setNewEnd] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const occurrences = useMemo(() => upcomingOccurrences(slot), [slot])
  const exceptions = slot.exceptions ?? []
  const name = slot.label || 'this entry'
  const formId = `change-week-${slot.id}`
  const busy = pending || disabled

  function chooseDate(value) {
    setDate(value)
    const occurrence = occurrences.find((item) => item.date === value)
    if (occurrence) {
      setNewStart(localValue(occurrence.startsAt))
      setNewEnd(localValue(occurrence.endsAt))
    }
  }

  function close() {
    setOpen(false)
    setDate('')
    setMode('CANCELLED')
  }

  async function save(event) {
    event.preventDefault()
    if (busy) return
    setError('')
    setMessage('')
    if (!date) {
      setError('Choose the week to change.')
      return
    }
    setPending(true)
    try {
      const updated = mode === 'MOVED'
        ? await moveOccurrence(slot.id, date, {
          newStartsAt: newStart && new Date(newStart).toISOString(),
          newEndsAt: newEnd && new Date(newEnd).toISOString(),
        }, tokenOrGetter)
        : await skipOccurrence(slot.id, date, tokenOrGetter)
      onUpdated(updated)
      setMessage(mode === 'MOVED' ? `Moved ${dayLabel(date)}.` : `Skipped ${dayLabel(date)}.`)
      close()
    } catch (failure) {
      setError(failure?.message || 'That week could not be changed. Try again.')
    } finally {
      setPending(false)
    }
  }

  async function restore(occurrenceDate) {
    if (busy) return
    setError('')
    setMessage('')
    setPending(true)
    try {
      onUpdated(await restoreOccurrence(slot.id, occurrenceDate, tokenOrGetter))
      setMessage(`${dayLabel(occurrenceDate)} is back to its usual time.`)
    } catch (failure) {
      setError(failure?.message || 'That week could not be restored. Try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="occurrence-exceptions">
      {exceptions.length > 0 && (
        <ul className="detail-record-list" aria-label={`Changed weeks for ${name}`}>
          {exceptions.map((exception) => (
            <li key={exception.occurrenceDate}>
              <span>{describe(exception)}</span>
              <button type="button" className="secondary-button" disabled={busy}
                onClick={() => restore(exception.occurrenceDate)}
                aria-label={`Restore ${dayLabel(exception.occurrenceDate)} for ${name}`}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
      {!open && (
        <button type="button" className="secondary-button" disabled={busy || occurrences.length === 0}
          aria-expanded="false" aria-controls={formId}
          onClick={() => { setOpen(true); setError(''); setMessage('') }}>
          Change one week
        </button>
      )}
      {open && (
        <form id={formId} className="tutor-form" onSubmit={save} noValidate aria-label={`Change one week of ${name}`}>
          <div className="field-group">
            <label htmlFor={`${formId}-date`}>Week to change</label>
            <select id={`${formId}-date`} value={date} disabled={busy} onChange={(event) => chooseDate(event.target.value)}>
              <option value="">Choose a date</option>
              {occurrences.map((occurrence) => (
                <option key={occurrence.date} value={occurrence.date}>
                  {dayLabel(occurrence.date)}, {timeLabel(occurrence.startsAt)}–{timeLabel(occurrence.endsAt)}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="field-group" disabled={busy}>
            <legend>What changes that week</legend>
            <label>
              <input type="radio" name={`${formId}-mode`} value="CANCELLED" checked={mode === 'CANCELLED'}
                onChange={() => setMode('CANCELLED')} />
              {' '}Skip it (I am free then)
            </label>
            <label>
              <input type="radio" name={`${formId}-mode`} value="MOVED" checked={mode === 'MOVED'}
                onChange={() => setMode('MOVED')} />
              {' '}Move it to another time
            </label>
          </fieldset>
          {mode === 'MOVED' && (
            <>
              <div className="field-group">
                <label htmlFor={`${formId}-start`}>New start</label>
                <input id={`${formId}-start`} type="datetime-local" value={newStart} disabled={busy}
                  onChange={(event) => setNewStart(event.target.value)} />
              </div>
              <div className="field-group">
                <label htmlFor={`${formId}-end`}>New end</label>
                <input id={`${formId}-end`} type="datetime-local" value={newEnd} disabled={busy}
                  onChange={(event) => setNewEnd(event.target.value)} />
              </div>
            </>
          )}
          <div className="button-row">
            <button type="submit" className="primary-button" disabled={busy}>
              {pending ? 'Saving...' : mode === 'MOVED' ? 'Move this week' : 'Skip this week'}
            </button>
            <button type="button" className="secondary-button" disabled={pending} onClick={close}>Cancel</button>
          </div>
        </form>
      )}
      {message && <p className="status-note" role="status">{message}</p>}
      {error && <p className="status-note danger" role="alert">{error}</p>}
    </div>
  )
}
