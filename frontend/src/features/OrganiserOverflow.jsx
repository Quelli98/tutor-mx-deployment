import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { listCourses, listStaffingRequirements } from '../api/organiser'
import {
  closeOrganiserOverflowWork,
  createOrganiserOverflowWork,
  listOrganiserOverflowWork,
  updateOrganiserOverflowWork,
} from '../api/organiserOverflow'
import { EmptyState, ErrorState, LoadingState } from '../components/shared/StatusMessage'
import {
  MAX_SESSION_HOURS,
  maximumSessionLengthMessage,
  sessionLengthText,
} from '../components/shared/scheduleWeek'
import { ConfirmationDialog } from '../components/shared/ConfirmationDialog'

const EMPTY_FORM = { courseId: '', startsAt: '', endsAt: '', hours: '', closesAt: '' }

const STATUS_LABELS = {
  OPEN: 'Open',
  FILLED: 'Filled',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
}

// The server explains every one of these refusals in wording already safe to
// show; this only decides which ones to pass through and which to reword.
const SERVER_WORDED_CODES = [
  'OVERFLOW_WORK_CONFLICT',
  'OVERFLOW_WORK_STALE',
  'OVERFLOW_WORK_HAS_CLAIMS',
  'OVERFLOW_SOURCE_NOT_OPEN',
  'OVERFLOW_SOURCE_FILLED',
  'OVERFLOW_SOURCE_HOURS',
  'OVERFLOW_SOURCE_MISMATCH',
  'OVERFLOW_SOURCE_ALREADY_SENT',
  'OVERFLOW_SOURCE_ALREADY_POSTED',
  'IDEMPOTENCY_KEY_REUSED',
  'VALIDATION_ERROR',
]

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

  if (error?.code === 'OVERFLOW_WORK_NOT_FOUND') {
    return 'That overflow work no longer exists. Refresh the page and try again.'
  }

  if (error?.code === 'OVERFLOW_WORK_UNAVAILABLE') {
    return 'Overflow work is not available right now. Try again later.'
  }

  if (SERVER_WORDED_CODES.includes(error?.code)) {
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

function claimSummary(work) {
  const parts = []
  if (work.pendingClaims > 0) parts.push(`${work.pendingClaims} waiting`)
  if (work.acceptedClaims > 0) parts.push(`${work.acceptedClaims} accepted`)
  return parts.length > 0 ? parts.join(', ') : 'No claims'
}

/**
 * Shape checks, plus the value rules worth catching before a round trip. The
 * server refuses all of them too, in the same words: end after start, the
 * session maximum, hours no longer than the session, and a deadline at or
 * before the start.
 */
function validateForm(form, sourceRequirementId) {
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
  if (!form.hours.trim() || !Number.isFinite(Number(form.hours))) {
    errors.hours = 'Enter how many hours of work this is.'
  }

  if (!errors.startsAt && !errors.endsAt) {
    const startsAt = new Date(form.startsAt)
    const endsAt = new Date(form.endsAt)
    const isReal = !Number.isNaN(startsAt.valueOf()) && !Number.isNaN(endsAt.valueOf())

    if (isReal && endsAt > startsAt) {
      const windowHours = (endsAt.valueOf() - startsAt.valueOf()) / 3_600_000

      if (windowHours > MAX_SESSION_HOURS) {
        errors.endsAt = maximumSessionLengthMessage(startsAt, endsAt)
      } else if (!errors.hours && !sourceRequirementId && Number(form.hours) > windowHours) {
        // When converting from a requirement, hours can exceed the window (e.g., 8 tutor-hours in a 4-hour window with 2 tutors).
        // The backend validates against the actual shortage, so we skip this check here.
        errors.hours = `Enter hours above 0 and no more than the session length of ${sessionLengthText(startsAt, endsAt)}.`
      }

      if (form.closesAt) {
        const closesAt = new Date(form.closesAt)
        if (Number.isNaN(closesAt.valueOf()) || closesAt > startsAt) {
          errors.closesAt = 'The claim deadline must be at or before the work starts.'
        }
      }
    }
  }

  return errors
}

// Document order of the form fields, so the first refusal shown is also the
// first one a keyboard user is sent to.
const FIELD_FOCUS_ORDER = ['courseId', 'startsAt', 'endsAt', 'hours', 'closesAt']

const FIELD_IDS = {
  courseId: 'overflow-course',
  startsAt: 'overflow-starts',
  endsAt: 'overflow-ends',
  hours: 'overflow-hours',
  closesAt: 'overflow-closes',
}

export default function OrganiserOverflow() {
  const { getAccessTokenSilently } = useAuth0()
  const [status, setStatus] = useState('loading')
  const [overflowWork, setOverflowWork] = useState([])
  const [courses, setCourses] = useState([])
  const [requirements, setRequirements] = useState([])
  const [errorMessage, setErrorMessage] = useState('')

  const [form, setForm] = useState(EMPTY_FORM)
  const [editingOverflowWork, setEditingOverflowWork] = useState(null)
  const [sourceRequirementId, setSourceRequirementId] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [formStatus, setFormStatus] = useState('idle')
  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const [pendingClose, setPendingClose] = useState(null)
  const [closeStatus, setCloseStatus] = useState('idle')

  const formHeadingRef = useRef(null)
  const formErrorRef = useRef(null)
  const successMessageRef = useRef(null)
  const closePendingRef = useRef(false)
  const focusFirstErrorRef = useRef(false)
  const [formFocusRequest, setFormFocusRequest] = useState(0)

  const loadOverflowWork = useCallback(
    async (isActive = () => true) => {
      setStatus('loading')
      setErrorMessage('')

      try {
        // The shortage list comes from the staffing board's own read, so "Send
        // to overflow" only ever offers work the server currently reports as
        // unfilled.
        const [workResult, courseResult, requirementResult] = await Promise.all([
          listOrganiserOverflowWork(getAccessTokenSilently),
          listCourses(getAccessTokenSilently),
          listStaffingRequirements({ status: 'OPEN' }, getAccessTokenSilently),
        ])
        if (!isActive()) return

        setOverflowWork(workResult)
        setCourses(courseResult)
        setRequirements(requirementResult)
        setStatus('success')
      } catch (err) {
        if (!isActive()) return

        setOverflowWork([])
        setRequirements([])
        setErrorMessage(safeErrorMessage(err, 'Overflow work could not be loaded safely.'))
        setStatus('error')
      }
    },
    [getAccessTokenSilently],
  )

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadOverflowWork(() => active)
    return () => {
      active = false
    }
  }, [loadOverflowWork])

  useEffect(() => {
    if (formFocusRequest === 0) return
    // Edit and Send to overflow change the form above the table, so the
    // heading is where a keyboard user needs to continue.
    formHeadingRef.current?.focus()
  }, [formFocusRequest])

  useEffect(() => {
    if (!focusFirstErrorRef.current) return
    focusFirstErrorRef.current = false
    const firstInvalid = FIELD_FOCUS_ORDER.find((field) => fieldErrors[field])
    if (firstInvalid) {
      document.getElementById(FIELD_IDS[firstInvalid])?.focus()
    }
  }, [fieldErrors])

  useEffect(() => {
    if (closeStatus === 'pending') {
      closePendingRef.current = true
      return
    }
    if (!closePendingRef.current) return
    closePendingRef.current = false

    if (successMessage) {
      successMessageRef.current?.focus()
      return
    }

    // A refused close restores focus to its button; only take over when the
    // reload left that button removed, disabled or unfocusable.
    const activeElement = document.activeElement
    const focusWasLost =
      !activeElement ||
      activeElement === document.body ||
      !activeElement.isConnected ||
      activeElement.disabled === true

    if (focusWasLost) {
      formErrorRef.current?.focus()
    }
  }, [closeStatus, successMessage, formError])

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function resetForm({ focusHeading = false } = {}) {
    setForm(EMPTY_FORM)
    setEditingOverflowWork(null)
    setSourceRequirementId(null)
    setFieldErrors({})
    setFormError('')
    if (focusHeading) {
      // The Cancel buttons unmount with the mode they cancel, so the form
      // heading becomes the way back into the page.
      setFormFocusRequest((request) => request + 1)
    }
  }

  function startEditing(work) {
    setEditingOverflowWork(work)
    setSourceRequirementId(null)
    setForm({
      courseId: String(work.courseId),
      startsAt: dateTimeLocalValue(work.startsAt),
      endsAt: dateTimeLocalValue(work.endsAt),
      hours: String(work.hours),
      closesAt: work.closesAt ? dateTimeLocalValue(work.closesAt) : '',
    })
    setFieldErrors({})
    setFormError('')
    setSuccessMessage('')
    setFormFocusRequest((request) => request + 1)
  }

  function sendToOverflow(requirement) {
    setEditingOverflowWork(null)
    setSourceRequirementId(requirement.id)
    setForm({
      courseId: String(requirement.courseId),
      startsAt: dateTimeLocalValue(requirement.startsAt),
      endsAt: dateTimeLocalValue(requirement.endsAt),
      hours: String(Math.round(requirement.shortageHours * 100) / 100),
      closesAt: '',
    })
    setFieldErrors({})
    setFormError('')
    setSuccessMessage('')
    setFormFocusRequest((request) => request + 1)
  }

  async function handleSubmit(event) {
    event.preventDefault()

    const errors = validateForm(form, sourceRequirementId)
    setFieldErrors(errors)
    setFormError('')
    setSuccessMessage('')
    if (Object.keys(errors).length > 0) {
      focusFirstErrorRef.current = true
      return
    }

    const payload = {
      courseId: Number(form.courseId),
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: new Date(form.endsAt).toISOString(),
      hours: Number(form.hours),
      closesAt: form.closesAt === '' ? null : new Date(form.closesAt).toISOString(),
    }
    setFormStatus('saving')

    try {
      if (editingOverflowWork) {
        await updateOrganiserOverflowWork(
          {
            overflowWorkId: editingOverflowWork.id,
            ...payload,
            expectedUpdatedAt: editingOverflowWork.updatedAt,
          },
          getAccessTokenSilently,
        )
        setSuccessMessage('The overflow work was updated.')
      } else {
        await createOrganiserOverflowWork(
          { ...payload, sourceRequirementId: sourceRequirementId ?? null },
          getAccessTokenSilently,
        )
        setSuccessMessage(
          sourceRequirementId
            ? 'The staffing requirement was sent to overflow and is now visible to students.'
            : 'The overflow work was posted and is now visible to students.',
        )
      }

      resetForm()
      await loadOverflowWork()
    } catch (err) {
      if (err?.code === 'OVERFLOW_WORK_STALE') {
        // The row moved on under this form. Reload so every row shows its fresh
        // version, and let the organiser start again from what is now shown.
        setEditingOverflowWork(null)
        setSourceRequirementId(null)
        setForm(EMPTY_FORM)
        setFieldErrors({})
        setFormError(safeErrorMessage(err, 'The overflow work changed in another session.'))
        await loadOverflowWork()
      } else {
        setFormError(safeErrorMessage(err, 'The overflow work could not be saved safely.'))
      }
    } finally {
      setFormStatus('idle')
    }
  }

  function handleCancelClose() {
    if (closeStatus === 'pending') return
    setPendingClose(null)
  }

  async function handleConfirmClose() {
    if (!pendingClose || closeStatus === 'pending') return

    setCloseStatus('pending')
    setFormError('')
    setSuccessMessage('')

    try {
      await closeOrganiserOverflowWork(
        { overflowWorkId: pendingClose.id, expectedUpdatedAt: pendingClose.updatedAt },
        getAccessTokenSilently,
      )
      setSuccessMessage(`${pendingClose.courseCode} overflow work is now closed.`)
      setPendingClose(null)
      await loadOverflowWork()
    } catch (err) {
      setPendingClose(null)
      setFormError(safeErrorMessage(err, 'The overflow work could not be closed safely.'))
      if (err?.code === 'OVERFLOW_WORK_STALE') {
        await loadOverflowWork()
      }
    } finally {
      setCloseStatus('idle')
    }
  }

  const isSaving = formStatus === 'saving'
  // Only work the server still reports as short can be converted, so a filled
  // or closed requirement is never offered here.
  const unmetRequirements = requirements.filter(
    (requirement) => requirement.status === 'OPEN' && requirement.shortageHours > 0,
  )

  return (
    <main id="main-content" className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Organiser workspace</p>
          <h1>Overflow work</h1>
          <p className="helper-text">
            Post tutoring work that still needs covering, so students can volunteer for it.
          </p>
        </div>
      </header>

      <section className="role-card" aria-labelledby="overflow-form-heading">
        <form onSubmit={handleSubmit} noValidate>
          <h2 id="overflow-form-heading" ref={formHeadingRef} tabIndex={-1}>
            {editingOverflowWork
              ? `Edit ${editingOverflowWork.courseCode} overflow work`
              : sourceRequirementId
                ? `Send requirement #${sourceRequirementId} to overflow`
                : 'Post overflow work'}
          </h2>

          {sourceRequirementId && !editingOverflowWork && (
            <p className="status-note" role="status">
              The course and time stay fixed to staffing requirement #{sourceRequirementId}, and
              the hours cannot exceed what is still unfilled.
            </p>
          )}

          <div className="allocation-form">
            <div className="field-group">
              <label htmlFor="overflow-course">Course</label>
              <select
                id="overflow-course"
                value={form.courseId}
                disabled={isSaving}
                onChange={(event) => updateField('courseId', event.target.value)}
                aria-invalid={Boolean(fieldErrors.courseId)}
                aria-describedby={fieldErrors.courseId ? 'overflow-course-error' : undefined}
              >
                <option value="">Select a course</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.code} - {course.name}
                  </option>
                ))}
              </select>
              {fieldErrors.courseId && (
                <p id="overflow-course-error" className="error-text">
                  {fieldErrors.courseId}
                </p>
              )}
            </div>

            <div className="field-group">
              <label htmlFor="overflow-starts">Starts</label>
              <input
                id="overflow-starts"
                type="datetime-local"
                value={form.startsAt}
                disabled={isSaving}
                onChange={(event) => updateField('startsAt', event.target.value)}
                aria-invalid={Boolean(fieldErrors.startsAt)}
                aria-describedby={fieldErrors.startsAt ? 'overflow-starts-error' : undefined}
              />
              {fieldErrors.startsAt && (
                <p id="overflow-starts-error" className="error-text">
                  {fieldErrors.startsAt}
                </p>
              )}
            </div>

            <div className="field-group">
              <label htmlFor="overflow-ends">Ends</label>
              <input
                id="overflow-ends"
                type="datetime-local"
                value={form.endsAt}
                disabled={isSaving}
                onChange={(event) => updateField('endsAt', event.target.value)}
                aria-invalid={Boolean(fieldErrors.endsAt)}
                aria-describedby={fieldErrors.endsAt ? 'overflow-ends-error' : undefined}
              />
              {fieldErrors.endsAt && (
                <p id="overflow-ends-error" className="error-text">
                  {fieldErrors.endsAt}
                </p>
              )}
            </div>

            <div className="field-group">
              <label htmlFor="overflow-hours">Hours</label>
              <input
                id="overflow-hours"
                type="number"
                min="0"
                step="0.25"
                value={form.hours}
                disabled={isSaving}
                onChange={(event) => updateField('hours', event.target.value)}
                aria-invalid={Boolean(fieldErrors.hours)}
                aria-describedby={fieldErrors.hours ? 'overflow-hours-error' : undefined}
              />
              {fieldErrors.hours && (
                <p id="overflow-hours-error" className="error-text">
                  {fieldErrors.hours}
                </p>
              )}
            </div>
          </div>

          <div className="field-group">
            <label htmlFor="overflow-closes">Claim deadline (optional)</label>
            <input
              id="overflow-closes"
              type="datetime-local"
              value={form.closesAt}
              disabled={isSaving}
              onChange={(event) => updateField('closesAt', event.target.value)}
              aria-invalid={Boolean(fieldErrors.closesAt)}
              aria-describedby={fieldErrors.closesAt ? 'overflow-closes-error' : undefined}
            />
            {fieldErrors.closesAt && (
              <p id="overflow-closes-error" className="error-text">
                {fieldErrors.closesAt}
              </p>
            )}
          </div>

          <div className="button-row">
            <button className="primary-button" type="submit" disabled={isSaving}>
              {isSaving
                ? 'Saving...'
                : editingOverflowWork
                  ? 'Save changes'
                  : 'Post overflow work'}
            </button>

            {editingOverflowWork && (
              <button
                className="secondary-button"
                type="button"
                onClick={() => resetForm({ focusHeading: true })}
                disabled={isSaving}
              >
                Cancel edit
              </button>
            )}

            {sourceRequirementId && !editingOverflowWork && (
              <button
                className="secondary-button"
                type="button"
                onClick={() => resetForm({ focusHeading: true })}
                disabled={isSaving}
              >
                Cancel conversion
              </button>
            )}
          </div>

          {formError && (
            <p
              ref={formErrorRef}
              className="status-note danger"
              role="alert"
              tabIndex={-1}
            >
              {formError}
            </p>
          )}
        </form>
      </section>

      {successMessage && (
        <p ref={successMessageRef} className="status-note" role="status" tabIndex={-1}>
          {successMessage}
        </p>
      )}

      {status === 'success' && unmetRequirements.length > 0 && (
        <section className="role-card" aria-labelledby="overflow-convert-heading">
          <h2 id="overflow-convert-heading">Unmet staffing requirements</h2>
          <p className="helper-text">
            Work that still needs tutors can become a student opportunity without changing any
            allocation.
          </p>
          <div
            className="table-scroll"
            tabIndex="0"
            aria-label="Unmet staffing requirement table"
          >
            <table className="tutor-table">
              <caption>Tutoring work that is still unfilled</caption>
              <thead>
                <tr>
                  <th scope="col">Course</th>
                  <th scope="col">When</th>
                  <th scope="col">Shortage</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {unmetRequirements.map((requirement) => {
                  const name = `${requirement.courseCode} on ${formatDateTime(requirement.startsAt)}`

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
                      <td>
                        {/* Both numbers are derived by the server; the screen
                            only repeats them. */}
                        <div className="table-cell-stack">
                          {requirement.shortageHours} tutor hours short
                          <span className="helper-text">
                            {requirement.assignedHours} of {requirement.requiredHours} tutor hours
                            assigned
                          </span>
                        </div>
                      </td>
                      <td>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => sendToOverflow(requirement)}
                          aria-label={`Send ${name} to overflow`}
                        >
                          Send to overflow
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {status === 'loading' && (
        <LoadingState
          title="Loading overflow work..."
          message="Please wait while we load the overflow work."
        />
      )}

      {status === 'error' && (
        <ErrorState
          title="Overflow work unavailable"
          message={errorMessage}
          onRetry={() => loadOverflowWork()}
        />
      )}

      {status === 'success' && overflowWork.length === 0 && (
        <EmptyState
          title="No overflow work yet"
          message="Post work above, or send an unmet staffing requirement to overflow."
        />
      )}

      {status === 'success' && overflowWork.length > 0 && (
        <section className="role-card" aria-labelledby="overflow-list-heading">
          <h2 id="overflow-list-heading">Overflow work</h2>
          <div className="table-scroll" tabIndex="0" aria-label="Overflow work table">
            <table className="tutor-table">
              <caption>Student volunteer opportunities, open and closed</caption>
              <thead>
                <tr>
                  <th scope="col">Course</th>
                  <th scope="col">When</th>
                  <th scope="col">Hours</th>
                  <th scope="col">Status</th>
                  <th scope="col">Source</th>
                  <th scope="col">Claims</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {overflowWork.map((work) => {
                  const name = `${work.courseCode} on ${formatDateTime(work.startsAt)}`
                  const isEditable = work.status === 'OPEN'
                  const canClose = work.status === 'OPEN'

                  return (
                    <tr key={work.id}>
                      <td>
                        {work.courseCode}
                        <span className="helper-text"> {work.courseName}</span>
                      </td>
                      <td>
                        <div className="table-cell-stack">
                          {formatDateTime(work.startsAt)} to {formatDateTime(work.endsAt)}
                          <span className="helper-text">
                            {work.closesAt
                              ? `Claim by ${formatDateTime(work.closesAt)}`
                              : 'Open to claims until it starts'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="table-cell-stack">
                          {work.hours} hours
                          <span className="helper-text">
                            in a {work.windowHours}-hour session
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className={`status-badge status-${work.status.toLowerCase()}`}>
                          {STATUS_LABELS[work.status]}
                        </span>
                      </td>
                      <td>
                        {work.sourceRequirementId
                          ? `Requirement #${work.sourceRequirementId}`
                          : 'Posted manually'}
                      </td>
                      <td>{claimSummary(work)}</td>
                      <td>
                        <div className="button-row">
                          {/* Short visible text, with the full description kept
                              for screen readers so each row's buttons are still
                              distinguishable out of context. */}
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => startEditing(work)}
                            disabled={!isEditable || work.pendingClaims + work.acceptedClaims > 0}
                            aria-label={`Edit ${name}`}
                          >
                            Edit
                          </button>
                          {canClose && (
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() => setPendingClose(work)}
                              disabled={work.pendingClaims > 0}
                              aria-label={`Close ${name}`}
                            >
                              Close
                            </button>
                          )}
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
        open={Boolean(pendingClose)}
        title="Close overflow work"
        confirmLabel="Close overflow work"
        onConfirm={handleConfirmClose}
        onCancel={handleCancelClose}
        isPending={closeStatus === 'pending'}
      >
        <p>
          {pendingClose
            ? `${pendingClose.courseCode} - ${pendingClose.courseName}, ${formatDateTime(pendingClose.startsAt)}.`
            : ''}
        </p>
        <p>
          Students will no longer see this opportunity. Any claims on it must already have been
          decided.
        </p>
      </ConfirmationDialog>
    </main>
  )
}
