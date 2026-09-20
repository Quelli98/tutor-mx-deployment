import { fetchWithBearerToken } from './client'
import { isTimeSlotSummary } from './availability'

function isCourse(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    Number.isInteger(value.id) &&
    typeof value.code === 'string' &&
    typeof value.name === 'string'
  )
}

function isTutor(value) {
  return (
    !!value && typeof value === 'object' && !('auth0Id' in value) &&
    Number.isInteger(value.id) && value.role === 'TUTOR' &&
    typeof value.email === 'string' && (value.fullName == null || typeof value.fullName === 'string') &&
    (value.weeklyHours === null || Number.isFinite(value.weeklyHours)) &&
    Number.isFinite(value.usedHours) && Number.isFinite(value.workedHours) &&
    (value.remainingHours === null || Number.isFinite(value.remainingHours)) &&
    isDate(value.weekStart) && isDate(value.weekEnd) &&
    ['available', 'near-limit', 'limit-reached', 'not-set'].includes(value.capacityStatus)
  )
}

function isDate(value) {
  return typeof value === 'string' && Number.isFinite(new Date(value).valueOf())
}

export function canSelectCandidate(candidate) {
  return candidate?.isEligible === true && Array.isArray(candidate.reasonCodes) &&
    candidate.reasonCodes.length === 0 && candidate.hasClash === false
}

const ALLOCATION_REASON_CODES = new Set([
  'insufficient-mark',
  'schedule-clash',
  'hour-limit-exceeded',
])

function isTutorMark(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    Number.isInteger(value.id) &&
    Number.isInteger(value.courseId) &&
    typeof value.courseCode === 'string' &&
    typeof value.courseName === 'string' &&
    typeof value.mark === 'number' &&
    Number.isFinite(value.mark) &&
    Number.isInteger(value.activeAllocationCount)
  )
}

function isAllocationCandidate(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    Number.isInteger(value.tutorId) &&
    typeof value.fullName === 'string' &&
    ['mark', 'weeklyLimit', 'usedHours', 'remainingHours'].every(
      (field) => typeof value[field] === 'number' && Number.isFinite(value[field]),
    ) &&
    typeof value.hasClash === 'boolean' &&
    typeof value.isEligible === 'boolean' &&
    Array.isArray(value.reasonCodes) &&
    value.reasonCodes.every((code) => ALLOCATION_REASON_CODES.has(code)) &&
    Array.isArray(value.clashDetails) &&
    value.clashDetails.every(isClashDetail)
  )
}

function isClashDetail(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    ['busy', 'allocation'].includes(value.kind) &&
    (value.label === null || typeof value.label === 'string') &&
    typeof value.startsAt === 'string' &&
    typeof value.endsAt === 'string' &&
    (value.recurrence == null || ['WEEKLY', 'ONCE'].includes(value.recurrence))
  )
}

const ALLOCATION_STATUSES = new Set(['PROPOSED', 'CONFIRMED', 'CANCELLED'])

function isAllocation(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    Number.isInteger(value.id) &&
    Number.isInteger(value.tutorId) &&
    Number.isInteger(value.courseId) &&
    typeof value.startsAt === 'string' &&
    typeof value.endsAt === 'string' &&
    typeof value.allocatedHours === 'number' &&
    Number.isFinite(value.allocatedHours) &&
    ALLOCATION_STATUSES.has(value.status)
  )
}

function isOrganiserAllocation(value) {
  return (
    isAllocation(value) &&
    typeof value.tutorName === 'string' &&
    typeof value.tutorEmail === 'string' &&
    typeof value.courseCode === 'string' &&
    typeof value.courseName === 'string'
  )
}

function isTimesheetWorkLog(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    Number.isInteger(value.id) &&
    Number.isInteger(value.allocationId) &&
    typeof value.courseCode === 'string' &&
    typeof value.courseName === 'string' &&
    typeof value.workDate === 'string' &&
    typeof value.hours === 'number' &&
    Number.isFinite(value.hours) &&
    typeof value.description === 'string'
  )
}

function isTimesheetApproval(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    Number.isInteger(value.id) &&
    Number.isInteger(value.tutorId) &&
    typeof value.tutorName === 'string' &&
    typeof value.tutorEmail === 'string' &&
    typeof value.weekStart === 'string' &&
    (value.submittedAt === null || typeof value.submittedAt === 'string') &&
    typeof value.totalHours === 'number' &&
    Number.isFinite(value.totalHours) &&
    Array.isArray(value.workLogs) &&
    value.workLogs.every(isTimesheetWorkLog)
  )
}

function isVolunteerClaimApproval(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    Number.isInteger(value.id) &&
    Number.isInteger(value.overflowWorkId) &&
    Number.isInteger(value.studentId) &&
    typeof value.studentName === 'string' &&
    typeof value.studentEmail === 'string' &&
    typeof value.courseCode === 'string' &&
    typeof value.courseName === 'string' &&
    typeof value.startsAt === 'string' &&
    typeof value.endsAt === 'string' &&
    typeof value.hours === 'number' &&
    Number.isFinite(value.hours) &&
    typeof value.createdAt === 'string'
  )
}

function courseFrom(body) {
  const course = body?.data?.course
  if (!isCourse(course)) {
    throw new Error('The course response did not match the agreed contract.')
  }
  return course
}

function allocationFrom(body) {
  const allocation = body?.data?.allocation
  if (!isAllocation(allocation)) {
    throw new Error('The allocation response did not match the agreed contract.')
  }
  return allocation
}

export async function listCourses(tokenOrGetter) {
  const body = await fetchWithBearerToken('/api/courses', {}, tokenOrGetter)
  const courses = body?.data?.courses
  if (!Array.isArray(courses) || !courses.every(isCourse)) {
    throw new Error('The course response did not match the agreed contract.')
  }
  return courses
}

export async function createCourse(input, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    '/api/courses',
    {
      method: 'POST',
      body: JSON.stringify({ code: input.code, name: input.name }),
    },
    tokenOrGetter,
  )
  return courseFrom(body)
}

export async function updateCourse(input, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    `/api/courses/${input.courseId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ code: input.code, name: input.name }),
    },
    tokenOrGetter,
  )
  return courseFrom(body)
}

export async function deleteCourse(input, tokenOrGetter) {
  await fetchWithBearerToken(
    `/api/courses/${input.courseId}`,
    { method: 'DELETE' },
    tokenOrGetter,
  )
}

export async function listTutors(tokenOrGetter, weekStart) {
  const url = weekStart ? `/api/tutors?weekStart=${encodeURIComponent(weekStart)}` : '/api/tutors'
  const body = await fetchWithBearerToken(url, {}, tokenOrGetter)
  const tutors = body?.data?.tutors
  if (!Array.isArray(tutors) || !tutors.every(isTutor)) {
    throw new Error('The tutor response did not match the agreed contract.')
  }
  return tutors
}

export async function listAllocationCandidates(input, tokenOrGetter) {
  const query = new URLSearchParams({
    courseId: String(input.courseId),
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    minimumMark: String(input.minimumMark),
    requestedHours: String(input.requestedHours),
  })
  if (input.excludeAllocationId) {
    query.set('excludeAllocationId', String(input.excludeAllocationId))
  }
  const body = await fetchWithBearerToken(
    `/api/allocations/candidates?${query.toString()}`,
    {},
    tokenOrGetter,
  )
  const candidates = body?.data?.candidates
  if (!Array.isArray(candidates) || !candidates.every(isAllocationCandidate)) {
    throw new Error('The allocation-candidate response did not match the agreed contract.')
  }
  return candidates
}

export async function listAllocations(tokenOrGetter) {
  const body = await fetchWithBearerToken('/api/allocations', {}, tokenOrGetter)
  const allocations = body?.data?.allocations
  if (!Array.isArray(allocations) || !allocations.every(isOrganiserAllocation)) {
    throw new Error('The allocation-list response did not match the agreed contract.')
  }
  return allocations
}

function allocationPayload(input) {
  return {
    tutorId: input.tutorId,
    courseId: input.courseId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    minimumMark: input.minimumMark,
    requestedHours: input.requestedHours,
    status: input.status,
  }
}

export async function createAllocation(input, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    '/api/allocations',
    { method: 'POST', body: JSON.stringify(allocationPayload(input)) },
    tokenOrGetter,
  )
  return allocationFrom(body)
}

export async function updateAllocation(input, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    `/api/allocations/${input.allocationId}`,
    { method: 'PATCH', body: JSON.stringify(allocationPayload(input)) },
    tokenOrGetter,
  )
  return allocationFrom(body)
}

export async function removeAllocation(allocationId, tokenOrGetter) {
  await fetchWithBearerToken(
    `/api/allocations/${allocationId}`,
    { method: 'DELETE' },
    tokenOrGetter,
  )
}

export async function listOrganiserApprovals(tokenOrGetter) {
  const body = await fetchWithBearerToken('/api/organiser/approvals', {}, tokenOrGetter)
  const timesheets = body?.data?.timesheets
  const volunteerClaims = body?.data?.volunteerClaims
  if (
    !Array.isArray(timesheets) ||
    !timesheets.every(isTimesheetApproval) ||
    !Array.isArray(volunteerClaims) ||
    !volunteerClaims.every(isVolunteerClaimApproval)
  ) {
    throw new Error('The organiser-approval response did not match the agreed contract.')
  }
  return { timesheets, volunteerClaims }
}

export async function decideTimesheet(input, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    `/api/timesheets/${input.timesheetId}/decision`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        decision: input.decision,
        ...(input.reason ? { reason: input.reason } : {}),
      }),
    },
    tokenOrGetter,
  )
  return body?.data?.timesheet
}

export async function decideVolunteerClaim(input, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    `/api/volunteer-claims/${input.claimId}/decision`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        decision: input.decision,
        ...(input.reason ? { reason: input.reason } : {}),
      }),
    },
    tokenOrGetter,
  )
  return body?.data?.volunteerClaim
}

export async function listTutorTimeSlots(tutorId, tokenOrGetter) {
  const body = await fetchWithBearerToken(`/api/tutors/${tutorId}/time-slots`, {}, tokenOrGetter)
  const slots = body?.data?.timeSlots
  if (!Array.isArray(slots) || !slots.every(isTimeSlotSummary)) {
    throw new Error('The tutor-schedule response did not match the agreed contract.')
  }
  return slots
}

export async function listTutorMarks(tutorId, tokenOrGetter) {
  const body = await fetchWithBearerToken(`/api/tutors/${tutorId}/marks`, {}, tokenOrGetter)
  const marks = body?.data?.marks
  if (!Array.isArray(marks) || !marks.every(isTutorMark)) {
    throw new Error('The tutor-mark response did not match the agreed contract.')
  }
  return marks
}

export async function saveTutorMark(input, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    `/api/tutors/${input.tutorId}/marks`,
    {
      method: 'PUT',
      body: JSON.stringify({ courseId: input.courseId, mark: input.mark }),
    },
    tokenOrGetter,
  )
  const mark = body?.data?.mark
  if (!isTutorMark(mark)) {
    throw new Error('The tutor-mark response did not match the agreed contract.')
  }
  return mark
}

export async function deleteTutorMark(input, tokenOrGetter) {
  await fetchWithBearerToken(
    `/api/tutors/${input.tutorId}/marks/${input.courseId}`,
    { method: 'DELETE' },
    tokenOrGetter,
  )
}

export const STAFFING_REQUIREMENT_STATUSES = Object.freeze(['OPEN', 'CLOSED', 'CANCELLED'])

function isStaffingRequirement(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    Number.isInteger(value.id) &&
    Number.isInteger(value.courseId) &&
    typeof value.courseCode === 'string' &&
    typeof value.courseName === 'string' &&
    isDate(value.startsAt) &&
    isDate(value.endsAt) &&
    Number.isInteger(value.tutorsNeeded) &&
    Number.isFinite(value.windowHours) &&
    Number.isFinite(value.requiredHours) &&
    STAFFING_REQUIREMENT_STATUSES.includes(value.status) &&
    (value.notes === null || typeof value.notes === 'string') &&
    (value.createdById === null || Number.isInteger(value.createdById)) &&
    isDate(value.createdAt) &&
    isDate(value.updatedAt)
  )
}

function staffingRequirementFrom(body) {
  const staffingRequirement = body?.data?.staffingRequirement
  if (!isStaffingRequirement(staffingRequirement)) {
    throw new Error('The staffing requirement response did not match the agreed contract.')
  }
  return staffingRequirement
}

function staffingRequirementBody(input) {
  return JSON.stringify({
    courseId: input.courseId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    tutorsNeeded: input.tutorsNeeded,
    ...(input.notes === undefined ? {} : { notes: input.notes }),
  })
}

export async function listStaffingRequirements(input, tokenOrGetter) {
  const query = new URLSearchParams()
  if (input?.courseId) query.set('courseId', String(input.courseId))
  if (input?.status) query.set('status', input.status)
  const suffix = query.toString()
  const body = await fetchWithBearerToken(
    suffix ? `/api/staffing-requirements?${suffix}` : '/api/staffing-requirements',
    {},
    tokenOrGetter,
  )
  const staffingRequirements = body?.data?.staffingRequirements
  if (!Array.isArray(staffingRequirements) || !staffingRequirements.every(isStaffingRequirement)) {
    throw new Error('The staffing requirement response did not match the agreed contract.')
  }
  return staffingRequirements
}

export async function createStaffingRequirement(input, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    '/api/staffing-requirements',
    { method: 'POST', body: staffingRequirementBody(input) },
    tokenOrGetter,
  )
  return staffingRequirementFrom(body)
}

export async function updateStaffingRequirement(input, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    `/api/staffing-requirements/${input.requirementId}`,
    { method: 'PATCH', body: staffingRequirementBody(input) },
    tokenOrGetter,
  )
  return staffingRequirementFrom(body)
}

export async function setStaffingRequirementStatus(input, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    `/api/staffing-requirements/${input.requirementId}/status`,
    { method: 'PATCH', body: JSON.stringify({ status: input.status }) },
    tokenOrGetter,
  )
  return staffingRequirementFrom(body)
}
