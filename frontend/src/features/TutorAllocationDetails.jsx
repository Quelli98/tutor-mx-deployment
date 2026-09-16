import { useCallback, useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { deleteTutorMark, listCourses, listTutorMarks, listTutorTimeSlots, saveTutorMark } from '../api/organiser'
import { EmptyState, ErrorState, LoadingState } from '../components/shared/StatusMessage'
import { ConfirmationDialog } from '../components/shared/ConfirmationDialog'
import WeeklySchedule from '../components/shared/WeeklySchedule'

const EMPTY_MARK_FORM = { courseId: '', mark: '' }

function safeErrorMessage(error, fallback) {
  if (error?.code === 'TUTOR_NOT_FOUND') return 'That tutor no longer exists. Refresh the tutor list and try again.'
  if (error?.code === 'COURSE_NOT_FOUND') return 'That course no longer exists. Refresh the course list and try again.'
  if (error?.code === 'TUTOR_MARK_NOT_FOUND') return 'That mark no longer exists. Refresh the tutor details and try again.'
  if (error?.code === 'VALIDATION_ERROR') return 'Check the entered details and try again.'
  return fallback
}

function validateMark(form) {
  const errors = {}
  const courseId = Number(form.courseId)
  const mark = Number(form.mark)
  if (!Number.isInteger(courseId) || courseId <= 0) errors.courseId = 'Select a course.'
  if (!form.mark.trim() || !Number.isFinite(mark) || mark < 0 || mark > 100) errors.mark = 'Enter a mark from 0 to 100.'
  return errors
}

export default function TutorAllocationDetails({ tutor, onClose }) {
  return <TutorDetails key={tutor.id} tutor={tutor} onClose={onClose} />
}

function TutorDetails({ tutor, onClose }) {
  const { getAccessTokenSilently } = useAuth0()
  const tutorName = tutor.fullName?.trim() || tutor.email
  const [loadStates, setLoadStates] = useState({ marks: 'loading', courses: 'loading', schedule: 'loading' })
  const [courses, setCourses] = useState([])
  const [marks, setMarks] = useState([])
  const [schedule, setSchedule] = useState([])
  const [markForm, setMarkForm] = useState(EMPTY_MARK_FORM)
  const [markErrors, setMarkErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [markToRemove, setMarkToRemove] = useState(null)
  const [markRemoveStatus, setMarkRemoveStatus] = useState('idle')

  const loadDetails = useCallback(async (isActive = () => true, only) => {
    const resources = [
      ['courses', () => listCourses(getAccessTokenSilently), setCourses],
      ['marks', () => listTutorMarks(tutor.id, getAccessTokenSilently), setMarks],
      ['schedule', () => listTutorTimeSlots(tutor.id, getAccessTokenSilently), setSchedule],
    ]
    await Promise.all(resources.filter(([name]) => !only || name === only).map(async ([name, request, setData]) => {
      setLoadStates((current) => ({ ...current, [name]: 'loading' }))
      try {
        const result = await request()
        if (!isActive()) return
        setData(result)
        setLoadStates((current) => ({ ...current, [name]: 'success' }))
      } catch {
        if (!isActive()) return
        setData([])
        setLoadStates((current) => ({ ...current, [name]: 'error' }))
      }
    }))
  }, [getAccessTokenSilently, tutor.id])

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDetails(() => active)
    return () => { active = false }
  }, [loadDetails])

  async function handleMarkSubmit(event) {
    event.preventDefault()
    const errors = validateMark(markForm)
    setMarkErrors(errors)
    setFormError('')
    setSuccessMessage('')
    if (Object.keys(errors).length > 0 || saving) return
    setSaving(true)
    try {
      const savedMark = await saveTutorMark({ tutorId: tutor.id, courseId: Number(markForm.courseId), mark: Number(markForm.mark) }, getAccessTokenSilently)
      setMarks((current) => [...current.filter((item) => item.courseId !== savedMark.courseId), savedMark]
        .sort((a, b) => a.courseCode.localeCompare(b.courseCode)))
      setLoadStates((current) => ({ ...current, marks: 'success' }))
      setMarkForm(EMPTY_MARK_FORM)
      setSuccessMessage(`${savedMark.courseCode} mark was saved for ${tutorName}.`)
    } catch (error) {
      setFormError(safeErrorMessage(error, 'Unable to save the mark. Please try again.'))
    } finally {
      setSaving(false)
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
      await deleteTutorMark({ tutorId: tutor.id, courseId: markToRemove.courseId }, getAccessTokenSilently)
      setMarks((current) => current.filter((item) => item.courseId !== markToRemove.courseId))
      setSuccessMessage(`${markToRemove.courseCode} mark was removed for ${tutorName}.`)
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
          <p className="section-intro">{tutorName}</p>
        </div>
        {onClose && <button type="button" className="secondary-button" onClick={onClose}>Close</button>}
      </div>
      <div className="tutor-detail-grid">
        <section aria-labelledby="mark-form-heading">
          <h3 id="mark-form-heading">Course marks</h3>
          {loadStates.marks === 'loading' && <LoadingState title="Loading marks" message="Checking recorded course marks." />}
          {loadStates.marks === 'error' && <ErrorState title="Marks unavailable" message="Course marks could not be loaded. Your schedule is shown separately." onRetry={() => loadDetails(undefined, 'marks')} />}
          {loadStates.marks === 'success' && (marks.length === 0
            ? <EmptyState title="No mark recorded" message="Add a course mark below." />
            : <ul className="detail-record-list course-mark-list" aria-label={`Course marks for ${tutorName}`}>
              {marks.map((mark) => <li key={mark.id}>
                <div><strong>{mark.courseCode}</strong><p>{mark.courseName}</p></div>
                <span className="course-mark-value">{mark.mark}%</span>
                <button className="danger-button" type="button" disabled={saving || markRemoveStatus === 'pending'}
                  onClick={() => setMarkToRemove(mark)} aria-label={`Remove ${mark.courseCode} mark`}>Remove</button>
              </li>)}
            </ul>)}
          {loadStates.courses === 'loading' && <LoadingState title="Loading courses" message="Preparing the mark editor." />}
          {loadStates.courses === 'error' && <ErrorState title="Course editor unavailable" message="Courses could not be loaded. Recorded marks are shown separately." onRetry={() => loadDetails(undefined, 'courses')} />}
          {loadStates.courses === 'success' && <form className="inline-form" onSubmit={handleMarkSubmit} noValidate>
            <div className="field-group">
              <label htmlFor="tutor-mark-course">Course</label>
              <select id="tutor-mark-course" value={markForm.courseId}
                onChange={(event) => setMarkForm((current) => ({ ...current, courseId: event.target.value }))}
                aria-invalid={Boolean(markErrors.courseId)} aria-describedby={markErrors.courseId ? 'tutor-mark-course-error' : undefined}>
                <option value="">Select a course</option>
                {courses.map((course) => <option key={course.id} value={course.id}>{course.code} - {course.name}</option>)}
              </select>
              {markErrors.courseId && <p id="tutor-mark-course-error" className="error-text">{markErrors.courseId}</p>}
            </div>
            <div className="field-group">
              <label htmlFor="tutor-mark-value">Mark (%)</label>
              <input id="tutor-mark-value" type="number" min="0" max="100" step="any" value={markForm.mark}
                onChange={(event) => setMarkForm((current) => ({ ...current, mark: event.target.value }))}
                aria-invalid={Boolean(markErrors.mark)} aria-describedby={markErrors.mark ? 'tutor-mark-value-error' : undefined} />
              {markErrors.mark && <p id="tutor-mark-value-error" className="error-text">{markErrors.mark}</p>}
            </div>
            <button className="primary-button" type="submit" disabled={saving || markRemoveStatus === 'pending'}>{saving ? 'Saving mark...' : 'Save mark'}</button>
          </form>}
        </section>
        <section className="tutor-schedule-panel" aria-labelledby="schedule-display-heading">
          <h3 id="schedule-display-heading">Unavailable schedule</h3>
          <p className="helper-text">Schedule maintained by the Tutor</p>
          {loadStates.schedule === 'loading' && <LoadingState title="Loading schedule" message="Checking unavailable times." />}
          {loadStates.schedule === 'error' && <ErrorState title="Schedule unavailable" message="Unavailable times could not be loaded. Course marks are shown separately." onRetry={() => loadDetails(undefined, 'schedule')} />}
          {loadStates.schedule === 'success' && <WeeklySchedule slots={schedule.filter((slot) => slot.type === 'BUSY')} label={`Schedule for ${tutorName}`} />}
        </section>
      </div>
      {formError && <p className="status-note danger" role="alert">{formError}</p>}
      {successMessage && <p className="status-note" role="status">{successMessage}</p>}
      <ConfirmationDialog open={Boolean(markToRemove)} title="Remove course mark?" confirmLabel="Remove mark"
        onConfirm={handleConfirmMarkRemove} onCancel={handleCancelMarkRemove} isPending={markRemoveStatus === 'pending'}>
        <p>Remove the {markToRemove?.courseCode ?? 'course'} mark for {tutorName}? This cannot be undone.</p>
        {markToRemove && markToRemove.activeAllocationCount > 0 && <p className="status-note danger">
          {tutorName} has {markToRemove.activeAllocationCount} {markToRemove.activeAllocationCount === 1 ? 'allocation' : 'allocations'} for{' '}
          {markToRemove.courseCode}. Existing allocations stay in place, but this tutor will not appear as a candidate for that course until a mark is recorded again.
        </p>}
      </ConfirmationDialog>
    </section>
  )
}
