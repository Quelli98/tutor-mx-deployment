import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import {
  canSelectCandidate,
  createAllocation,
  listAllocationCandidates,
  listAllocations,
  listCourses,
  removeAllocation,
  updateAllocation,
} from '../api/organiser'
import {
  MAX_SESSION_HOURS,
  maximumSessionLengthMessage,
  sessionLengthText,
} from '../components/shared/scheduleWeek'
import { RuleResult } from '../components/organiser/RuleResult'
import { ConfirmationDialog } from '../components/shared/ConfirmationDialog'
import { EmptyState, ErrorState, LoadingState } from '../components/shared/StatusMessage'
import { SidePanel } from '../components/shared/SidePanel'
import { localMonday } from '../components/shared/scheduleWeek'
import { HomeHero } from '../components/organiser/HomeHero'
import { HomeQuickActions } from '../components/organiser/HomeQuickActions'
import { HomeWeek } from '../components/organiser/HomeWeek'
import { HomeApprovals } from '../components/organiser/HomeApprovals'
import { HomeRequirements } from '../components/organiser/HomeRequirements'
import { HomeAllocations } from '../components/organiser/HomeAllocations'
import { HomeCourses } from '../components/organiser/HomeCourses'
import { HoursChart } from '../components/organiser/HoursChart'
import { HomeTutors } from '../components/organiser/HomeTutors'
import { useOrganiserApprovals } from './useOrganiserApprovals'
import { useOrganiserWeek } from './useOrganiserWeek'
import { timeRange } from './organiserHome'

const EMPTY_FORM = {
  courseId: '',
  startsAt: '',
  endsAt: '',
  minimumMark: '65',
  requestedHours: '2',
}

const ALLOCATION_RULE_CODES = new Set([
  'insufficient-mark',
  'schedule-clash',
  'hour-limit-exceeded',
])

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
  if (error?.code === 'TUTOR_NOT_FOUND') {
    return 'That tutor is no longer available. Refresh the candidates and try again.'
  }
  if (error?.code === 'COURSE_NOT_FOUND') {
    return 'That course is no longer available. Refresh the page and try again.'
  }
  if (error?.code === 'ALLOCATION_NOT_FOUND') {
    return 'That allocation was already removed. The list has been refreshed.'
  }
  if (ALLOCATION_RULE_CODES.has(error?.code)) {
    return error.message
  }
  return fallback
}

function dateTimeLocalValue(isoValue) {
  const value = new Date(isoValue)
  if (Number.isNaN(value.valueOf())) return ''
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.valueOf() - offset).toISOString().slice(0, 16)
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
  } else if (
    !errors.startsAt &&
    (endsAt.valueOf() - startsAt.valueOf()) / 3_600_000 > MAX_SESSION_HOURS
  ) {
    // A session spanning days is almost always a mistyped date, and the hours
    // rule below cannot catch it: two hours fits inside a month just fine.
    errors.endsAt = maximumSessionLengthMessage(startsAt, endsAt)
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
  } else if (!errors.startsAt && !errors.endsAt && !errors.requestedHours) {
    // Hours longer than the session itself would inflate the tutor's used
    // capacity and a course's staffing shortage. The server and the database
    // refuse it too; this only saves the organiser a round trip.
    const windowHours = (endsAt.valueOf() - startsAt.valueOf()) / 3_600_000
    if (requestedHours > windowHours) {
      errors.requestedHours = `Enter hours above 0 and no more than the session length of ${sessionLengthText(startsAt, endsAt)}.`
    }
  }

  return errors
}

function ruleState(candidate, reasonCode) {
  if (!Array.isArray(candidate.reasonCodes)) return 'unknown'
  return candidate.reasonCodes.includes(reasonCode) ? 'fail' : 'pass'
}

function CandidateCard({ candidate, minimumMark, requestedHours, selected, onSelect, disabled }) {
  const markState = ruleState(candidate, 'insufficient-mark')
  const clashState = ruleState(candidate, 'schedule-clash')
  const hoursState = ruleState(candidate, 'hour-limit-exceeded')
  const markMessage =
    candidate.mark === null
      ? `No course mark is recorded; ${minimumMark}% is required.`
      : markState === 'fail'
        ? `${candidate.mark}% is below the required ${minimumMark}%.`
        : `${candidate.mark}% meets the required ${minimumMark}%.`
  const hoursMessage =
    candidate.weeklyLimit === 0 || candidate.remainingHours === null
      ? `Weekly work capacity not set; set it before allocating ${requestedHours} hours.`
      : `${candidate.remainingHours} hours of capacity remain; ${requestedHours} hours are required.`

  const clashMessage = (() => {
    if (clashState !== 'fail') return 'No overlapping schedule or confirmed allocation was found.'
    if (!candidate.clashDetails.length) return 'Timetable conflict; refresh to load the conflicting schedule details.'
    const details = candidate.clashDetails.slice(0, 3)
    const descriptions = details.map((detail) => {
      const start = new Date(detail.startsAt)
      const end = new Date(detail.endsAt)
      const dayName = start.toLocaleDateString(undefined, { weekday: 'long' })
      const timeRange = `${start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}–${end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`
      const label = detail.label || (detail.kind === 'busy' ? 'Busy time' : 'Allocation')
      return `${label}, ${dayName} ${timeRange}`
    })
    const suffix = candidate.clashDetails.length > 3 ? ` and ${candidate.clashDetails.length - 3} more` : ''
    return `Overlaps ${descriptions.join('; ')}${suffix}.`
  })()

  return (
    <article className={`candidate-card${selected ? ' selected' : ''}`}>
      <header className="candidate-card-header">
        <div>
          <h3>{candidate.fullName}</h3>
          <p>{canSelectCandidate(candidate) ? 'Eligible for selection' : 'Not currently eligible'}</p>
        </div>
        {canSelectCandidate(candidate) && <button
          type="button"
          className="secondary-button"
          onClick={onSelect}
          disabled={disabled}
          aria-pressed={selected}
        >
          {selected ? 'Selected' : `Select ${candidate.fullName}`}
        </button>}
      </header>

      {canSelectCandidate(candidate) && (
        <ul
          className="candidate-chips"
          aria-label={`Why ${candidate.fullName} is ranked here`}
        >
          {/* Only factors the ranking actually used: the mark drives the band
              and the exact-mark step, and hours used against the weekly limit is
              the share step, said in numbers an organiser can act on. */}
          <li className="summary-pill">Mark {candidate.mark}%</li>
          <li className="summary-pill">
            {candidate.usedHours} of {candidate.weeklyLimit} hours used that week
          </li>
        </ul>
      )}

      <ul className="rule-result-list" aria-label={`Allocation checks for ${candidate.fullName}`}>
        <RuleResult
          label="Mark"
          state={markState}
          message={markMessage}
        />
        <RuleResult
          label="Availability"
          state={clashState}
          message={clashMessage}
        />
        <RuleResult
          label="Capacity"
          state={hoursState}
          message={hoursMessage}
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
  const [allocationsStatus, setAllocationsStatus] = useState('loading')
  const [allocations, setAllocations] = useState([])
  const [allocationsError, setAllocationsError] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [fieldErrors, setFieldErrors] = useState({})
  const [candidateStatus, setCandidateStatus] = useState('idle')
  const [candidates, setCandidates] = useState([])
  const [candidateError, setCandidateError] = useState('')
  const [selectedTutorId, setSelectedTutorId] = useState(null)
  const [editingAllocation, setEditingAllocation] = useState(null)
  const [removingAllocation, setRemovingAllocation] = useState(null)
  const [mutationStatus, setMutationStatus] = useState('idle')
  const [saveMessage, setSaveMessage] = useState('')
  const [saveError, setSaveError] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)
  const panelOpenerRef = useRef(null)
  const [weekStart, setWeekStart] = useState(() => localMonday(new Date()))
  const week = useOrganiserWeek(weekStart)

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

  const loadAllocations = useCallback(async () => {
    setAllocationsStatus('loading')
    setAllocationsError('')
    try {
      const result = await listAllocations(getAccessTokenSilently)
      setAllocations(result)
      setAllocationsStatus('success')
    } catch (error) {
      setAllocations([])
      setAllocationsError(
        safeErrorMessage(error, 'Current allocations could not be loaded safely.'),
      )
      setAllocationsStatus('error')
    }
  }, [getAccessTokenSilently])

  const approvals = useOrganiserApprovals({ onDecision: loadAllocations })

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCourses()
    loadAllocations()
  }, [loadAllocations, loadCourses])

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.tutorId === selectedTutorId) || null,
    [candidates, selectedTutorId],
  )

  const { eligibleCandidates, ineligibleCandidates } = useMemo(() => {
    const eligible = candidates.filter((candidate) => canSelectCandidate(candidate))
    const ineligible = candidates.filter((candidate) => !canSelectCandidate(candidate))
    return { eligibleCandidates: eligible, ineligibleCandidates: ineligible }
  }, [candidates])

  const isMutating = mutationStatus !== 'idle'

  function boardInput() {
    return {
      courseId: Number(form.courseId),
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: new Date(form.endsAt).toISOString(),
      minimumMark: Number(form.minimumMark),
      requestedHours: Number(form.requestedHours),
      ...(editingAllocation ? { excludeAllocationId: editingAllocation.id } : {}),
    }
  }

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
    setCandidateStatus('idle')
    setCandidates([])
    setSelectedTutorId(null)
    setSaveMessage('')
    setSaveError('')
  }

  async function checkCandidates(preferredTutorId = null) {
    if (candidateStatus === 'loading' || isMutating) return
    const errors = validateBoard(form)
    setFieldErrors(errors)
    setCandidateError('')
    setSaveMessage('')
    setSaveError('')
    if (Object.keys(errors).length > 0) return

    setCandidateStatus('loading')
    try {
      const result = await listAllocationCandidates(boardInput(), getAccessTokenSilently)
      setCandidates(result)
      setSelectedTutorId(
        result.some((candidate) => candidate.tutorId === preferredTutorId && canSelectCandidate(candidate))
          ? preferredTutorId
          : null,
      )
      setCandidateStatus('success')
    } catch (error) {
      setCandidates([])
      setSelectedTutorId(null)
      setCandidateError(
        safeErrorMessage(error, 'Candidates could not be checked safely. Please try again.'),
      )
      setCandidateStatus('error')
    }
  }

  function handleCheckCandidates(event) {
    event.preventDefault()
    void checkCandidates(editingAllocation?.tutorId ?? null)
  }

  function startEditing(allocation, opener = null) {
    panelOpenerRef.current = opener
    setEditingAllocation(allocation)
    setForm({
      courseId: String(allocation.courseId),
      startsAt: dateTimeLocalValue(allocation.startsAt),
      endsAt: dateTimeLocalValue(allocation.endsAt),
      minimumMark: '65',
      requestedHours: String(allocation.allocatedHours),
    })
    setFieldErrors({})
    setCandidateStatus('idle')
    setCandidates([])
    setSelectedTutorId(null)
    setSaveMessage('')
    setSaveError('')
    setPanelOpen(true)
  }

  // Opens the allocation panel on a fresh board, optionally filled in (from a staffing requirement).
  function openNewAllocation(prefill = {}, opener = null) {
    panelOpenerRef.current = opener
    setEditingAllocation(null)
    setForm({ ...EMPTY_FORM, ...prefill })
    setFieldErrors({})
    setCandidateStatus('idle')
    setCandidates([])
    setSelectedTutorId(null)
    setCandidateError('')
    setSaveMessage('')
    setSaveError('')
    setPanelOpen(true)
  }

  function allocateForRequirement(requirement, opener) {
    openNewAllocation({
      courseId: String(requirement.courseId),
      startsAt: dateTimeLocalValue(requirement.startsAt),
      endsAt: dateTimeLocalValue(requirement.endsAt),
      requestedHours: String(requirement.windowHours),
    }, opener)
  }

  function closePanel() {
    if (isMutating) return
    cancelEditing()
    setSaveMessage('')
    setSaveError('')
    setPanelOpen(false)
  }

  // Remove is offered in the panel; the panel closes first so the confirmation opens over Home.
  function requestRemoval(allocation) {
    if (isMutating) return
    closePanel()
    setRemovingAllocation(allocation)
  }

  function cancelEditing() {
    setEditingAllocation(null)
    setForm(EMPTY_FORM)
    setFieldErrors({})
    setCandidateStatus('idle')
    setCandidates([])
    setSelectedTutorId(null)
    setCandidateError('')
    setSaveError('')
  }

  async function refreshAfterMutation(input, preferredTutorId, excludeAllocationId) {
    const liveInput = {
      courseId: input.courseId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      minimumMark: input.minimumMark,
      requestedHours: input.requestedHours,
      ...(excludeAllocationId ? { excludeAllocationId } : {}),
    }
    const [allocationResult, candidateResult] = await Promise.allSettled([
      listAllocations(getAccessTokenSilently),
      listAllocationCandidates(liveInput, getAccessTokenSilently),
    ])
    if (allocationResult.status === 'fulfilled') {
      setAllocations(allocationResult.value)
      setAllocationsStatus('success')
    } else {
      setAllocationsError('The allocation was saved, but the current list could not be refreshed.')
      setAllocationsStatus('error')
    }
    if (candidateResult.status === 'fulfilled') {
      setCandidates(candidateResult.value)
      setCandidateStatus('success')
      setSelectedTutorId(
        candidateResult.value.some(
          (candidate) => candidate.tutorId === preferredTutorId && canSelectCandidate(candidate),
        )
          ? preferredTutorId
          : null,
      )
    } else {
      setCandidates([])
      setSelectedTutorId(null)
      setCandidateError('The allocation was saved, but live candidate hours could not be refreshed.')
      setCandidateStatus('error')
    }
    return allocationResult.status === 'fulfilled' && candidateResult.status === 'fulfilled'
  }

  async function handleSaveAllocation() {
    if (!canSelectCandidate(selectedCandidate)) return
    const input = boardInput()
    setMutationStatus('saving')
    setSaveMessage('')
    setSaveError('')

    try {
      const payload = {
        ...input,
        tutorId: selectedCandidate.tutorId,
        status: editingAllocation?.status ?? 'CONFIRMED',
      }
      let savedAllocation
      if (editingAllocation) {
        savedAllocation = await updateAllocation(
          { ...payload, allocationId: editingAllocation.id },
          getAccessTokenSilently,
        )
      } else {
        savedAllocation = await createAllocation(payload, getAccessTokenSilently)
      }
      const refreshed = await refreshAfterMutation(input, selectedCandidate.tutorId, savedAllocation?.id)
      week.reload()
      setSaveMessage(
        refreshed
          ? editingAllocation
            ? `${selectedCandidate.fullName}'s allocation was updated and rechecked.`
            : `${selectedCandidate.fullName} was allocated and weekly hours were refreshed.`
          : `The allocation was saved for ${selectedCandidate.fullName}. Use Refresh or Check candidates to load the latest board.`,
      )
      setEditingAllocation(null)
    } catch (error) {
      setSaveError(
        safeErrorMessage(
          error,
          'The allocation could not be saved. No changes were made; check the rules and try again.',
        ),
      )
      try {
        const latestCandidates = await listAllocationCandidates(input, getAccessTokenSilently)
        setCandidates(latestCandidates)
        setCandidateStatus('success')
        setSelectedTutorId(
          latestCandidates.some(
            (candidate) =>
              candidate.tutorId === selectedCandidate.tutorId && canSelectCandidate(candidate),
          )
            ? selectedCandidate.tutorId
            : null,
        )
      } catch {
        setCandidateStatus('error')
        setCandidateError('The live candidate results could not be refreshed. Check them again.')
      }
    } finally {
      setMutationStatus('idle')
    }
  }

  async function confirmRemoveAllocation() {
    if (!removingAllocation) return
    const allocation = removingAllocation
    setMutationStatus('removing')
    setSaveMessage('')
    setSaveError('')
    try {
      await removeAllocation(allocation.id, getAccessTokenSilently)
      await loadAllocations()
      week.reload()
      setSaveMessage(`${allocation.tutorName}'s ${allocation.courseCode} allocation was removed.`)
      if (editingAllocation?.id === allocation.id) cancelEditing()
    } catch (error) {
      setSaveError(
        safeErrorMessage(error, 'The allocation could not be removed. Refresh and try again.'),
      )
      await loadAllocations()
    } finally {
      setMutationStatus('idle')
      setRemovingAllocation(null)
    }
  }


  const statusNotes = (
    <>
      {saveMessage && (
        <p className="status-note" role="status">
          {saveMessage}
        </p>
      )}
      {saveError && (
        <p className="status-note danger" role="alert">
          {saveError}
        </p>
      )}
    </>
  )

  return (
    <main id="main-content" className="dashboard-shell organiser-home">
      <h1 className="visually-hidden">Organiser workspace</h1>

      <HomeHero approvals={approvals} week={week} weekStart={weekStart} />

      <HomeQuickActions onAllocate={(opener) => openNewAllocation({}, opener)} />

      <HomeWeek weekStart={weekStart} onWeekChange={setWeekStart} week={week} approvals={approvals} />

      <div className="home-split">
        <HomeApprovals approvals={approvals} />
        <HomeRequirements
          part={week.requirements}
          weekStart={weekStart}
          onAllocate={allocateForRequirement}
          onRetry={week.reload}
        />
      </div>

      <HomeAllocations
        status={allocationsStatus}
        allocations={allocations}
        error={allocationsError}
        isMutating={isMutating}
        weekStart={weekStart}
        onWeekChange={setWeekStart}
        onRefresh={loadAllocations}
        onEdit={startEditing}
      >
        {!panelOpen && statusNotes}
      </HomeAllocations>

      <HomeCourses
        coursesStatus={coursesStatus}
        courses={courses}
        allocations={allocations}
        week={week}
        weekStart={weekStart}
        onRetry={loadCourses}
      />

      <div className="home-split">
        <HoursChart weekStart={weekStart} />
        <HomeTutors part={week.tutors} onRetry={week.reload} />
      </div>

      <SidePanel
        open={panelOpen}
        title={editingAllocation ? 'Edit allocation' : 'Allocate a tutor'}
        description="Every tutor is checked against their mark, timetable and weekly hours."
        onClose={closePanel}
        closeDisabled={isMutating}
        returnFocusRef={panelOpenerRef}
      >
        {editingAllocation && (
          <section className="panel-current" aria-labelledby="allocation-current-heading">
            <div className="panel-current-words">
              <h3 id="allocation-current-heading">This allocation</h3>
              <p className="panel-current-name">{editingAllocation.tutorName}</p>
              <p className="panel-current-meta">{editingAllocation.tutorEmail}</p>
              <p className="panel-current-meta">
                {editingAllocation.courseCode} ·{' '}
                {new Date(editingAllocation.startsAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })},{' '}
                {timeRange(editingAllocation.startsAt, editingAllocation.endsAt)}
              </p>
              <p className="panel-current-meta">
                {`${editingAllocation.allocatedHours}\u00a0h`} ·{' '}
                {editingAllocation.status.charAt(0) + editingAllocation.status.slice(1).toLowerCase()}
              </p>
            </div>
            <button type="button" className="danger-button" onClick={() => requestRemoval(editingAllocation)} disabled={isMutating}>
              Remove allocation
            </button>
          </section>
        )}

        <section className="panel-step" aria-labelledby="allocation-session-heading">
          <h3 id="allocation-session-heading">
            <span className="panel-step-number" aria-hidden="true">1</span>
            Session
          </h3>
          <form className="allocation-form" onSubmit={handleCheckCandidates} noValidate>
            <div className="field-group allocation-field-wide">
              <label htmlFor="allocation-course">Course</label>
              <select
                id="allocation-course"
                value={form.courseId}
                onChange={(event) => updateField('courseId', event.target.value)}
                disabled={coursesStatus === 'loading' || isMutating}
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
                disabled={isMutating}
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
                disabled={isMutating}
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
                disabled={isMutating}
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
                disabled={isMutating}
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
                candidateStatus === 'loading' ||
                coursesStatus === 'loading' ||
                courses.length === 0 ||
                isMutating
              }
            >
              {candidateStatus === 'loading' ? 'Checking candidates...' : 'Check candidates'}
            </button>
          </form>

          {coursesStatus === 'loading' && (
            <LoadingState title="Loading courses..." message="The allocation form will stay open." />
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
        </section>

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
            onRetry={() => checkCandidates(editingAllocation?.tutorId ?? null)}
          />
        )}
        {candidateStatus === 'success' && candidates.length === 0 && (
          <EmptyState
            title="No tutors have marks recorded for this course yet."
            message="Add a course mark in Tutor Management before checking allocation eligibility."
          />
        )}
        {candidateStatus === 'success' && candidates.length > 0 && (
          <section className="panel-step candidate-results" aria-labelledby="candidate-results-heading">
            <h3 id="candidate-results-heading">
              <span className="panel-step-number" aria-hidden="true">2</span>
              Choose a tutor
            </h3>
            <p className="helper-text">All three checks stay visible, including failed checks.</p>

            {(eligibleCandidates.length > 0 || ineligibleCandidates.length > 0) && (
              <>
                <h3 className="candidate-section-heading">Eligible tutors</h3>
                {eligibleCandidates.length > 0 ? (
                  <>
                    <p className="helper-text">
                      <strong>Ranked by mark band, then who is least busy that week.</strong>{' '}
                      These tutors meet all allocation rules. Select one to assign.
                    </p>
                    <div className="candidate-grid">
                      {eligibleCandidates.map((candidate) => (
                        <CandidateCard
                          key={candidate.tutorId}
                          candidate={candidate}
                          minimumMark={Number(form.minimumMark)}
                          requestedHours={Number(form.requestedHours)}
                          selected={candidate.tutorId === selectedTutorId}
                          onSelect={() => setSelectedTutorId(candidate.tutorId)}
                          disabled={isMutating}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="empty-inline" role="status">
                    No tutors currently available.
                  </p>
                )}
              </>
            )}

            {ineligibleCandidates.length > 0 && (
              <>
                <h3 className="candidate-section-heading">Not eligible</h3>
                <p className="helper-text">
                  These tutors do not meet one or more allocation rules. See the reasons below each card.
                </p>
                <div className="candidate-grid">
                  {ineligibleCandidates.map((candidate) => (
                    <CandidateCard
                      key={candidate.tutorId}
                      candidate={candidate}
                      minimumMark={Number(form.minimumMark)}
                      requestedHours={Number(form.requestedHours)}
                      selected={false}
                      onSelect={() => {}}
                      disabled={true}
                    />
                  ))}
                </div>
              </>
            )}

            {eligibleCandidates.length === 0 && ineligibleCandidates.length === 0 && (
              <p className="empty-inline" role="status">
                No tutors found for this course and time slot.
              </p>
            )}
          </section>
        )}

        {panelOpen && statusNotes}

        {candidateStatus === 'success' && candidates.length > 0 && (
          <div className="side-panel-footer">
            <button type="button" className="secondary-button" onClick={closePanel} disabled={isMutating}>
              {editingAllocation ? 'Cancel edit' : 'Cancel'}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!canSelectCandidate(selectedCandidate) || isMutating}
              onClick={handleSaveAllocation}
            >
              {mutationStatus === 'saving'
                ? 'Saving allocation...'
                : editingAllocation
                  ? 'Update allocation'
                  : 'Save allocation'}
            </button>
          </div>
        )}
      </SidePanel>

      <ConfirmationDialog
        open={Boolean(removingAllocation)}
        title="Remove allocation?"
        confirmLabel="Remove allocation"
        isPending={mutationStatus === 'removing'}
        onCancel={() => setRemovingAllocation(null)}
        onConfirm={confirmRemoveAllocation}
      >
        <p>
          {removingAllocation
            ? `${removingAllocation.tutorName} will be removed from ${removingAllocation.courseCode}. Their weekly hours will be released immediately.`
            : ''}
        </p>
      </ConfirmationDialog>
    </main>
  )
}
