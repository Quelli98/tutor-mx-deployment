import { useCallback, useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import {
  createTutorTimeSlot,
  listCourses,
  listTutorMarks,
  listTutorTimeSlots,
  saveTutorMark,
} from '../api/organiser'
import { EmptyState, ErrorState, LoadingState } from '../components/shared/StatusMessage'

const EMPTY_MARK_FORM = { courseId: '', mark: '' }
const EMPTY_BUSY_FORM = { startsAt: '', endsAt: '', weekly: false }

function safeErrorMessage(error, fallback) {
  if (error?.code === 'TUTOR_NOT_FOUND') {
    return 'That tutor no longer exists. Refresh the tutor list and try again.'
  }
  if (error?.code === 'COURSE_NOT_FOUND') {
    return 'That course no longer exists. Refresh the course list and try again.'
  }
  if (error?.code === 'TIME_SLOT_CONFLICT') {
    return 'That busy time conflicts with an existing tutor record.'
  }
  if (error?.code === 'VALIDATION_ERROR') {
    return 'Check the entered details and try again.'
  }
  return fallback
}

function formatDateTime(value) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) return 'Invalid date'
  return parsed.toLocaleString()
}

function validateMark(form) {
  const errors = {}
  const courseId = Number(form.courseId)
  const mark = Number(form.mark)
  if (!Number.isInteger(courseId) || courseId <= 0) {
    errors.courseId = 'Select a course.'
  }
  if (!form.mark.trim() || !Number.isFinite(mark) || mark < 0 || mark > 100) {
    errors.mark = 'Enter a mark from 0 to 100.'
  }
  return errors
}

function validateBusyTime(form) {
  const errors = {}
  const startsAt = new Date(form.startsAt)
  const endsAt = new Date(form.endsAt)
  if (!form.startsAt || Number.isNaN(startsAt.valueOf())) {
    errors.startsAt = 'Choose a valid start date and time.'
  }
  if (!form.endsAt || Number.isNaN(endsAt.valueOf())) {
    errors.endsAt = 'Choose a valid end date and time.'
  } else if (!errors.startsAt && endsAt <= startsAt) {
    errors.endsAt = 'The end time must be later than the start time.'
  }
  return errors
}

export default function TutorAllocationDetails({ tutor, onClose }) {
  const { getAccessTokenSilently } = useAuth0()
  const [status, setStatus] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [courses, setCourses] = useState([])
  const [marks, setMarks] = useState([])
  const [timeSlots, setTimeSlots] = useState([])
  const [markForm, setMarkForm] = useState(EMPTY_MARK_FORM)
  const [markErrors, setMarkErrors] = useState({})
  const [busyForm, setBusyForm] = useState(EMPTY_BUSY_FORM)
  const [busyErrors, setBusyErrors] = useState({})
  const [saving, setSaving] = useState(null)
  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const loadDetails = useCallback(
    async (isActive = () => true) => {
      setStatus('loading')
      setErrorMessage('')
      try {
        const [courseResult, markResult, timeSlotResult] = await Promise.all([
          listCourses(getAccessTokenSilently),
          listTutorMarks(tutor.id, getAccessTokenSilently),
          listTutorTimeSlots(tutor.id, getAccessTokenSilently),
        ])
        if (!isActive()) return
        setCourses(courseResult)
        setMarks(markResult)
        setTimeSlots(timeSlotResult)
        setStatus('success')
      } catch (error) {
        if (!isActive()) return
        setCourses([])
        setMarks([])
        setTimeSlots([])
        setErrorMessage(safeErrorMessage(error, 'Tutor allocation details could not be loaded safely.'))
        setStatus('error')
      }
    },
    [getAccessTokenSilently, tutor.id],
  )

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDetails(() => active)
    return () => {
      active = false
    }
  }, [loadDetails])

  async function handleMarkSubmit(event) {
    event.preventDefault()
    const errors = validateMark(markForm)
    setMarkErrors(errors)
    setFormError('')
    setSuccessMessage('')
    if (Object.keys(errors).length > 0 || saving) return

    setSaving('mark')
    try {
      const savedMark = await saveTutorMark(
        {
          tutorId: tutor.id,
          courseId: Number(markForm.courseId),
          mark: Number(markForm.mark),
        },
        getAccessTokenSilently,
      )
      setMarks((current) =>
        [...current.filter((item) => item.courseId !== savedMark.courseId), savedMark].sort((a, b) =>
          a.courseCode.localeCompare(b.courseCode),
        ),
      )
      setMarkForm(EMPTY_MARK_FORM)
      setSuccessMessage(`${savedMark.courseCode} mark was saved for ${tutor.fullName}.`)
    } catch (error) {
      setFormError(safeErrorMessage(error, 'The tutor mark could not be saved safely.'))
    } finally {
      setSaving(null)
    }
  }

  async function handleBusySubmit(event) {
    event.preventDefault()
    const errors = validateBusyTime(busyForm)
    setBusyErrors(errors)
    setFormError('')
    setSuccessMessage('')
    if (Object.keys(errors).length > 0 || saving) return

    setSaving('busy')
    try {
      const savedSlot = await createTutorTimeSlot(
        {
          tutorId: tutor.id,
          type: 'BUSY',
          startsAt: new Date(busyForm.startsAt).toISOString(),
          endsAt: new Date(busyForm.endsAt).toISOString(),
          ...(busyForm.weekly ? { recurrence: 'WEEKLY' } : {}),
        },
        getAccessTokenSilently,
      )
      setTimeSlots((current) => [...current, savedSlot])
      setBusyForm(EMPTY_BUSY_FORM)
      setSuccessMessage(`Busy time was added for ${tutor.fullName}.`)
    } catch (error) {
      setFormError(safeErrorMessage(error, 'The busy time could not be saved safely.'))
    } finally {
      setSaving(null)
    }
  }

  return (
    <section className="role-card tutor-allocation-details" aria-labelledby="tutor-details-heading">
      <div className="candidate-results-header">
        <div>
          <h2 id="tutor-details-heading">Marks and busy times for {tutor.fullName}</h2>
          <p className="helper-text">
            These values feed the allocation board rules. Weekly-hour limits are edited in the tutor profile form.
          </p>
        </div>
        {onClose && (
          <button type="button" className="secondary-button" onClick={onClose}>
            Close tutor details
          </button>
        )}
      </div>

      {status === 'loading' && (
        <LoadingState title="Loading tutor details..." message="Marks and time slots are being loaded." />
      )}
      {status === 'error' && (
        <ErrorState title="Tutor details unavailable" message={errorMessage} onRetry={() => loadDetails()} />
      )}

      {status === 'success' && (
        <div className="tutor-detail-grid">
          <section aria-labelledby="mark-form-heading">
            <h3 id="mark-form-heading">Course marks</h3>
            <form className="inline-form" onSubmit={handleMarkSubmit} noValidate>
              <div className="field-group">
                <label htmlFor="tutor-mark-course">Course</label>
                <select
                  id="tutor-mark-course"
                  value={markForm.courseId}
                  onChange={(event) =>
                    setMarkForm((current) => ({ ...current, courseId: event.target.value }))
                  }
                  aria-invalid={Boolean(markErrors.courseId)}
                  aria-describedby={markErrors.courseId ? 'tutor-mark-course-error' : undefined}
                >
                  <option value="">Select a course</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.code} - {course.name}
                    </option>
                  ))}
                </select>
                {markErrors.courseId && (
                  <p id="tutor-mark-course-error" className="error-text">
                    {markErrors.courseId}
                  </p>
                )}
              </div>
              <div className="field-group">
                <label htmlFor="tutor-mark-value">Mark (%)</label>
                <input
                  id="tutor-mark-value"
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={markForm.mark}
                  onChange={(event) =>
                    setMarkForm((current) => ({ ...current, mark: event.target.value }))
                  }
                  aria-invalid={Boolean(markErrors.mark)}
                  aria-describedby={markErrors.mark ? 'tutor-mark-value-error' : undefined}
                />
                {markErrors.mark && (
                  <p id="tutor-mark-value-error" className="error-text">
                    {markErrors.mark}
                  </p>
                )}
              </div>
              <button className="primary-button" type="submit" disabled={Boolean(saving)}>
                {saving === 'mark' ? 'Saving mark...' : 'Save mark'}
              </button>
            </form>

            {marks.length === 0 ? (
              <EmptyState title="No marks yet" message="Add the tutor's first course mark above." />
            ) : (
              <ul className="detail-record-list" aria-label={`Course marks for ${tutor.fullName}`}>
                {marks.map((mark) => (
                  <li key={mark.id}>
                    <strong>{mark.courseCode}</strong>
                    <span>{mark.courseName}</span>
                    <span>{mark.mark}%</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="busy-form-heading">
            <h3 id="busy-form-heading">Busy times</h3>
            <form className="inline-form" onSubmit={handleBusySubmit} noValidate>
              <div className="field-group">
                <label htmlFor="busy-start">Busy from</label>
                <input
                  id="busy-start"
                  type="datetime-local"
                  value={busyForm.startsAt}
                  onChange={(event) =>
                    setBusyForm((current) => ({ ...current, startsAt: event.target.value }))
                  }
                  aria-invalid={Boolean(busyErrors.startsAt)}
                  aria-describedby={busyErrors.startsAt ? 'busy-start-error' : undefined}
                />
                {busyErrors.startsAt && (
                  <p id="busy-start-error" className="error-text">
                    {busyErrors.startsAt}
                  </p>
                )}
              </div>
              <div className="field-group">
                <label htmlFor="busy-end">Busy until</label>
                <input
                  id="busy-end"
                  type="datetime-local"
                  value={busyForm.endsAt}
                  onChange={(event) =>
                    setBusyForm((current) => ({ ...current, endsAt: event.target.value }))
                  }
                  aria-invalid={Boolean(busyErrors.endsAt)}
                  aria-describedby={busyErrors.endsAt ? 'busy-end-error' : undefined}
                />
                {busyErrors.endsAt && (
                  <p id="busy-end-error" className="error-text">
                    {busyErrors.endsAt}
                  </p>
                )}
              </div>
              <label className="checkbox-field" htmlFor="busy-weekly">
                <input
                  id="busy-weekly"
                  type="checkbox"
                  checked={busyForm.weekly}
                  onChange={(event) =>
                    setBusyForm((current) => ({ ...current, weekly: event.target.checked }))
                  }
                />
                Repeat weekly
              </label>
              <button className="primary-button" type="submit" disabled={Boolean(saving)}>
                {saving === 'busy' ? 'Saving busy time...' : 'Add busy time'}
              </button>
            </form>

            {timeSlots.length === 0 ? (
              <EmptyState title="No time slots yet" message="Add the tutor's first busy time above." />
            ) : (
              <ul className="detail-record-list" aria-label={`Time slots for ${tutor.fullName}`}>
                {timeSlots.map((slot) => (
                  <li key={slot.id}>
                    <strong>{slot.type === 'BUSY' ? 'Busy' : 'Available'}</strong>
                    <span>
                      {formatDateTime(slot.startsAt)} to {formatDateTime(slot.endsAt)}
                    </span>
                    <span>{slot.recurrence === 'WEEKLY' ? 'Repeats weekly' : 'Once-off'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {formError && (
        <p className="status-note danger" role="alert">
          {formError}
        </p>
      )}
      {successMessage && (
        <p className="status-note" role="status">
          {successMessage}
        </p>
      )}
    </section>
  )
}
