import { useCallback, useEffect, useState } from 'react'
import { deleteOwnTimeSlot, listOwnTimeSlots, submitTimeSlot, updateOwnTimeSlot } from '../api/availability'
import { ErrorState, LoadingState } from '../components/shared/StatusMessage'
import { ConfirmationDialog } from '../components/shared/ConfirmationDialog'
import TimeSlotDetails from './TimeSlotDetails'

const EMPTY_FORM = { startsAt: '', endsAt: '', weekly: false, label: '', recurrenceUntil: '' }

function localValue(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  // datetime-local needs wall-clock time, not a truncated UTC timestamp.
  const local = new Date(date.valueOf() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function validate(form) {
  const errors = {}
  const start = new Date(form.startsAt)
  const end = new Date(form.endsAt)
  if (!form.startsAt || !Number.isFinite(start.valueOf())) errors.startsAt = 'Start time is required.'
  if (!form.endsAt || !Number.isFinite(end.valueOf())) errors.endsAt = 'End time is required.'
  else if (!errors.startsAt && end <= start) errors.endsAt = 'End time must be after the start time.'
  else if (form.weekly && end - start > 7 * 24 * 60 * 60 * 1000) {
    errors.endsAt = 'A weekly busy time must last no more than 7 days.'
  }
  if (form.label.length > 120) errors.label = 'Use 120 characters or fewer for the label.'
  if (form.weekly && form.recurrenceUntil) {
    const until = new Date(form.recurrenceUntil)
    if (!Number.isFinite(until.valueOf()) || (!errors.startsAt && until < start)) {
      errors.recurrenceUntil = 'The last recurrence start must be on or after the first start.'
    }
  }
  return errors
}

export default function AvailabilityForm({ tokenOrGetter }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [errors, setErrors] = useState({})
  const [slots, setSlots] = useState([])
  const [loadStatus, setLoadStatus] = useState('loading')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [slotToDelete, setSlotToDelete] = useState(null)

  const load = useCallback(async (isActive = () => true) => {
    setLoadStatus('loading')
    try {
      const result = await listOwnTimeSlots(tokenOrGetter)
      if (!isActive()) return
      setSlots(result.filter((slot) => slot.type === 'BUSY'))
      setLoadStatus('success')
    } catch {
      if (isActive()) setLoadStatus('error')
    }
  }, [tokenOrGetter])

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(() => active)
    return () => { active = false }
  }, [load])

  function reset() {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setErrors({})
  }

  function edit(slot) {
    setForm({
      startsAt: localValue(slot.startsAt), endsAt: localValue(slot.endsAt),
      weekly: slot.recurrence === 'WEEKLY', label: slot.label ?? '',
      recurrenceUntil: localValue(slot.recurrenceUntil),
    })
    setEditingId(slot.id)
    setErrors({})
    setError('')
    setMessage('')
    document.getElementById('starts-at')?.focus()
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (pending) return
    const nextErrors = validate(form)
    setErrors(nextErrors)
    setError('')
    setMessage('')
    if (Object.keys(nextErrors).length) return
    const payload = {
      type: 'BUSY',
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: new Date(form.endsAt).toISOString(),
      ...(form.weekly ? { recurrence: 'WEEKLY' } : {}),
      label: form.label.trim() || null,
      recurrenceUntil: form.weekly && form.recurrenceUntil
        ? new Date(form.recurrenceUntil).toISOString() : null,
    }
    setPending(true)
    try {
      const slot = editingId
        ? await updateOwnTimeSlot(editingId, payload, tokenOrGetter)
        : await submitTimeSlot(payload, tokenOrGetter)
      setSlots((current) => [...current.filter((item) => item.id !== slot.id), slot])
      setMessage(editingId ? 'Busy time updated.' : 'Busy time added.')
      reset()
    } catch {
      setError('Busy time could not be saved. Check your details and try again.')
    } finally {
      setPending(false)
    }
  }

  async function remove() {
    if (!slotToDelete || pending) return
    setPending(true)
    setError('')
    setMessage('')
    try {
      await deleteOwnTimeSlot(slotToDelete.id, tokenOrGetter)
      setSlots((current) => current.filter((slot) => slot.id !== slotToDelete.id))
      if (editingId === slotToDelete.id) reset()
      setMessage('Busy time deleted.')
    } catch {
      setError('Busy time could not be deleted. Try again.')
    } finally {
      setPending(false)
      setSlotToDelete(null)
    }
  }

  function field(name, value) {
    setForm((current) => ({ ...current, [name]: value }))
  }

  return (
    <section className="role-card tutor-form-card" aria-labelledby="own-schedule-heading">
      <div>
        <h2 id="own-schedule-heading">Your busy / class schedule</h2>
        <p className="helper-text" id="schedule-help">
          Start and end are the FIRST occurrence, in your local time. Repeat weekly continues until
          the last recurrence start (inclusive), or indefinitely when blank. Each weekly occurrence
          can last up to 7 days. Busy times block allocations; they are not available hours.
        </p>
      </div>
      <form className="tutor-form" onSubmit={handleSubmit} noValidate aria-describedby="schedule-help">
        <h3>{editingId ? 'Edit busy time' : 'Add busy time'}</h3>
        {[
          ['startsAt', 'starts-at', 'Start (first occurrence)'],
          ['endsAt', 'ends-at', 'End (first occurrence)'],
        ].map(([name, id, label]) => (
          <div className="field-group" key={name}>
            <label htmlFor={id}>{label}</label>
            <input id={id} type="datetime-local" value={form[name]} disabled={pending}
              onChange={(event) => field(name, event.target.value)}
              aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `${id}-error` : undefined} />
            {errors[name] && <p id={`${id}-error`} className="error-text">{errors[name]}</p>}
          </div>
        ))}
        <div className="field-group">
          <label htmlFor="slot-label">Class or busy label (optional)</label>
          <input id="slot-label" value={form.label} maxLength={120} disabled={pending}
            onChange={(event) => field('label', event.target.value)}
            aria-invalid={Boolean(errors.label)} aria-describedby={errors.label ? 'slot-label-error' : undefined} />
          {errors.label && <p id="slot-label-error" className="error-text">{errors.label}</p>}
        </div>
        <label className="checkbox-field" htmlFor="slot-weekly">
          <input id="slot-weekly" type="checkbox" checked={form.weekly} disabled={pending}
            onChange={(event) => field('weekly', event.target.checked)} />
          Repeat weekly
        </label>
        {form.weekly && (
          <div className="field-group">
            <label htmlFor="slot-until">Last recurrence start (optional, inclusive)</label>
            <input id="slot-until" type="datetime-local" value={form.recurrenceUntil} disabled={pending}
              onChange={(event) => field('recurrenceUntil', event.target.value)}
              aria-invalid={Boolean(errors.recurrenceUntil)}
              aria-describedby={errors.recurrenceUntil ? 'slot-until-error' : undefined} />
            {errors.recurrenceUntil && <p id="slot-until-error" className="error-text">{errors.recurrenceUntil}</p>}
          </div>
        )}
        <div className="button-row">
          <button className="primary-button" type="submit" disabled={pending}>
            {pending ? 'Saving...' : editingId ? 'Save busy time' : 'Add busy time'}
          </button>
          {editingId && <button className="secondary-button" type="button" disabled={pending} onClick={reset}>Cancel edit</button>}
        </div>
      </form>
      {message && <p className="status-note" role="status">{message}</p>}
      {error && <p className="status-note danger" role="alert">{error}</p>}
      {loadStatus === 'loading' && <LoadingState title="Loading your schedule" message="Checking your saved busy times." />}
      {loadStatus === 'error' && <ErrorState title="Schedule unavailable" message="Your busy times could not be loaded safely." onRetry={() => load()} />}
      {loadStatus === 'success' && (slots.length === 0
        ? <p>No busy times have been added by you.</p>
        : <ul className="detail-record-list" aria-label="Your busy times">
          {slots.map((slot) => <li key={slot.id}>
            <TimeSlotDetails slot={slot} />
            <div className="button-row">
              <button type="button" className="secondary-button" disabled={pending}
                onClick={() => edit(slot)} aria-label={`Edit busy time ${slot.label || new Date(slot.startsAt).toLocaleString()}`}>Edit</button>
              <button type="button" className="danger-button" disabled={pending}
                onClick={() => setSlotToDelete(slot)} aria-label={`Delete busy time ${slot.label || new Date(slot.startsAt).toLocaleString()}`}>Delete</button>
            </div>
          </li>)}
        </ul>)}
      <ConfirmationDialog open={Boolean(slotToDelete)} title="Delete busy time?" confirmLabel="Delete busy time"
        isPending={pending} onConfirm={remove} onCancel={() => { if (!pending) setSlotToDelete(null) }}>
        <p>This removes the busy time and all of its weekly occurrences. This cannot be undone.</p>
      </ConfirmationDialog>
    </section>
  )
}
