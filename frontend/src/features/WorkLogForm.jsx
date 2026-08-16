import { useMemo, useState } from 'react'
import { submitWorkLog } from '../api/workLog'

function sessionLabel(allocation) {
  return `${allocation.courseCode} - ${new Date(allocation.startsAt).toLocaleString()}`
}

export default function WorkLogForm({ allocations = [], tokenOrGetter }) {
  const [allocationId, setAllocationId] = useState('')
  const [workDate, setWorkDate] = useState('')
  const [hours, setHours] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState('idle')
  const [draftLogs, setDraftLogs] = useState([])

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
    if (!workDate) {
      nextErrors.workDate = 'Date is required.'
    } else if (selectedAllocation && workDate !== selectedAllocation.startsAt.slice(0, 10)) {
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
    } catch {
      setStatus('error')
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
          {allocations.map((allocation) => (
            <option key={allocation.id} value={allocation.id}>{sessionLabel(allocation)}</option>
          ))}
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
    </section>
  )
}
