import { useState } from 'react'
import { submitExcuse } from '../api/excuse'
import ExcuseStatusSection from './ExcuseStatusSection'

function sessionLabel(allocation) {
  return `${allocation.courseCode} - ${new Date(allocation.startsAt).toLocaleString()}`
}

function submitErrorMessage(error) {
  if (error?.code === 'EXCUSE_DUPLICATE') {
    return 'An excuse has already been submitted for this session.'
  }
  if (error?.code === 'ALLOCATION_NOT_FOUND') {
    return 'The session could not be excused. Choose one of your confirmed sessions.'
  }
  return 'Excuse could not be submitted. Try again.'
}

export default function ExcuseForm({ allocations = [], tokenOrGetter, storageScope = null }) {
  const [allocationId, setAllocationId] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState('idle')
  const [submitError, setSubmitError] = useState(null)
  const [submitted, setSubmitted] = useState(null)

  function validate() {
    const nextErrors = {}
    const selected = allocations.find((allocation) => String(allocation.id) === allocationId)
    if (!selected) {
      nextErrors.allocationId = 'Please select the session you are excusing.'
    } else if (selected.status !== 'CONFIRMED' || selected.excuse) {
      nextErrors.allocationId = 'Choose a confirmed session without an existing excuse.'
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
      const excuse = await submitExcuse(
        { allocationId: Number(allocationId), reason: reason.trim() },
        tokenOrGetter,
      )
      setSubmitted(excuse)
      setStatus('success')
      setAllocationId('')
      setReason('')
    } catch (error) {
      setSubmitError(submitErrorMessage(error))
      setStatus('error')
    }
  }

  return (
    <section className="role-card tutor-form-card">
      <form className="tutor-form" onSubmit={handleSubmit} noValidate>
        <h2>Submit a session excuse</h2>
        <p className="helper-text">Select the exact session missed because of sickness. You can report before, on or after its day. It stays scheduled until an organiser approves.</p>

        <label htmlFor="excuse-allocation">Session</label>
        <select
          id="excuse-allocation"
          value={allocationId}
          onChange={(event) => setAllocationId(event.target.value)}
          aria-invalid={Boolean(errors.allocationId)}
          aria-describedby={errors.allocationId ? 'excuse-allocation-error' : undefined}
        >
          <option value="">Select a confirmed session</option>
          {allocations.filter((allocation) => allocation.status === 'CONFIRMED' && !allocation.excuse).map((allocation) => (
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
          <p className="status-note danger" role="alert">{submitError}</p>
        )}
      </form>

      <ExcuseStatusSection
        submitted={submitted}
        allocations={allocations}
        tokenOrGetter={tokenOrGetter}
        storageScope={storageScope}
      />
    </section>
  )
}
