import { useCallback, useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { createCourse, deleteCourse, listCourses, updateCourse } from '../api/organiser'
import { EmptyState, ErrorState, LoadingState } from '../components/shared/StatusMessage'
import { ConfirmationDialog } from '../components/shared/ConfirmationDialog'

const MAX_CODE_LENGTH = 50
const MAX_NAME_LENGTH = 120

const EMPTY_FORM = { code: '', name: '', hourlyRate: '', budget: '' }

function safeErrorMessage(error, fallback) {
  if (error?.code === 'PROFILE_NOT_FOUND') {
    return 'We could not find your organiser profile. Ask an administrator to check your account.'
  }

  if (error?.code === 'ROLE_MISMATCH') {
    return 'Your account does not have organiser access.'
  }

  if (error?.code === 'VALIDATION_ERROR') {
    // The server explains exactly which value it refused, in wording already
    // safe to show.
    return error?.message || 'Check the course details and try again.'
  }

  if (error?.code === 'COURSE_DELETE_CONFLICT') {
    // The backend supplies a specific, already-safe explanation of which
    // auditable records blocked the delete; fall back to a general message.
    return (
      error?.message ||
      'This course still has historical work that must remain auditable, so it cannot be deleted. Cancel or reassign that work first.'
    )
  }

  if (error?.code === 'COURSE_CONFLICT') {
    return 'This course still has tutors, allocations or timesheets linked to it. Remove those first, then delete the course.'
  }

  return fallback
}

/**
 * Shape checks only: the text fields are filled in and a money field, if filled
 * in at all, is a number. What counts as a valid rate or budget - above zero,
 * zero or more, two decimal places - is the server's rule, and its answer is
 * shown as-is.
 */
function validateCourse({ code, name, hourlyRate, budget }) {
  const errors = {}
  const trimmedCode = code.trim()
  const trimmedName = name.trim()

  if (!trimmedCode) {
    errors.code = 'Enter a course code.'
  } else if (trimmedCode.length > MAX_CODE_LENGTH) {
    errors.code = `Use ${MAX_CODE_LENGTH} characters or fewer for the course code.`
  }

  if (!trimmedName) {
    errors.name = 'Enter a course name.'
  } else if (trimmedName.length > MAX_NAME_LENGTH) {
    errors.name = `Use ${MAX_NAME_LENGTH} characters or fewer for the course name.`
  }

  if (hourlyRate.trim() && !Number.isFinite(Number(hourlyRate))) {
    errors.hourlyRate = 'Enter the hourly rate as a number, or leave it blank.'
  }

  if (budget.trim() && !Number.isFinite(Number(budget))) {
    errors.budget = 'Enter the budget as a number, or leave it blank.'
  }

  return errors
}

// Blank clears the stored value; anything else is sent for the server to judge.
function moneyValue(text) {
  return text.trim() ? Number(text) : null
}

// Plain and the same everywhere, rather than a locale format that would read
// differently on each organiser's machine.
function moneyText(value) {
  return value === null || value === undefined ? 'Not set' : `R${value.toFixed(2)}`
}

function moneyFieldValue(value) {
  return value === null || value === undefined ? '' : String(value)
}

export default function CourseManagement() {
  const { getAccessTokenSilently } = useAuth0()
  const [status, setStatus] = useState('loading')
  const [courses, setCourses] = useState([])
  const [errorMessage, setErrorMessage] = useState('')

  const [form, setForm] = useState(EMPTY_FORM)
  const [editingCourse, setEditingCourse] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [formStatus, setFormStatus] = useState('idle')
  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const [courseToDelete, setCourseToDelete] = useState(null)
  const [deleteStatus, setDeleteStatus] = useState('idle')

  const loadCourses = useCallback(
    async (isActive = () => true) => {
      setStatus('loading')
      setErrorMessage('')

      try {
        const result = await listCourses(getAccessTokenSilently)
        if (!isActive()) return

        setCourses(result)
        setStatus('success')
      } catch (err) {
        if (!isActive()) return

        setCourses([])
        setErrorMessage(safeErrorMessage(err, 'Courses could not be loaded safely.'))
        setStatus('error')
      }
    },
    [getAccessTokenSilently],
  )

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCourses(() => active)
    return () => {
      active = false
    }
  }, [loadCourses])

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function resetForm() {
    setForm(EMPTY_FORM)
    setEditingCourse(null)
    setFieldErrors({})
    setFormError('')
  }

  function startEditing(course) {
    setEditingCourse(course)
    setForm({
      code: course.code,
      name: course.name,
      hourlyRate: moneyFieldValue(course.hourlyRate),
      budget: moneyFieldValue(course.budget),
    })
    setFieldErrors({})
    setFormError('')
    setSuccessMessage('')
  }

  async function handleSubmit(event) {
    event.preventDefault()

    const errors = validateCourse(form)
    setFieldErrors(errors)
    setFormError('')
    setSuccessMessage('')
    if (Object.keys(errors).length > 0) return

    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      hourlyRate: moneyValue(form.hourlyRate),
      budget: moneyValue(form.budget),
    }
    setFormStatus('saving')

    try {
      if (editingCourse) {
        await updateCourse({ courseId: editingCourse.id, ...payload }, getAccessTokenSilently)
        setSuccessMessage(`${payload.code} was updated.`)
      } else {
        await createCourse(payload, getAccessTokenSilently)
        setSuccessMessage(`${payload.code} was added.`)
      }

      resetForm()
      await loadCourses()
    } catch (err) {
      if (err?.code === 'COURSE_CODE_CONFLICT') {
        setFieldErrors({ code: 'That course code is already in use.' })
      } else {
        setFormError(safeErrorMessage(err, 'The course could not be saved safely.'))
      }
    } finally {
      setFormStatus('idle')
    }
  }

  function handleCancelDelete() {
    if (deleteStatus === 'pending') return
    setCourseToDelete(null)
  }

  async function handleConfirmDelete() {
    if (!courseToDelete || deleteStatus === 'pending') return

    setDeleteStatus('pending')
    setFormError('')
    setSuccessMessage('')

    try {
      await deleteCourse({ courseId: courseToDelete.id }, getAccessTokenSilently)
      setSuccessMessage(`${courseToDelete.code} was deleted.`)
      setCourseToDelete(null)
      await loadCourses()
    } catch (err) {
      setFormError(safeErrorMessage(err, 'The course could not be deleted safely.'))
      setCourseToDelete(null)
    } finally {
      setDeleteStatus('idle')
    }
  }

  const isSaving = formStatus === 'saving'

  return (
    <main id="main-content" className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Organiser workspace</p>
          <h1>Course management</h1>
          <p className="helper-text">Create and maintain the courses used across Tutor Mx.</p>
        </div>
      </header>

      <section className="role-card" aria-labelledby="course-form-heading">
        <form onSubmit={handleSubmit} noValidate>
          <h2 id="course-form-heading">
            {editingCourse ? `Edit ${editingCourse.code}` : 'Add a course'}
          </h2>

          <div className="field-group">
            <label htmlFor="course-code">Course code</label>
            <input
              id="course-code"
              type="text"
              value={form.code}
              onChange={(event) => updateField('code', event.target.value)}
              aria-invalid={Boolean(fieldErrors.code)}
              aria-describedby={fieldErrors.code ? 'course-code-error' : undefined}
            />
            {fieldErrors.code && (
              <p id="course-code-error" className="error-text">
                {fieldErrors.code}
              </p>
            )}
          </div>

          <div className="field-group">
            <label htmlFor="course-name">Course name</label>
            <input
              id="course-name"
              type="text"
              value={form.name}
              onChange={(event) => updateField('name', event.target.value)}
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? 'course-name-error' : undefined}
            />
            {fieldErrors.name && (
              <p id="course-name-error" className="error-text">
                {fieldErrors.name}
              </p>
            )}
          </div>

          <div className="field-group">
            <label htmlFor="course-rate">Hourly rate</label>
            <input
              id="course-rate"
              type="number"
              min="0"
              step="0.01"
              value={form.hourlyRate}
              onChange={(event) => updateField('hourlyRate', event.target.value)}
              aria-invalid={Boolean(fieldErrors.hourlyRate)}
              aria-describedby={
                fieldErrors.hourlyRate ? 'course-rate-error' : 'course-rate-hint'
              }
            />
            <p id="course-rate-hint" className="helper-text">
              What one tutor hour costs on this course. Leave blank if there is no rate yet.
            </p>
            {fieldErrors.hourlyRate && (
              <p id="course-rate-error" className="error-text">
                {fieldErrors.hourlyRate}
              </p>
            )}
          </div>

          <div className="field-group">
            <label htmlFor="course-budget">Budget</label>
            <input
              id="course-budget"
              type="number"
              min="0"
              step="0.01"
              value={form.budget}
              onChange={(event) => updateField('budget', event.target.value)}
              aria-invalid={Boolean(fieldErrors.budget)}
              aria-describedby={
                fieldErrors.budget ? 'course-budget-error' : 'course-budget-hint'
              }
            />
            <p id="course-budget-hint" className="helper-text">
              What this course has to spend on tutoring. Leave blank if there is no budget yet.
            </p>
            {fieldErrors.budget && (
              <p id="course-budget-error" className="error-text">
                {fieldErrors.budget}
              </p>
            )}
          </div>

          <div className="button-row">
            <button className="primary-button" type="submit" disabled={isSaving}>
              {isSaving ? 'Saving...' : editingCourse ? 'Save changes' : 'Add course'}
            </button>

            {editingCourse && (
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

      {status === 'loading' && (
        <LoadingState
          title="Loading courses..."
          message="Please wait while we load the course list."
        />
      )}

      {status === 'error' && (
        <ErrorState
          title="Courses unavailable"
          message={errorMessage}
          onRetry={() => loadCourses()}
        />
      )}

      {status === 'success' && courses.length === 0 && (
        <EmptyState
          title="No courses yet"
          message="No courses have been set up for Tutor Mx yet."
        />
      )}

      {status === 'success' && courses.length > 0 && (
        <section className="role-card" aria-labelledby="course-list-heading">
          <h2 id="course-list-heading">Courses</h2>
          <div className="table-scroll" tabIndex="0" aria-label="Course list table">
            <table className="tutor-table">
              <caption>Courses currently set up for Tutor Mx</caption>
              <thead>
                <tr>
                  <th scope="col">Course code</th>
                  <th scope="col">Course name</th>
                  <th scope="col">Hourly rate</th>
                  <th scope="col">Budget</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((course) => (
                  <tr key={course.id}>
                    <td>{course.code}</td>
                    <td>{course.name}</td>
                    <td>{moneyText(course.hourlyRate)}</td>
                    <td>{moneyText(course.budget)}</td>
                    <td>
                      <div className="button-row">
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => startEditing(course)}
                        >
                          Edit {course.code}
                        </button>
                        <button
                          className="danger-button"
                          type="button"
                          onClick={() => setCourseToDelete(course)}
                        >
                          Delete {course.code}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <ConfirmationDialog
        open={Boolean(courseToDelete)}
        title="Delete course"
        confirmLabel="Delete course"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
        isPending={deleteStatus === 'pending'}
      >
        <p>
          Are you sure you want to delete{' '}
          {courseToDelete ? `${courseToDelete.code} - ${courseToDelete.name}` : 'this course'}? This
          cannot be undone.
        </p>
      </ConfirmationDialog>
    </main>
  )
}
