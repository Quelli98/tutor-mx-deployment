import { useState } from 'react'
import { submitTimeSlot } from '../api/availability'

export default function AvailabilityForm({ tokenOrGetter }) {
  const [type, setType] = useState('BUSY')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [recurrence, setRecurrence] = useState('')
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState('idle')

  function validate() {
    const nextErrors = {}
    if (!startsAt) nextErrors.startsAt = 'Start time is required.'
    if (!endsAt) nextErrors.endsAt = 'End time is required.'
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      nextErrors.endsAt = 'End time must be after the start time.'
    }
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!validate()) return

    setStatus('submitting')
    try {
      await submitTimeSlot(
        {
          type,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          recurrence: recurrence || null,
        },
        tokenOrGetter,
      )
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }

  return (
    <section className="role-card tutor-form-card">
      <form className="tutor-form" onSubmit={handleSubmit} noValidate>
        <h2>Add busy time or availability</h2>

        <label htmlFor="slot-type">Type</label>
        <select id="slot-type" value={type} onChange={(event) => setType(event.target.value)}>
          <option value="BUSY">Busy</option>
          <option value="AVAILABLE">Available</option>
        </select>

        <label htmlFor="starts-at">Start</label>
        <input
          id="starts-at"
          type="datetime-local"
          value={startsAt}
          onChange={(event) => setStartsAt(event.target.value)}
          aria-invalid={Boolean(errors.startsAt)}
          aria-describedby={errors.startsAt ? 'starts-at-error' : undefined}
        />
        {errors.startsAt && <p id="starts-at-error" className="error-text">{errors.startsAt}</p>}

        <label htmlFor="ends-at">End</label>
        <input
          id="ends-at"
          type="datetime-local"
          value={endsAt}
          onChange={(event) => setEndsAt(event.target.value)}
          aria-invalid={Boolean(errors.endsAt)}
          aria-describedby={errors.endsAt ? 'ends-at-error' : undefined}
        />
        {errors.endsAt && <p id="ends-at-error" className="error-text">{errors.endsAt}</p>}

        <label htmlFor="recurrence">Recurrence</label>
        <select
          id="recurrence"
          value={recurrence}
          onChange={(event) => setRecurrence(event.target.value)}
        >
          <option value="">Does not repeat</option>
          <option value="WEEKLY">Weekly</option>
        </select>

        <button className="primary-button" type="submit" disabled={status === 'submitting'}>
          {status === 'submitting' ? 'Saving...' : 'Save availability'}
        </button>

        {status === 'success' && <p className="status-note" role="status">Availability saved.</p>}
        {status === 'error' && (
          <p className="status-note danger" role="alert">Availability could not be saved. Try again.</p>
        )}
      </form>
    </section>
  )
}
