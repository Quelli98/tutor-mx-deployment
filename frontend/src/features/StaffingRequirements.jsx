import { useCallback, useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import {
  createStaffingRequirement,
  listCourses,
  listStaffingRequirements,
  setStaffingRequirementStatus,
  updateStaffingRequirement,
} from '../api/organiser'
import { EmptyState, ErrorState, LoadingState } from '../components/shared/StatusMessage'
import { ConfirmationDialog } from '../components/shared/ConfirmationDialog'

const EMPTY_FORM = { courseId: '', startsAt: '', endsAt: '', tutorsNeeded: '', notes: '' }
const EMPTY_FILTERS = { courseId: '', status: '' }

const STATUS_LABELS = {
  OPEN: 'Open',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
}

// Wording only. The server works out every number and the fill state itself.
function tutorWord(count) {
  return count === 1 ? 'tutor' : 'tutors'
}

function shortageHeadline(requirement) {
  if (requirement.fillState === 'not-being-filled') return 'Not being filled'
  if (requirement.fillState === 'fully-filled') return 'Fully filled'
  return `${requirement.shortageHours} tutor hours short`
}

function shortageDetail(requirement) {
  const needed = `${requirement.shortageTutors} more ${tutorWord(requirement.shortageTutors)} needed`

  if (requirement.fillState === 'not-being-filled') {
    return 'Closed or cancelled, so nothing is being sought.'
  }
  if (requirement.fillState === 'fully-filled') {
    return `${requirement.assignedHours} of ${requirement.requiredHours} tutor hours assigned`
  }
  if (requirement.fillState === 'unfilled') {
    return `Nothing assigned yet, ${needed}`
  }
  return `${requirement.assignedHours} of ${requirement.requiredHours} tutor hours assigned, ${needed}`
}

// Only the wording lives here. Which actions apply to which status is decided by
// the server, which refuses anything else with a conflict.
const STATUS_ACTIONS = {
  CLOSED: {
    label: 'Close',
    title: 'Close staffing requirement',
    confirmLabel: 'Close requirement',
    description: 'It will no longer be listed as wanted. You can reopen it later.',
  },
  CANCELLED: {
    label: 'Cancel',
    title: 'Cancel staffing requirement',
    confirmLabel: 'Cancel requirement',
    description: 'It will be recorded as withdrawn. You can reopen it later.',
  },
  OPEN: {
    label: 'Reopen',
    title: 'Reopen staffing requirement',
    confirmLabel: 'Reopen requirement',
    description: 'It will be listed as wanted again.',
  },
}

function safeErrorMessage(error, fallback) {
  if (error?.code === 'PROFILE_NOT_FOUND') {
    return 'We could not find your organiser profile. Ask an administrator to check your account.'
  }

  if (error?.code === 'ROLE_MISMATCH') {
    return 'Your account does not have organiser access.'
  }

  if (error?.code === 'COURSE_NOT_FOUND') {
    return 'That course no longer exists. Refresh the page and try again.'
  }

  if (error?.code === 'STAFFING_REQUIREMENT_NOT_FOUND') {
    return 'That staffing requirement no longer exists. Refresh the page and try again.'
  }

  if (error?.code === 'STAFFING_REQUIREMENTS_UNAVAILABLE') {
    return 'Staffing requirements are not available right now. Try again later.'
  }

  // The server explains what it refused and why, in wording already safe to show.
  if (error?.code === 'STAFFING_REQUIREMENT_CONFLICT' || error?.code === 'VALIDATION_ERROR') {
    return error?.message || fallback
  }

  return fallback
}

function dateTimeLocalValue(isoValue) {
  const value = new Date(isoValue)
  if (Number.isNaN(value.valueOf())) return ''
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.valueOf() - offset).toISOString().slice(0, 16)
}

function formatDateTime(isoValue) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(isoValue))
}

/**
 * Shape checks only: every field is filled in and the tutor count is a number.
 * Every rule about the values - end after start, the tutor range, whether the
 * course exists, and the required hours those add up to - belongs to the server,
 * and its answer is shown as-is.
 */
function validateForm(form) {
  const errors = {}

  if (!form.courseId) {
    errors.courseId = 'Select a course.'
  }
  if (!form.startsAt) {
    errors.startsAt = 'Choose when the work starts.'
  }
  if (!form.endsAt) {
    errors.endsAt = 'Choose when the work ends.'
  }
  if (!form.tutorsNeeded.trim() || !Number.isFinite(Number(form.tutorsNeeded))) {
    errors.tutorsNeeded = 'Enter how many tutors are needed.'
  }

  return errors
}

export default function StaffingRequirements() {
  const { getAccessTokenSilently } = useAuth0()
  const [status, setStatus] = useState('loading')
  const [requirements, setRequirements] = useState([])
  const [courses, setCourses] = useState([])
  const [errorMessage, setErrorMessage] = useState('')

  const [filters, setFilters] = useState(EMPTY_FILTERS)

  const [form, setForm] = useState(EMPTY_FORM)
  const [editingRequirement, setEditingRequirement] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [formStatus, setFormStatus] = useState('idle')
  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const [pendingChange, setPendingChange] = useState(null)
  const [changeStatus, setChangeStatus] = useState('idle')

  const loadRequirements = useCallback(
    async (activeFilters = EMPTY_FILTERS, isActive = () => true) => {
      setStatus('loading')
      setErrorMessage('')

      try {
        // The server filters and decides the order; the screen only displays it.
        const [requirementResult, courseResult] = await Promise.all([
          listStaffingRequirements(
            {
              ...(activeFilters.courseId ? { courseId: Number(activeFilters.courseId) } : {}),
              ...(activeFilters.status ? { status: activeFilters.status } : {}),
            },
            getAccessTokenSilently,
          ),
          listCourses(getAccessTokenSilently),
        ])
        if (!isActive()) return

        setRequirements(requirementResult)
        setCourses(courseResult)
        setStatus('success')
      } catch (err) {
        if (!isActive()) return

        setRequirements([])
        setErrorMessage(
          safeErrorMessage(err, 'Staffing requirements could not be loaded safely.'),
        )
        setStatus('error')
      }
    },
    [getAccessTokenSilently],
  )

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRequirements(EMPTY_FILTERS, () => active)
    return () => {
      active = false
    }
  }, [loadRequirements])

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function resetForm() {
    setForm(EMPTY_FORM)
    setEditingRequirement(null)
    setFieldErrors({})
    setFormError('')
  }

  function startEditing(requirement) {
    setEditingRequirement(requirement)
    setForm({
      courseId: String(requirement.courseId),
      startsAt: dateTimeLocalValue(requirement.startsAt),
      endsAt: dateTimeLocalValue(requirement.endsAt),
      tutorsNeeded: String(requirement.tutorsNeeded),
      notes: requirement.notes ?? '',
    })
    setFieldErrors({})
    setFormError('')
    setSuccessMessage('')
  }

  function applyFilters(event) {
    event.preventDefault()
    void loadRequirements(filters)
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS)
    void loadRequirements(EMPTY_FILTERS)
  }

  async function handleSubmit(event) {
    event.preventDefault()

    const errors = validateForm(form)
    setFieldErrors(errors)
    setFormError('')
    setSuccessMessage('')
    if (Object.keys(errors).length > 0) return

    const notes = form.notes.trim()
    const payload = {
      courseId: Number(form.courseId),
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: new Date(form.endsAt).toISOString(),
      tutorsNeeded: Number(form.tutorsNeeded),
      notes: notes === '' ? null : notes,
    }
    setFormStatus('saving')

    try {
      if (editingRequirement) {
        await updateStaffingRequirement(
          { requirementId: editingRequirement.id, ...payload },
          getAccessTokenSilently,
        )
        setSuccessMessage('The staffing requirement was updated.')
      } else {
        await createStaffingRequirement(payload, getAccessTokenSilently)
        setSuccessMessage('The staffing requirement was added.')
      }

      resetForm()
      await loadRequirements(filters)
    } catch (err) {
      setFormError(
        safeErrorMessage(err, 'The staffing requirement could not be saved safely.'),
      )
    } finally {
      setFormStatus('idle')
    }
  }

  function handleCancelChange() {
    if (changeStatus === 'pending') return
    setPendingChange(null)
  }

  async function handleConfirmChange() {
    if (!pendingChange || changeStatus === 'pending') return

    setChangeStatus('pending')
    setFormError('')
    setSuccessMessage('')

    try {
      await setStaffingRequirementStatus(
        { requirementId: pendingChange.requirement.id, status: pendingChange.status },
        getAccessTokenSilently,
      )
      setSuccessMessage(
        `${pendingChange.requirement.courseCode} is now ${STATUS_LABELS[pendingChange.status].toLowerCase()}.`,
      )
      setPendingChange(null)
      await loadRequirements(filters)
    } catch (err) {
      setFormError(
        safeErrorMessage(err, 'The staffing requirement could not be updated safely.'),
      )
      setPendingChange(null)
    } finally {
      setChangeStatus('idle')
    }
  }

  const isSaving = formStatus === 'saving'
  const pendingAction = pendingChange ? STATUS_ACTIONS[pendingChange.status] : null
  const hasFilters = Boolean(filters.courseId || filters.status)

  return (
    <main id="main-content" className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Organiser workspace</p>
          <h1>Staffing requirements</h1>
          <p className="helper-text">
            Record the tutoring work that still needs filling, so it can be staffed.
          </p>
        </div>
      </header>

      <section className="role-card" aria-labelledby="staffing-form-heading">
        <form onSubmit={handleSubmit} noValidate>
          <h2 id="staffing-form-heading">
            {editingRequirement
              ? `Edit ${editingRequirement.courseCode} requirement`
              : 'Add a staffing requirement'}
          </h2>

          <div className="allocation-form">
            <div className="field-group">
              <label htmlFor="staffing-course">Course</label>
              <select
                id="staffing-course"
                value={form.courseId}
                disabled={isSaving}
                onChange={(event) => updateField('courseId', event.target.value)}
                aria-invalid={Boolean(fieldErrors.courseId)}
                aria-describedby={fieldErrors.courseId ? 'staffing-course-error' : undefined}
              >
                <option value="">Select a course</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.code} - {course.name}
                  </option>
                ))}
              </select>
              {fieldErrors.courseId && (
                <p id="staffing-course-error" className="error-text">
                  {fieldErrors.courseId}
                </p>
              )}
            </div>

            <div className="field-group">
              <label htmlFor="staffing-starts">Starts</label>
              <input
                id="staffing-starts"
                type="datetime-local"
                value={form.startsAt}
                disabled={isSaving}
                onChange={(event) => updateField('startsAt', event.target.value)}
                aria-invalid={Boolean(fieldErrors.startsAt)}
                aria-describedby={fieldErrors.startsAt ? 'staffing-starts-error' : undefined}
              />
              {fieldErrors.startsAt && (
                <p id="staffing-starts-error" className="error-text">
                  {fieldErrors.startsAt}
                </p>
              )}
            </div>

            <div className="field-group">
              <label htmlFor="staffing-ends">Ends</label>
              <input
                id="staffing-ends"
                type="datetime-local"
                value={form.endsAt}
                disabled={isSaving}
                onChange={(event) => updateField('endsAt', event.target.value)}
                aria-invalid={Boolean(fieldErrors.endsAt)}
                aria-describedby={fieldErrors.endsAt ? 'staffing-ends-error' : undefined}
              />
              {fieldErrors.endsAt && (
                <p id="staffing-ends-error" className="error-text">
                  {fieldErrors.endsAt}
                </p>
              )}
            </div>

            <div className="field-group">
              <label htmlFor="staffing-tutors">Tutors needed</label>
              <input
                id="staffing-tutors"
                type="number"
                min="1"
                max="20"
                step="1"
                value={form.tutorsNeeded}
                disabled={isSaving}
                onChange={(event) => updateField('tutorsNeeded', event.target.value)}
                aria-invalid={Boolean(fieldErrors.tutorsNeeded)}
                aria-describedby={fieldErrors.tutorsNeeded ? 'staffing-tutors-error' : undefined}
              />
              {fieldErrors.tutorsNeeded && (
                <p id="staffing-tutors-error" className="error-text">
                  {fieldErrors.tutorsNeeded}
                </p>
              )}
            </div>
          </div>

          <div className="field-group">
            <label htmlFor="staffing-notes">Notes (optional)</label>
            <textarea
              id="staffing-notes"
              value={form.notes}
              disabled={isSaving}
              onChange={(event) => updateField('notes', event.target.value)}
            />
          </div>

          <div className="button-row">
            <button className="primary-button" type="submit" disabled={isSaving}>
              {isSaving
                ? 'Saving...'
                : editingRequirement
                  ? 'Save changes'
                  : 'Add requirement'}
            </button>

            {editingRequirement && (
              <button
                className="secondary-button"
                type="button"
                onClick={resetForm}
                disabled={isSaving}
              >
                Cancel edit
              </button>
            )}
          </div>

          {formError && (
            <p className="status-note danger" role="alert">
              {formError}
            </p>
          )}
        </form>
      </section>

      {successMessage && (
        <p className="status-note" role="status">
          {successMessage}
        </p>
      )}

      <section className="role-card" aria-labelledby="staffing-filter-heading">
        <form onSubmit={applyFilters} noValidate>
          <h2 id="staffing-filter-heading">Filter requirements</h2>

          <div className="allocation-form">
            <div className="field-group">
              <label htmlFor="staffing-filter-course">Filter by course</label>
              <select
                id="staffing-filter-course"
                value={filters.courseId}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, courseId: event.target.value }))
                }
              >
                <option value="">All courses</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.code} - {course.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-group">
              <label htmlFor="staffing-filter-status">Filter by status</label>
              <select
                id="staffing-filter-status"
                value={filters.status}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, status: event.target.value }))
                }
              >
                <option value="">All statuses</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="button-row">
            <button className="primary-button" type="submit">
              Apply filters
            </button>
            {hasFilters && (
              <button className="secondary-button" type="button" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        </form>
      </section>

      {status === 'loading' && (
        <LoadingState
          title="Loading staffing requirements..."
          message="Please wait while we load the requirements."
        />
      )}

      {status === 'error' && (
        <ErrorState
          title="Staffing requirements unavailable"
          message={errorMessage}
          onRetry={() => loadRequirements(filters)}
        />
      )}

      {status === 'success' && requirements.length === 0 && !hasFilters && (
        <EmptyState
          title="No staffing requirements yet"
          message="Add a requirement above to record work that still needs filling."
        />
      )}

      {status === 'success' && requirements.length === 0 && hasFilters && (
        <p className="empty-inline" role="status">
          No staffing requirements match these filters.
        </p>
      )}

      {status === 'success' && requirements.length > 0 && (
        <section className="role-card" aria-labelledby="staffing-list-heading">
          <h2 id="staffing-list-heading">Requirements</h2>
          <div className="table-scroll" tabIndex="0" aria-label="Staffing requirement table">
            <table className="tutor-table">
              <caption>Tutoring work recorded as needing cover</caption>
              <thead>
                <tr>
                  <th scope="col">Course</th>
                  <th scope="col">When</th>
                  <th scope="col">Tutors needed</th>
                  <th scope="col">Tutor hours</th>
                  <th scope="col">Shortage</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {requirements.map((requirement) => {
                  const name = `${requirement.courseCode} on ${formatDateTime(requirement.startsAt)}`
                  const nextStatuses =
                    requirement.status === 'OPEN' ? ['CLOSED', 'CANCELLED'] : ['OPEN']

                  return (
                    <tr key={requirement.id}>
                      <td>
                        {requirement.courseCode}
                        <span className="helper-text"> {requirement.courseName}</span>
                      </td>
                      <td>
                        {formatDateTime(requirement.startsAt)} to{' '}
                        {formatDateTime(requirement.endsAt)}
                      </td>
                      <td>{requirement.tutorsNeeded}</td>
                      <td className="table-cell-stack">
                        {/* Both numbers come from the server, which derives them;
                            the screen only repeats them. */}
                        {requirement.requiredHours} tutor hours
                        <span className="helper-text">
                          {requirement.windowHours} hours x {requirement.tutorsNeeded} tutors
                        </span>
                      </td>
                      <td className="table-cell-stack">
                        {/* Words carry the meaning; colour only reinforces it. */}
                        <span className={`fill-state fill-${requirement.fillState}`}>
                          {shortageHeadline(requirement)}
                        </span>
                        <span className="helper-text">{shortageDetail(requirement)}</span>
                      </td>
                      <td>
                        <span
                          className={`status-badge status-${requirement.status.toLowerCase()}`}
                        >
                          {STATUS_LABELS[requirement.status]}
                        </span>
                      </td>
                      <td>
                        <div className="button-row">
                          {/* Short visible text, with the full description kept
                              for screen readers so each row's buttons are still
                              distinguishable out of context. */}
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => startEditing(requirement)}
                            aria-label={`Edit ${name}`}
                          >
                            Edit
                          </button>
                          {nextStatuses.map((nextStatus) => (
                            <button
                              key={nextStatus}
                              className={
                                nextStatus === 'CANCELLED' ? 'danger-button' : 'secondary-button'
                              }
                              type="button"
                              onClick={() =>
                                setPendingChange({ requirement, status: nextStatus })
                              }
                              aria-label={`${STATUS_ACTIONS[nextStatus].label} ${name}`}
                            >
                              {STATUS_ACTIONS[nextStatus].label}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <ConfirmationDialog
        open={Boolean(pendingChange)}
        title={pendingAction ? pendingAction.title : 'Change staffing requirement'}
        confirmLabel={pendingAction ? pendingAction.confirmLabel : 'Confirm'}
        onConfirm={handleConfirmChange}
        onCancel={handleCancelChange}
        isPending={changeStatus === 'pending'}
      >
        <p>
          {pendingChange
            ? `${pendingChange.requirement.courseCode} - ${pendingChange.requirement.courseName}, ${formatDateTime(pendingChange.requirement.startsAt)}.`
            : ''}
        </p>
        <p>{pendingAction ? pendingAction.description : ''}</p>
      </ConfirmationDialog>
    </main>
  )
}
