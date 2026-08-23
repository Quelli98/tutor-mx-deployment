import { useCallback, useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { createTutor, listTutors, updateTutor } from '../api/organiser'
import { EmptyState, ErrorState, LoadingState } from '../components/shared/StatusMessage'
import TutorAllocationDetails from './TutorAllocationDetails'

const MAX_AUTH0_ID_LENGTH = 100
const MAX_EMAIL_LENGTH = 254
const MAX_NAME_LENGTH = 120
const MAX_WEEKLY_HOURS = 168

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const EMPTY_FORM = { auth0Id: '', email: '', fullName: '', weeklyHours: '' }

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

  if (fields.includes('auth0Id')) {
    const auth0Id = form.auth0Id.trim()
    if (!auth0Id) {
      errors.auth0Id = 'Enter the Auth0 subject for this tutor.'
    } else if (auth0Id.length > MAX_AUTH0_ID_LENGTH) {
      errors.auth0Id = `Use ${MAX_AUTH0_ID_LENGTH} characters or fewer for the Auth0 subject.`
    }
  }

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
        setErrorMessage(safeErrorMessage(err, 'Tutors could not be loaded safely.'))
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
      auth0Id: tutor.auth0Id ?? '',
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

    const fields = editingTutor
      ? changedFields(form, editingTutor)
      : ['auth0Id', 'email', 'fullName', ...(form.weeklyHours.trim() ? ['weeklyHours'] : [])]

    const errors = validateFields(form, fields)
    setFieldErrors(errors)
    setFormError('')
    setSuccessMessage('')
    if (Object.keys(errors).length > 0) return
    if (editingTutor && fields.length === 0) return

    const payload = {}
    if (fields.includes('auth0Id')) payload.auth0Id = form.auth0Id.trim()
    if (fields.includes('email')) payload.email = form.email.trim()
    if (fields.includes('fullName')) payload.fullName = form.fullName.trim()
    if (fields.includes('weeklyHours')) payload.weeklyHours = Number(form.weeklyHours.trim())

    setFormStatus('saving')

    try {
      if (editingTutor) {
        await updateTutor({ tutorId: editingTutor.id, ...payload }, getAccessTokenSilently)
        setSuccessMessage(`${editingTutor.fullName} was updated.`)
      } else {
        await createTutor(payload, getAccessTokenSilently)
        setSuccessMessage(`${payload.fullName} was added.`)
      }

      resetForm()
      await loadTutors()
    } catch (err) {
      setFormError(safeErrorMessage(err, 'The tutor could not be saved safely.'))
    } finally {
      setFormStatus('idle')
    }
  }

  const isSaving = formStatus === 'saving'
  const pendingChanges = editingTutor ? changedFields(form, editingTutor) : []
  const submitDisabled = isSaving || Boolean(editingTutor && pendingChanges.length === 0)
  const limitAlreadySet = Boolean(editingTutor && originalWeeklyHours(editingTutor))

  return (
    <main id="main-content" className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Tutor Mx</p>
          <h1>Tutor management</h1>
          <p className="helper-text">Add tutors and keep their contact and weekly-hour details up to date.</p>
        </div>
      </header>

      <section className="role-card" aria-labelledby="tutor-form-heading">
        <form onSubmit={handleSubmit} noValidate>
          <h2 id="tutor-form-heading">
            {editingTutor ? `Edit ${editingTutor.fullName}` : 'Add a tutor'}
          </h2>

          {!editingTutor && (
            <div className="field-group">
              <label htmlFor="tutor-auth0-id">Auth0 subject</label>
              <input
                id="tutor-auth0-id"
                type="text"
                value={form.auth0Id}
                onChange={(event) => updateFormField('auth0Id', event.target.value)}
                aria-invalid={Boolean(fieldErrors.auth0Id)}
                aria-describedby={
                  ['tutor-auth0-id-help', fieldErrors.auth0Id && 'tutor-auth0-id-error']
                    .filter(Boolean)
                    .join(' ')
                }
              />
              <p id="tutor-auth0-id-help" className="helper-text">
                The tutor must sign up on Tutor Mx first. Copy their exact User ID from Auth0
                (User Management &rarr; Users), for example auth0|abc123.
              </p>
              {fieldErrors.auth0Id && (
                <p id="tutor-auth0-id-error" className="error-text">
                  {fieldErrors.auth0Id}
                </p>
              )}
            </div>
          )}

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
                ? 'Enter a new value to change the weekly-hour limit. A limit cannot be removed once it is set.'
                : 'Optional. Leave blank if the weekly-hour limit is not decided yet.'}
            </p>
            {fieldErrors.weeklyHours && (
              <p id="tutor-weekly-hours-error" className="error-text">
                {fieldErrors.weeklyHours}
              </p>
            )}
          </div>

          <div className="button-row">
            <button className="primary-button" type="submit" disabled={submitDisabled}>
              {isSaving ? 'Saving...' : editingTutor ? 'Save changes' : 'Add tutor'}
            </button>

            {editingTutor && (
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
          title="Loading tutors..."
          message="Please wait while we load the tutor list."
        />
      )}

      {status === 'error' && (
        <ErrorState title="Tutors unavailable" message={errorMessage} onRetry={() => loadTutors()} />
      )}

      {status === 'success' && tutors.length === 0 && (
        <EmptyState title="No tutors yet" message="No tutors have been set up for Tutor Mx yet." />
      )}

      {status === 'success' && tutors.length > 0 && (
        <section className="role-card" aria-labelledby="tutor-list-heading">
          <h2 id="tutor-list-heading">Tutors</h2>
          <div className="table-scroll" tabIndex="0" aria-label="Tutor list table">
            <table className="tutor-table">
              <caption>Tutors currently set up for Tutor Mx</caption>
              <thead>
                <tr>
                  <th scope="col">Full name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Weekly hours</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tutors.map((tutor) => (
                  <tr key={tutor.id}>
                    <td>{tutor.fullName}</td>
                    <td>{tutor.email}</td>
                    <td>{weeklyHoursText(tutor.weeklyHours)}</td>
                    <td>
                      <div className="button-row">
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => startEditing(tutor)}
                        >
                          Edit {tutor.fullName}
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => startManagingDetails(tutor)}
                        >
                          Manage marks and busy times for {tutor.fullName}
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
