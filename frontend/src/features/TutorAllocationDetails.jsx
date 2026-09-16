import { useCallback, useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import {
  deleteTutorMark,
  listCourses,
  listTutorMarks,
  saveTutorMark,
} from '../api/organiser'
import { listOwnTimeSlots } from '../api/availability'
import { EmptyState, ErrorState, LoadingState } from '../components/shared/StatusMessage'
import { ConfirmationDialog } from '../components/shared/ConfirmationDialog'
import TimeSlotDetails from './TimeSlotDetails'

const EMPTY_MARK_FORM = { courseId: '', mark: '' }

function safeErrorMessage(error, fallback) {
  if (error?.code === 'TUTOR_NOT_FOUND') {
    return 'That tutor no longer exists. Refresh the tutor list and try again.'
  }
  if (error?.code === 'COURSE_NOT_FOUND') {
    return 'That course no longer exists. Refresh the course list and try again.'
  }
  if (error?.code === 'TUTOR_MARK_NOT_FOUND') {
    return 'That mark no longer exists. Refresh the tutor details and try again.'
  }
  if (error?.code === 'VALIDATION_ERROR') {
    return 'Check the entered details and try again.'
  }
  return fallback
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

export default function TutorAllocationDetails({ tutor, onClose }) {
  const { getAccessTokenSilently } = useAuth0()
  const [status, setStatus] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [courses, setCourses] = useState([])
  const [marks, setMarks] = useState([])
  const [markForm, setMarkForm] = useState(EMPTY_MARK_FORM)
  const [markErrors, setMarkErrors] = useState({})
  const [saving, setSaving] = useState(null)
  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [markToRemove, setMarkToRemove] = useState(null)
  const [markRemoveStatus, setMarkRemoveStatus] = useState('idle')
  const [schedule, setSchedule] = useState([])

  const loadDetails = useCallback(
    async (isActive = () => true) => {
      setStatus('loading')
      setErrorMessage('')
      try {
        const [courseResult, markResult, scheduleResult] = await Promise.all([
          listCourses(getAccessTokenSilently),
          listTutorMarks(tutor.id, getAccessTokenSilently),
          listOwnTimeSlots(getAccessTokenSilently),
        ])
        if (!isActive()) return
        setCourses(courseResult)
        setMarks(markResult)
        setSchedule(scheduleResult.filter((slot) => slot.type === 'BUSY'))
        setStatus('success')
      } catch (error) {
        if (!isActive()) return
        setCourses([])
        setMarks([])
        setSchedule([])
        setErrorMessage(safeErrorMessage(error, 'Unable to load tutor details. Please try again.'))
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
      setFormError(safeErrorMessage(error, 'Unable to save the mark. Please try again.'))
    } finally {
      setSaving(null)
    }
  }

  function handleCancelMarkRemove() {
    if (markRemoveStatus === 'pending') return
    setMarkToRemove(null)
  }

  async function handleConfirmMarkRemove() {
    if (!markToRemove || markRemoveStatus === 'pending') return

    setMarkRemoveStatus('pending')
    setFormError('')
    setSuccessMessage('')
    try {
      await deleteTutorMark(
        { tutorId: tutor.id, courseId: markToRemove.courseId },
        getAccessTokenSilently,
      )
      setMarks((current) => current.filter((item) => item.courseId !== markToRemove.courseId))
      setSuccessMessage(`${markToRemove.courseCode} mark was removed for ${tutor.fullName}.`)
      setMarkToRemove(null)
    } catch (error) {
      setFormError(safeErrorMessage(error, 'Unable to remove the mark. Please try again.'))
      setMarkToRemove(null)
    } finally {
      setMarkRemoveStatus('idle')
    }
  }

  return (
    <section className="role-card tutor-allocation-details" aria-labelledby="tutor-details-heading">
      <div className="candidate-results-header">
        <div>
          <h2 id="tutor-details-heading">Marks & schedule</h2>
          <p className="section-intro">{tutor.fullName}</p>
        </div>
        {onClose && (
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
        )}
      </div>

      {status === 'loading' && (
        <LoadingState title="Loading tutor details" message="Loading marks and schedule." />
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
              <EmptyState title="No marks recorded" message="Add a course mark above." />
            ) : (
              <ul className="detail-record-list" aria-label={`Course marks for ${tutor.fullName}`}>
                {marks.map((mark) => (
                  <li key={mark.id}>
                    <strong>{mark.courseCode}</strong>
                    <span>{mark.courseName}</span>
                    <span>{mark.mark}%</span>
                    <button
                      className="danger-button"
                      type="button"
                      onClick={() => setMarkToRemove(mark)}
                      aria-label={`Remove ${mark.courseCode} mark`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="schedule-display-heading">
            <h3 id="schedule-display-heading">Schedule (classes, study, unavailable)</h3>
            <p className="helper-text">
              This tutor's busy schedule is managed by the tutor. Schedule entries block allocations during those times.
            </p>
            {schedule.length === 0 ? (
              <EmptyState title="No schedule entries" message="This tutor has not added any schedule entries." />
            ) : (
              <ul className="detail-record-list" aria-label={`Schedule for ${tutor.fullName}`}>
                {schedule.map((slot) => (
                  <li key={slot.id}>
                    <TimeSlotDetails slot={slot} />
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

      <ConfirmationDialog
        open={Boolean(markToRemove)}
        title="Remove course mark?"
        confirmLabel="Remove mark"
        onConfirm={handleConfirmMarkRemove}
        onCancel={handleCancelMarkRemove}
        isPending={markRemoveStatus === 'pending'}
      >
        <p>
          Remove the {markToRemove?.courseCode ?? 'course'} mark for {tutor.fullName}? This cannot
          be undone.
        </p>
        {markToRemove && markToRemove.activeAllocationCount > 0 && (
          <p className="status-note danger">
            {tutor.fullName} has {markToRemove.activeAllocationCount}{' '}
            {markToRemove.activeAllocationCount === 1 ? 'allocation' : 'allocations'} for{' '}
            {markToRemove.courseCode}. Existing allocations stay in place, but this tutor will not
            appear as a candidate for that course until a mark is recorded again.
          </p>
        )}
      </ConfirmationDialog>
    </section>
  )
}
