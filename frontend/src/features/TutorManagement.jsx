import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { listTutors, updateTutor } from '../api/organiser'
import { EmptyState, ErrorState, LoadingState } from '../components/shared/StatusMessage'
import TutorAllocationDetails from './TutorAllocationDetails'

const MAX_EMAIL_LENGTH = 254
const MAX_NAME_LENGTH = 120
const MAX_WEEKLY_HOURS = 168

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const EMPTY_FORM = { email: '', fullName: '', weeklyHours: '' }

function safeErrorMessage(error, fallback) {
  if (error?.code === 'PROFILE_NOT_FOUND') {
    return 'We could not find your organiser profile. Ask an administrator to check your account.'
  }

  if (error?.code === 'ROLE_MISMATCH') {
    return 'Your account does not have organiser access.'
  }

  if (error?.code === 'TUTOR_CONFLICT') {
    return 'A tutor with those details already exists.'
  }

  if (error?.code === 'TUTOR_NOT_FOUND') {
    return 'That tutor no longer exists. Refresh and try again.'
  }

  if (error?.code === 'VALIDATION_ERROR') {
    return 'Check the tutor details and try again.'
  }

  return fallback
}

function weeklyHoursText(weeklyHours) {
  return weeklyHours === null || weeklyHours === undefined ? 'Not set' : String(weeklyHours)
}

function originalWeeklyHours(tutor) {
  return tutor.weeklyHours === null || tutor.weeklyHours === undefined
    ? ''
    : String(tutor.weeklyHours)
}

function validateFields(form, fields) {
  const errors = {}

  if (fields.includes('email')) {
    const email = form.email.trim()
    if (!email) {
      errors.email = 'Enter an email address.'
    } else if (email.length > MAX_EMAIL_LENGTH) {
      errors.email = `Use ${MAX_EMAIL_LENGTH} characters or fewer for the email address.`
    } else if (!EMAIL_PATTERN.test(email)) {
      errors.email = 'Enter a valid email address.'
    }
  }

  if (fields.includes('fullName')) {
    const fullName = form.fullName.trim()
    if (!fullName) {
      errors.fullName = 'Enter the tutor full name.'
    } else if (fullName.length > MAX_NAME_LENGTH) {
      errors.fullName = `Use ${MAX_NAME_LENGTH} characters or fewer for the full name.`
    }
  }

  if (fields.includes('weeklyHours')) {
    const weeklyHours = Number(form.weeklyHours.trim())
    if (!Number.isFinite(weeklyHours) || weeklyHours <= 0 || weeklyHours > MAX_WEEKLY_HOURS) {
      errors.weeklyHours = `Enter weekly hours above 0 and no more than ${MAX_WEEKLY_HOURS}.`
    }
  }

  return errors
}

function changedFields(form, tutor) {
  const fields = []

  if (form.email.trim() !== tutor.email) fields.push('email')
  if (form.fullName.trim() !== tutor.fullName) fields.push('fullName')

  const weeklyHours = form.weeklyHours.trim()
  if (weeklyHours && weeklyHours !== originalWeeklyHours(tutor)) fields.push('weeklyHours')

  return fields
}

export default function TutorManagement() {
  const { getAccessTokenSilently } = useAuth0()
  const [status, setStatus] = useState('loading')
  const [tutors, setTutors] = useState([])
  const [errorMessage, setErrorMessage] = useState('')
  const [searchText, setSearchText] = useState('')

  const [form, setForm] = useState(EMPTY_FORM)
  const [editingTutor, setEditingTutor] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [formStatus, setFormStatus] = useState('idle')
  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [detailsTutor, setDetailsTutor] = useState(null)

  const loadTutors = useCallback(
    async (isActive = () => true) => {
      setStatus('loading')
      setErrorMessage('')

      try {
        const result = await listTutors(getAccessTokenSilently)
        if (!isActive()) return

        setTutors(result)
        setStatus('success')
      } catch (err) {
        if (!isActive()) return

        setTutors([])
        setErrorMessage(safeErrorMessage(err, 'Unable to load tutors. Please try again.'))
        setStatus('error')
      }
    },
    [getAccessTokenSilently],
  )

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTutors(() => active)
    return () => {
      active = false
    }
  }, [loadTutors])

  const filteredTutors = useMemo(() => {
    const query = searchText.trim().toLowerCase()
    if (!query) return tutors

    return tutors.filter(
      (tutor) =>
        tutor.fullName.toLowerCase().includes(query) || tutor.email.toLowerCase().includes(query),
    )
  }, [searchText, tutors])

  function updateFormField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function resetForm() {
    setForm(EMPTY_FORM)
    setEditingTutor(null)
    setFieldErrors({})
    setFormError('')
  }

  function startEditing(tutor) {
    setEditingTutor(tutor)
    setForm({
      email: tutor.email,
      fullName: tutor.fullName,
      weeklyHours: originalWeeklyHours(tutor),
    })
    setFieldErrors({})
    setFormError('')
    setSuccessMessage('')
  }

  function startManagingDetails(tutor) {
    setDetailsTutor(tutor)
    setSuccessMessage('')
    setFormError('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!editingTutor) return

    const fields = changedFields(form, editingTutor)
    const errors = validateFields(form, fields)
    setFieldErrors(errors)
    setFormError('')
    setSuccessMessage('')
    if (Object.keys(errors).length > 0 || fields.length === 0) return

    const payload = {}
    if (fields.includes('email')) payload.email = form.email.trim()
    if (fields.includes('fullName')) payload.fullName = form.fullName.trim()
    if (fields.includes('weeklyHours')) payload.weeklyHours = Number(form.weeklyHours.trim())

    setFormStatus('saving')

    try {
      await updateTutor({ tutorId: editingTutor.id, ...payload }, getAccessTokenSilently)
      setSuccessMessage(`${editingTutor.fullName} was updated.`)
      resetForm()
      await loadTutors()
    } catch (err) {
      setFormError(safeErrorMessage(err, 'Unable to save changes. Please try again.'))
    } finally {
      setFormStatus('idle')
    }
  }

  const isSaving = formStatus === 'saving'
  const pendingChanges = editingTutor ? changedFields(form, editingTutor) : []
  const submitDisabled = isSaving || pendingChanges.length === 0
  const limitAlreadySet = Boolean(editingTutor && originalWeeklyHours(editingTutor))

  return (
    <main id="main-content" className="dashboard-shell">
      <header className="dashboard-header tutor-management-header">
        <div>
          <h1>Tutor management</h1>
          <p className="helper-text">
            Search for a tutor by name or email below. Select Edit to manage their details and
            weekly-hour limit.
          </p>
        </div>
      </header>

      {editingTutor && (
        <section className="role-card" aria-labelledby="tutor-form-heading">
          <form onSubmit={handleSubmit} noValidate>
            <h2 id="tutor-form-heading">Edit tutor</h2>
            <p className="section-intro">{editingTutor.fullName}</p>

            <div className="field-group">
              <label htmlFor="tutor-email">Email</label>
              <input
                id="tutor-email"
                type="email"
                value={form.email}
                onChange={(event) => updateFormField('email', event.target.value)}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'tutor-email-error' : undefined}
              />
              {fieldErrors.email && (
                <p id="tutor-email-error" className="error-text">
                  {fieldErrors.email}
                </p>
              )}
            </div>

            <div className="field-group">
              <label htmlFor="tutor-full-name">Full name</label>
              <input
                id="tutor-full-name"
                type="text"
                value={form.fullName}
                onChange={(event) => updateFormField('fullName', event.target.value)}
                aria-invalid={Boolean(fieldErrors.fullName)}
                aria-describedby={fieldErrors.fullName ? 'tutor-full-name-error' : undefined}
              />
              {fieldErrors.fullName && (
                <p id="tutor-full-name-error" className="error-text">
                  {fieldErrors.fullName}
                </p>
              )}
            </div>

            <div className="field-group">
              <label htmlFor="tutor-weekly-hours">Weekly hours</label>
              <input
                id="tutor-weekly-hours"
                type="number"
                step="any"
                min="0"
                value={form.weeklyHours}
                onChange={(event) => updateFormField('weeklyHours', event.target.value)}
                aria-invalid={Boolean(fieldErrors.weeklyHours)}
                aria-describedby={
                  fieldErrors.weeklyHours ? 'tutor-weekly-hours-error' : 'tutor-weekly-hours-help'
                }
              />
              <p id="tutor-weekly-hours-help" className="helper-text">
                {limitAlreadySet
                  ? 'Enter a new weekly-hour limit.'
                  : 'Leave blank if no weekly-hour limit has been set.'}
              </p>
              {fieldErrors.weeklyHours && (
                <p id="tutor-weekly-hours-error" className="error-text">
                  {fieldErrors.weeklyHours}
                </p>
              )}
            </div>

            <div className="button-row">
              <button className="primary-button" type="submit" disabled={submitDisabled}>
                {isSaving ? 'Saving...' : 'Save changes'}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={resetForm}
                disabled={isSaving}
              >
                Cancel
              </button>
            </div>

            {formError && (
              <p className="status-note danger" role="alert">
                {formError}
              </p>
            )}
          </form>
        </section>
      )}

      {successMessage && (
        <p className="status-note" role="status">
          {successMessage}
        </p>
      )}

      {status === 'loading' && (
        <LoadingState title="Loading tutors" message="Loading tutor accounts." />
      )}

      {status === 'error' && (
        <ErrorState title="Tutors unavailable" message={errorMessage} onRetry={() => loadTutors()} />
      )}

      {status === 'success' && tutors.length === 0 && (
        <EmptyState
          title="No tutors available"
          message="Tutor accounts will appear here after registration."
        />
      )}

      {status === 'success' && tutors.length > 0 && (
        <section className="role-card tutor-list-card" aria-labelledby="tutor-list-heading">
          <div className="tutor-list-header">
            <div>
              <h2 id="tutor-list-heading">Tutors</h2>
              <p className="tutor-list-meta">
                {tutors.length} {tutors.length === 1 ? 'tutor' : 'tutors'}
              </p>
            </div>
            <div className="field-group tutor-search-field">
              <label htmlFor="tutor-search">Search tutors</label>
              <input
                id="tutor-search"
                type="search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Name or email"
              />
            </div>
          </div>

          {filteredTutors.length === 0 ? (
            <p className="empty-inline" role="status">
              No tutors found.
            </p>
          ) : (
            <div className="table-scroll" tabIndex="0" aria-label="Tutor list table">
              <table className="tutor-table" aria-label="Tutor accounts">
                <thead>
                  <tr>
                    <th scope="col">Full name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Weekly hours</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTutors.map((tutor) => (
                    <tr key={tutor.id}>
                      <td>{tutor.fullName}</td>
                      <td>{tutor.email}</td>
                      <td>{weeklyHoursText(tutor.weeklyHours)}</td>
                      <td>
                        <div className="tutor-actions">
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => startEditing(tutor)}
                            aria-label={`Edit ${tutor.fullName}`}
                          >
                            Edit
                          </button>
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => startManagingDetails(tutor)}
                            aria-label={`Manage marks and availability for ${tutor.fullName}`}
                          >
                            Marks & availability
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {detailsTutor && (
        <TutorAllocationDetails
          key={detailsTutor.id}
          tutor={detailsTutor}
          onClose={() => setDetailsTutor(null)}
        />
      )}
    </main>
  )
}
