import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { listAllocationCandidates, listCourses } from '../api/organiser'
import { RuleResult } from '../components/organiser/RuleResult'
import { EmptyState, ErrorState, LoadingState } from '../components/shared/StatusMessage'

const EMPTY_FORM = {
  courseId: '',
  startsAt: '',
  endsAt: '',
  minimumMark: '65',
  requestedHours: '2',
}

function safeErrorMessage(error, fallback) {
  if (error?.code === 'PROFILE_NOT_FOUND') {
    return 'We could not find your organiser profile. Ask an administrator to check your account.'
  }
  if (error?.code === 'ROLE_MISMATCH') {
    return 'Your account does not have organiser access.'
  }
  if (error?.code === 'VALIDATION_ERROR') {
    return 'Check the allocation details and try again.'
  }
  return fallback
}

function validateBoard(form) {
  const errors = {}
  const courseId = Number(form.courseId)
  const minimumMark = Number(form.minimumMark)
  const requestedHours = Number(form.requestedHours)
  const startsAt = new Date(form.startsAt)
  const endsAt = new Date(form.endsAt)

  if (!Number.isInteger(courseId) || courseId <= 0) {
    errors.courseId = 'Select a course.'
  }
  if (!form.startsAt || Number.isNaN(startsAt.valueOf())) {
    errors.startsAt = 'Choose a valid start date and time.'
  }
  if (!form.endsAt || Number.isNaN(endsAt.valueOf())) {
    errors.endsAt = 'Choose a valid end date and time.'
  } else if (!errors.startsAt && endsAt <= startsAt) {
    errors.endsAt = 'The end time must be later than the start time.'
  }
  if (
    !form.minimumMark.trim() ||
    !Number.isFinite(minimumMark) ||
    minimumMark < 0 ||
    minimumMark > 100
  ) {
    errors.minimumMark = 'Enter a minimum mark from 0 to 100.'
  }
  if (
    !form.requestedHours.trim() ||
    !Number.isFinite(requestedHours) ||
    requestedHours <= 0 ||
    requestedHours > 24
  ) {
    errors.requestedHours = 'Enter requested hours above 0 and no more than 24.'
  }

  return errors
}

function ruleState(candidate, reasonCode) {
  if (!Array.isArray(candidate.reasonCodes)) return 'unknown'
  return candidate.reasonCodes.includes(reasonCode) ? 'fail' : 'pass'
}

function CandidateCard({ candidate, minimumMark, requestedHours, selected, onSelect }) {
  const markState = ruleState(candidate, 'insufficient-mark')
  const clashState = ruleState(candidate, 'schedule-clash')
  const hoursState = ruleState(candidate, 'hour-limit-exceeded')

  return (
    <article className={`candidate-card${selected ? ' selected' : ''}`}>
      <header className="candidate-card-header">
        <div>
          <h3>{candidate.fullName}</h3>
          <p>{candidate.isEligible ? 'Eligible for selection' : 'Not currently eligible'}</p>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={onSelect}
          disabled={!candidate.isEligible}
          aria-pressed={selected}
        >
          {selected ? 'Selected' : `Select ${candidate.fullName}`}
        </button>
      </header>

      <ul className="rule-result-list" aria-label={`Allocation checks for ${candidate.fullName}`}>
        <RuleResult
          label="Mark eligibility"
          state={markState}
          message={
            markState === 'fail'
              ? `${candidate.mark}% is below the required ${minimumMark}%.`
              : `${candidate.mark}% meets the required ${minimumMark}%.`
          }
        />
        <RuleResult
          label="Timetable clash"
          state={clashState}
          message={
            clashState === 'fail'
              ? 'A busy time or confirmed allocation overlaps this session.'
              : 'No overlapping busy time or confirmed allocation was found.'
          }
        />
        <RuleResult
          label="Weekly hours"
          state={hoursState}
          message={`${candidate.remainingHours} hours remain; ${requestedHours} hours are required.`}
        />
      </ul>
    </article>
  )
}

export default function OrganiserDashboard() {
  const { getAccessTokenSilently } = useAuth0()
  const [coursesStatus, setCoursesStatus] = useState('loading')
  const [courses, setCourses] = useState([])
  const [coursesError, setCoursesError] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [fieldErrors, setFieldErrors] = useState({})
  const [candidateStatus, setCandidateStatus] = useState('idle')
  const [candidates, setCandidates] = useState([])
  const [candidateError, setCandidateError] = useState('')
  const [selectedTutorId, setSelectedTutorId] = useState(null)
  const [saveMessage, setSaveMessage] = useState('')

  const loadCourses = useCallback(async () => {
    setCoursesStatus('loading')
    setCoursesError('')
    try {
      const result = await listCourses(getAccessTokenSilently)
      setCourses(result)
      setCoursesStatus('success')
    } catch (error) {
      setCourses([])
      setCoursesError(safeErrorMessage(error, 'Courses could not be loaded safely.'))
      setCoursesStatus('error')
    }
  }, [getAccessTokenSilently])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCourses()
  }, [loadCourses])

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.tutorId === selectedTutorId) || null,
    [candidates, selectedTutorId],
  )

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
    setCandidateStatus('idle')
    setCandidates([])
    setSelectedTutorId(null)
    setSaveMessage('')
  }

  async function handleCheckCandidates(event) {
    event.preventDefault()
    if (candidateStatus === 'loading') return
    const errors = validateBoard(form)
    setFieldErrors(errors)
    setCandidateError('')
    setSaveMessage('')
    setSelectedTutorId(null)
    if (Object.keys(errors).length > 0) return

    const input = {
      courseId: Number(form.courseId),
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: new Date(form.endsAt).toISOString(),
      minimumMark: Number(form.minimumMark),
      requestedHours: Number(form.requestedHours),
    }

    setCandidateStatus('loading')
    try {
      const result = await listAllocationCandidates(input, getAccessTokenSilently)
      setCandidates(result)
      setCandidateStatus('success')
    } catch (error) {
      setCandidates([])
      setCandidateError(
        safeErrorMessage(error, 'Candidates could not be checked safely. Please try again.'),
      )
      setCandidateStatus('error')
    }
  }

  function handleSavePlaceholder() {
    if (!selectedCandidate?.isEligible) return
    setSaveMessage(
      `${selectedCandidate.fullName} passed all three checks. The allocation is ready for the final save endpoint.`,
    )
  }

  return (
    <main id="main-content" className="dashboard-shell organiser-dashboard">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Tutor Mx</p>
          <h1>Organiser workspace</h1>
          <p className="helper-text">
            Compare tutors and rule results on one allocation board before saving.
          </p>
        </div>
      </header>

      <section className="role-card" aria-labelledby="allocation-board-heading">
        <h2 id="allocation-board-heading">Allocation board</h2>
        <form className="allocation-form" onSubmit={handleCheckCandidates} noValidate>
          <div className="field-group">
            <label htmlFor="allocation-course">Course</label>
            <select
              id="allocation-course"
              value={form.courseId}
              onChange={(event) => updateField('courseId', event.target.value)}
              disabled={coursesStatus === 'loading'}
              aria-invalid={Boolean(fieldErrors.courseId)}
              aria-describedby={fieldErrors.courseId ? 'allocation-course-error' : undefined}
            >
              <option value="">Select a course</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.code} - {course.name}
                </option>
              ))}
            </select>
            {fieldErrors.courseId && (
              <p id="allocation-course-error" className="error-text">
                {fieldErrors.courseId}
              </p>
            )}
          </div>

          <div className="field-group">
            <label htmlFor="allocation-start">Session starts</label>
            <input
              id="allocation-start"
              type="datetime-local"
              value={form.startsAt}
              onChange={(event) => updateField('startsAt', event.target.value)}
              aria-invalid={Boolean(fieldErrors.startsAt)}
              aria-describedby={fieldErrors.startsAt ? 'allocation-start-error' : undefined}
            />
            {fieldErrors.startsAt && (
              <p id="allocation-start-error" className="error-text">
                {fieldErrors.startsAt}
              </p>
            )}
          </div>

          <div className="field-group">
            <label htmlFor="allocation-end">Session ends</label>
            <input
              id="allocation-end"
              type="datetime-local"
              value={form.endsAt}
              onChange={(event) => updateField('endsAt', event.target.value)}
              aria-invalid={Boolean(fieldErrors.endsAt)}
              aria-describedby={fieldErrors.endsAt ? 'allocation-end-error' : undefined}
            />
            {fieldErrors.endsAt && (
              <p id="allocation-end-error" className="error-text">
                {fieldErrors.endsAt}
              </p>
            )}
          </div>

          <div className="field-group">
            <label htmlFor="allocation-minimum-mark">Minimum mark (%)</label>
            <input
              id="allocation-minimum-mark"
              type="number"
              min="0"
              max="100"
              step="any"
              value={form.minimumMark}
              onChange={(event) => updateField('minimumMark', event.target.value)}
              aria-invalid={Boolean(fieldErrors.minimumMark)}
              aria-describedby={
                fieldErrors.minimumMark ? 'allocation-minimum-mark-error' : undefined
              }
            />
            {fieldErrors.minimumMark && (
              <p id="allocation-minimum-mark-error" className="error-text">
                {fieldErrors.minimumMark}
              </p>
            )}
          </div>

          <div className="field-group">
            <label htmlFor="allocation-hours">Required hours</label>
            <input
              id="allocation-hours"
              type="number"
              min="0.25"
              max="24"
              step="0.25"
              value={form.requestedHours}
              onChange={(event) => updateField('requestedHours', event.target.value)}
              aria-invalid={Boolean(fieldErrors.requestedHours)}
              aria-describedby={fieldErrors.requestedHours ? 'allocation-hours-error' : undefined}
            />
            {fieldErrors.requestedHours && (
              <p id="allocation-hours-error" className="error-text">
                {fieldErrors.requestedHours}
              </p>
            )}
          </div>

          <button
            className="primary-button allocation-check-button"
            type="submit"
            disabled={
              candidateStatus === 'loading' || coursesStatus === 'loading' || courses.length === 0
            }
          >
            {candidateStatus === 'loading' ? 'Checking candidates...' : 'Check candidates'}
          </button>
        </form>
      </section>

      {coursesStatus === 'loading' && (
        <LoadingState title="Loading courses..." message="The allocation board will remain here." />
      )}
      {coursesStatus === 'error' && (
        <ErrorState title="Courses unavailable" message={coursesError} onRetry={loadCourses} />
      )}
      {coursesStatus === 'success' && courses.length === 0 && (
        <EmptyState
          title="No courses yet"
          message="Add a course in Course management before checking allocation candidates."
        />
      )}

      {candidateStatus === 'loading' && (
        <LoadingState
          title="Checking candidates..."
          message="Mark, timetable and weekly-hour rules are being checked together."
        />
      )}
      {candidateStatus === 'error' && (
        <ErrorState
          title="Candidates unavailable"
          message={candidateError}
          onRetry={() => handleCheckCandidates({ preventDefault() {} })}
        />
      )}
      {candidateStatus === 'success' && candidates.length === 0 && (
        <EmptyState
          title="No candidates found"
          message="No tutor has a mark record for this course yet. Open Tutor management, add the tutor's course mark, and check again."
        />
      )}
      {candidateStatus === 'success' && candidates.length > 0 && (
        <section className="candidate-results" aria-labelledby="candidate-results-heading">
          <div className="candidate-results-header">
            <div>
              <h2 id="candidate-results-heading">Candidate rule results</h2>
              <p>All three checks stay visible, including failed checks.</p>
            </div>
            <button
              type="button"
              className="primary-button"
              disabled={!selectedCandidate?.isEligible}
              onClick={handleSavePlaceholder}
            >
              Save allocation
            </button>
          </div>

          <div className="candidate-grid">
            {candidates.map((candidate) => (
              <CandidateCard
                key={candidate.tutorId}
                candidate={candidate}
                minimumMark={Number(form.minimumMark)}
                requestedHours={Number(form.requestedHours)}
                selected={candidate.tutorId === selectedTutorId}
                onSelect={() => setSelectedTutorId(candidate.tutorId)}
              />
            ))}
          </div>
        </section>
      )}

      {saveMessage && (
        <p className="status-note" role="status">
          {saveMessage}
        </p>
      )}
    </main>
  )
}
