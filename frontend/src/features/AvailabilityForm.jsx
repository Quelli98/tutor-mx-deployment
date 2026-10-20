import { useCallback, useEffect, useState } from 'react'
import { deleteOwnTimeSlot, listOwnTimeSlots, submitTimeSlot, updateOwnTimeSlot } from '../api/availability'
import { ErrorState, LoadingState } from '../components/shared/StatusMessage'
import { ConfirmationDialog } from '../components/shared/ConfirmationDialog'
import TimeSlotDetails from './TimeSlotDetails'
import OccurrenceExceptions from './OccurrenceExceptions'
import WeeklySchedule from '../components/shared/WeeklySchedule'

const EMPTY_FORM = { startsAt: '', endsAt: '', recurrence: 'ONCE', label: '', recurrenceUntil: '', category: 'UNAVAILABLE', seriesId: null }

function localValue(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  const local = new Date(date.valueOf() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function maxDurationMs(recurrence) {
  if (recurrence === 'FORTNIGHTLY') return 14 * 24 * 60 * 60 * 1000
  if (recurrence === 'WEEKLY') return 7 * 24 * 60 * 60 * 1000
  return Number.POSITIVE_INFINITY
}

function validate(form) {
  const errors = {}
  const start = new Date(form.startsAt)
  const end = new Date(form.endsAt)
  if (!form.startsAt || !Number.isFinite(start.valueOf())) errors.startsAt = 'Start time is required.'
  if (!form.endsAt || !Number.isFinite(end.valueOf())) errors.endsAt = 'End time is required.'
  else if (!errors.startsAt && end <= start) errors.endsAt = 'End time must be after the start time.'
  else if (form.recurrence !== 'ONCE' && end - start > maxDurationMs(form.recurrence)) {
    errors.endsAt = `A ${form.recurrence === 'FORTNIGHTLY' ? 'fortnightly' : 'weekly'} entry must last no more than ${form.recurrence === 'FORTNIGHTLY' ? '14' : '7'} days.`
  }
  if (form.label.length > 120) errors.label = 'Use 120 characters or fewer for the description.'
  if (form.recurrence !== 'ONCE' && form.recurrenceUntil) {
    const until = new Date(form.recurrenceUntil)
    if (!Number.isFinite(until.valueOf()) || (!errors.startsAt && until < start)) {
      errors.recurrenceUntil = 'The repeat-until date must be on or after the start date.'
    }
  }
  return errors
}

export default function AvailabilityForm({ tokenOrGetter, refreshVersion = 0, showCalendar = true, role = 'TUTOR', onChanged }) {
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
    setLoadStatus((current) => current === 'success' ? current : 'loading')
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
  }, [load, refreshVersion])

  function reset() {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setErrors({})
  }

  function edit(slot) {
    setForm({
      startsAt: localValue(slot.startsAt), endsAt: localValue(slot.endsAt),
      recurrence: slot.recurrence === 'FORTNIGHTLY' ? 'FORTNIGHTLY' : slot.recurrence === 'WEEKLY' ? 'WEEKLY' : 'ONCE',
      label: slot.label ?? '',
      recurrenceUntil: localValue(slot.recurrenceUntil),
      category: slot.category ?? 'UNAVAILABLE',
      seriesId: slot.seriesId ?? null,
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
      ...(form.recurrence !== 'ONCE' ? { recurrence: form.recurrence } : {}),
      label: form.label.trim() || null,
      recurrenceUntil: form.recurrence !== 'ONCE' && form.recurrenceUntil
        ? new Date(form.recurrenceUntil).toISOString() : null,
      category: form.category,
      seriesId: form.seriesId,
    }
    setPending(true)
    try {
      const slot = editingId
        ? await updateOwnTimeSlot(editingId, payload, tokenOrGetter)
        : await submitTimeSlot(payload, tokenOrGetter)
      setSlots((current) => [...current.filter((item) => item.id !== slot.id), slot])
      onChanged?.()
      setMessage(editingId ? 'Schedule entry updated.' : 'Schedule entry added.')
      reset()
    } catch (failure) {
      setError(failure?.message || 'Schedule entry could not be saved. Check your details and try again.')
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
      onChanged?.()
      setMessage('Schedule entry deleted.')
    } catch {
      setError('Schedule entry could not be deleted. Try again.')
    } finally {
      setPending(false)
      setSlotToDelete(null)
    }
  }

  function field(name, value) {
    setForm((current) => ({ ...current, [name]: value }))
  }

  const isRecurring = form.recurrence !== 'ONCE'

  return (
    <section className="role-card tutor-form-card" aria-labelledby="own-schedule-heading">
      <div>
        <h2 id="own-schedule-heading">Your schedule (classes, study, unavailable)</h2>
        <p className="helper-text" id="schedule-help">
          Enter the date and time for the first occurrence. Choose how often it repeats. {role === 'STUDENT' ? 'These entries record when you are busy.' : 'Schedule entries block allocations during those times.'}
        </p>
      </div>
      {showCalendar && loadStatus === 'success' && <WeeklySchedule slots={slots} label="Your weekly schedule" />}
      <form className="tutor-form schedule-editor" onSubmit={handleSubmit} noValidate aria-describedby="schedule-help">
        <h3>{editingId ? 'Edit schedule entry' : 'Add schedule entry'}</h3>
        <div className="field-group">
          <label htmlFor="slot-category">Category</label>
          <select id="slot-category" value={form.category} disabled={pending}
            onChange={(event) => field('category', event.target.value)}>
            <option value="UNAVAILABLE">Unavailable (personal commitment)</option>
            <option value="CLASS">Class (lecture, lab, tutorial)</option>
          </select>
        </div>
        <div className="field-group">
          <label htmlFor="starts-at">From (date and time)</label>
          <input id="starts-at" type="datetime-local" value={form.startsAt} disabled={pending}
            onChange={(event) => field('startsAt', event.target.value)}
            aria-invalid={Boolean(errors.startsAt)} aria-describedby={errors.startsAt ? 'starts-at-error' : undefined} />
          {errors.startsAt && <p id="starts-at-error" className="error-text">{errors.startsAt}</p>}
        </div>
        <div className="field-group">
          <label htmlFor="ends-at">Until (date and time)</label>
          <input id="ends-at" type="datetime-local" value={form.endsAt} disabled={pending}
            onChange={(event) => field('endsAt', event.target.value)}
            aria-invalid={Boolean(errors.endsAt)} aria-describedby={errors.endsAt ? 'ends-at-error' : undefined} />
          {errors.endsAt && <p id="ends-at-error" className="error-text">{errors.endsAt}</p>}
        </div>
        <div className="field-group">
          <label htmlFor="slot-label">Description (optional)</label>
          <input id="slot-label" value={form.label} maxLength={120} disabled={pending}
            onChange={(event) => field('label', event.target.value)}
            aria-invalid={Boolean(errors.label)} aria-describedby={errors.label ? 'slot-label-error' : undefined} />
          {errors.label && <p id="slot-label-error" className="error-text">{errors.label}</p>}
        </div>
        <div className="field-group">
          <label htmlFor="slot-recurrence">Repeat</label>
          <select id="slot-recurrence" value={form.recurrence} disabled={pending}
            onChange={(event) => field('recurrence', event.target.value)}>
            <option value="ONCE">Does not repeat</option>
            <option value="WEEKLY">Weekly</option>
            <option value="FORTNIGHTLY">Fortnightly</option>
          </select>
        </div>
        {isRecurring && (
          <div className="field-group">
            <label htmlFor="slot-until">Repeat until (optional)</label>
            <input id="slot-until" type="datetime-local" value={form.recurrenceUntil} disabled={pending}
              onChange={(event) => field('recurrenceUntil', event.target.value)}
              aria-invalid={Boolean(errors.recurrenceUntil)}
              aria-describedby={errors.recurrenceUntil ? 'slot-until-error' : undefined} />
            {errors.recurrenceUntil && <p id="slot-until-error" className="error-text">{errors.recurrenceUntil}</p>}
          </div>
        )}
        <div className="button-row">
          <button className="primary-button" type="submit" disabled={pending}>
            {pending ? 'Saving...' : editingId ? 'Save schedule entry' : 'Add schedule entry'}
          </button>
          {editingId && <button className="secondary-button" type="button" disabled={pending} onClick={reset}>Cancel edit</button>}
        </div>
      </form>
      {message && <p className="status-note" role="status">{message}</p>}
      {error && <p className="status-note danger" role="alert">{error}</p>}
      {loadStatus === 'loading' && <LoadingState title="Loading your schedule" message="Checking your saved schedule entries." />}
      {loadStatus === 'error' && <ErrorState title="Schedule unavailable" message="Your schedule entries could not be loaded safely." onRetry={() => load()} />}
      {loadStatus === 'success' && (slots.length === 0
        ? <p>No schedule entries have been added yet.</p>
        : <ul className="detail-record-list" aria-label="Your schedule entries">
          {slots.map((slot) => <li key={slot.id}>
            <TimeSlotDetails slot={slot} />
            <div className="button-row">
              <button type="button" className="secondary-button" disabled={pending}
                onClick={() => edit(slot)} aria-label={`Edit schedule entry ${slot.label || new Date(slot.startsAt).toLocaleString()}`}>Edit</button>
              <button type="button" className="danger-button" disabled={pending}
                onClick={() => setSlotToDelete(slot)} aria-label={`Delete schedule entry ${slot.label || new Date(slot.startsAt).toLocaleString()}`}>Delete</button>
            </div>
            {(slot.recurrence === 'WEEKLY' || slot.recurrence === 'FORTNIGHTLY') && (
              <OccurrenceExceptions slot={slot} tokenOrGetter={tokenOrGetter} disabled={pending}
                onUpdated={(updated) => {
                  setSlots((current) => current.map((item) => item.id === updated.id ? updated : item))
                  onChanged?.()
                }} />
            )}
          </li>)}
        </ul>)}
      <ConfirmationDialog open={Boolean(slotToDelete)} title="Delete schedule entry?" confirmLabel="Delete schedule entry"
        isPending={pending} onConfirm={remove} onCancel={() => { if (!pending) setSlotToDelete(null) }}>
        <p>This removes the schedule entry and all of its occurrences. This cannot be undone.</p>
      </ConfirmationDialog>
    </section>
  )
}
