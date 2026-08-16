import { useState } from 'react'
import { submitExcuse } from '../api/excuse'

function sessionLabel(allocation) {
  return `${allocation.courseCode} - ${new Date(allocation.startsAt).toLocaleString()}`
}

export default function ExcuseForm({ allocations = [], tokenOrGetter }) {
  const [allocationId, setAllocationId] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState('idle')

  function validate() {
    const nextErrors = {}
    if (!allocations.some((allocation) => String(allocation.id) === allocationId)) {
      nextErrors.allocationId = 'Please select the session you are excusing.'
    }
    if (!reason.trim()) nextErrors.reason = 'A reason is required.'
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!validate()) return

    setStatus('submitting')
    try {
      await submitExcuse(
        { allocationId: Number(allocationId), reason: reason.trim() },
        tokenOrGetter,
      )
      setStatus('success')
      setAllocationId('')
      setReason('')
    } catch {
      setStatus('error')
    }
  }

  return (
    <section className="role-card tutor-form-card">
      <form className="tutor-form" onSubmit={handleSubmit} noValidate>
        <h2>Submit a session excuse</h2>

        <label htmlFor="excuse-allocation">Session</label>
        <select
          id="excuse-allocation"
          value={allocationId}
          onChange={(event) => setAllocationId(event.target.value)}
          aria-invalid={Boolean(errors.allocationId)}
          aria-describedby={errors.allocationId ? 'excuse-allocation-error' : undefined}
        >
          <option value="">Select a future confirmed session</option>
          {allocations.map((allocation) => (
            <option key={allocation.id} value={allocation.id}>{sessionLabel(allocation)}</option>
          ))}
        </select>
        {errors.allocationId && (
          <p id="excuse-allocation-error" className="error-text">{errors.allocationId}</p>
        )}

        <label htmlFor="excuse-reason">Reason</label>
        <textarea
          id="excuse-reason"
          maxLength="1000"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          aria-invalid={Boolean(errors.reason)}
          aria-describedby={errors.reason ? 'excuse-reason-error' : undefined}
        />
        {errors.reason && <p id="excuse-reason-error" className="error-text">{errors.reason}</p>}

        <button className="primary-button" type="submit" disabled={status === 'submitting'}>
          {status === 'submitting' ? 'Submitting...' : 'Submit excuse'}
        </button>

        {status === 'success' && <p className="status-note" role="status">Excuse submitted.</p>}
        {status === 'error' && (
          <p className="status-note danger" role="alert">Excuse could not be submitted. Try again.</p>
        )}
      </form>
    </section>
  )
}
