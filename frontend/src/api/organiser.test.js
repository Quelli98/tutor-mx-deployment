import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAllocation,
  createCourse,
  createStaffingRequirement,
  deleteCourse,
  deleteTutorMark,
  decideTimesheet,
  decideVolunteerClaim,
  listAllocationCandidates,
  listAllocations,
  listCourses,
  listOrganiserApprovals,
  listStaffingRequirements,
  listTutorMarks,
  listTutorTimeSlots,
  listTutors,
  saveTutorMark,
  setStaffingRequirementStatus,
  updateCourse,
  updateStaffingRequirement,
  updateAllocation,
  removeAllocation,
} from './organiser'

const fetchWithBearerToken = vi.fn()

vi.mock('./client', () => ({
  fetchWithBearerToken: (...args) => fetchWithBearerToken(...args),
}))

const tokenGetter = vi.fn()

const course = { id: 1, code: 'DEMO101', name: 'Demo Course', hourlyRate: 30, budget: 5000 }
const tutor = {
  id: 7,
  email: 'tutor@tutormx.example',
  fullName: 'Sam Tutor',
  role: 'TUTOR',
  weeklyHours: 10,
  usedHours: 2,
  workedHours: 1,
  remainingHours: 8,
  weekStart: '2030-09-02',
  weekEnd: '2030-09-08',
  capacityStatus: 'available',
}

describe('organiser course API contract', () => {
  beforeEach(() => {
    fetchWithBearerToken.mockReset()
    tokenGetter.mockReset()
  })

  it.each(['WEEKLY', 'ONCE', null])('requests a selected tutor schedule with recurrence %s and null optional fields', async (recurrence) => {
    const slot = { id: 4, type: 'BUSY', startsAt: '2026-09-17T06:00:00.000Z', endsAt: '2026-09-17T07:45:00.000Z', recurrence, label: null, recurrenceUntil: null }
    fetchWithBearerToken.mockResolvedValue({ data: { timeSlots: [slot] } })
    await expect(listTutorTimeSlots(7, tokenGetter)).resolves.toEqual([slot])
    expect(fetchWithBearerToken).toHaveBeenCalledWith('/api/tutors/7/time-slots', {}, tokenGetter)
  })

  it('rejects a malformed selected-tutor schedule without changing the marks contract', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: { timeSlots: [{ id: 1, startsAt: 'invalid' }] } })
    await expect(listTutorTimeSlots(7, tokenGetter)).rejects.toThrow('tutor-schedule response')
  })

  it('returns the unwrapped course list for a valid payload', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: { courses: [course] } })

    await expect(listCourses(tokenGetter)).resolves.toEqual([course])
    expect(fetchWithBearerToken).toHaveBeenCalledWith('/api/courses', {}, tokenGetter)
  })

  it('rejects a course list where an entry has no id', async () => {
    fetchWithBearerToken.mockResolvedValue({
      data: { courses: [{ code: 'DEMO101', name: 'Demo Course' }] },
    })

    await expect(listCourses(tokenGetter)).rejects.toThrow(
      'The course response did not match the agreed contract.',
    )
  })

  it('rejects a course list where a code is not a string', async () => {
    fetchWithBearerToken.mockResolvedValue({
      data: { courses: [{ id: 1, code: 101, name: 'Demo Course' }] },
    })

    await expect(listCourses(tokenGetter)).rejects.toThrow(
      'The course response did not match the agreed contract.',
    )
  })

  it('rejects a course whose money fields are missing', async () => {
    fetchWithBearerToken.mockResolvedValue({
      data: { courses: [{ id: 1, code: 'DEMO101', name: 'Demo Course' }] },
    })

    await expect(listCourses(tokenGetter)).rejects.toThrow(
      'The course response did not match the agreed contract.',
    )
  })

  it('accepts a course with no rate or budget set', async () => {
    const unpriced = { id: 1, code: 'DEMO101', name: 'Demo Course', hourlyRate: null, budget: null }
    fetchWithBearerToken.mockResolvedValue({ data: { courses: [unpriced] } })

    await expect(listCourses(tokenGetter)).resolves.toEqual([unpriced])
  })

  it('posts the exact course body when creating', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: { course } })

    await expect(
      createCourse({ code: 'DEMO101', name: 'Demo Course' }, tokenGetter),
    ).resolves.toEqual(course)
    expect(fetchWithBearerToken).toHaveBeenCalledWith(
      '/api/courses',
      {
        method: 'POST',
        body: JSON.stringify({ code: 'DEMO101', name: 'Demo Course' }),
      },
      tokenGetter,
    )
  })

  it('sends the money fields only when the caller supplies them', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: { course } })

    await createCourse(
      { code: 'DEMO101', name: 'Demo Course', hourlyRate: 30, budget: null },
      tokenGetter,
    )
    expect(fetchWithBearerToken.mock.calls[0][1].body).toBe(
      JSON.stringify({ code: 'DEMO101', name: 'Demo Course', hourlyRate: 30, budget: null }),
    )
  })

  it('sends both course fields to the identified course on update', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: { course } })

    await expect(
      updateCourse({ courseId: 1, code: 'DEMO101', name: 'Renamed Course' }, tokenGetter),
    ).resolves.toEqual(course)
    expect(fetchWithBearerToken).toHaveBeenCalledWith(
      '/api/courses/1',
      {
        method: 'PATCH',
        body: JSON.stringify({ code: 'DEMO101', name: 'Renamed Course' }),
      },
      tokenGetter,
    )
  })

  it('deletes without parsing a body from the empty response', async () => {
    fetchWithBearerToken.mockResolvedValue({})

    await expect(deleteCourse({ courseId: 1 }, tokenGetter)).resolves.toBeUndefined()
    expect(fetchWithBearerToken).toHaveBeenCalledWith(
      '/api/courses/1',
      { method: 'DELETE' },
      tokenGetter,
    )
  })
})

describe('organiser tutor API contract', () => {
  beforeEach(() => {
    fetchWithBearerToken.mockReset()
    tokenGetter.mockReset()
  })

  it('returns the unwrapped tutor list for a valid payload', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: { tutors: [tutor] } })

    await expect(listTutors(tokenGetter)).resolves.toEqual([tutor])
    expect(fetchWithBearerToken).toHaveBeenCalledWith('/api/tutors', {}, tokenGetter)
  })

  it('accepts an unconfigured weekly-hour limit as null', async () => {
    const unconfigured = { ...tutor, id: 8, weeklyHours: null, usedHours: 0, workedHours: 0, remainingHours: null, capacityStatus: 'not-set' }
    fetchWithBearerToken.mockResolvedValue({ data: { tutors: [tutor, unconfigured] } })

    await expect(listTutors(tokenGetter)).resolves.toEqual([tutor, unconfigured])
  })

  it('rejects a tutor list where weeklyHours is a string', async () => {
    fetchWithBearerToken.mockResolvedValue({
      data: { tutors: [{ ...tutor, weeklyHours: '10' }] },
    })

    await expect(listTutors(tokenGetter)).rejects.toThrow(
      'The tutor response did not match the agreed contract.',
    )
  })

  it('forwards weekStart as a query parameter when provided', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: { tutors: [tutor] } })

    await expect(listTutors(tokenGetter, '2026-09-21')).resolves.toEqual([tutor])
    expect(fetchWithBearerToken).toHaveBeenCalledWith(
      '/api/tutors?weekStart=2026-09-21',
      {},
      tokenGetter,
    )
  })

  it('omits the query string when weekStart is not provided', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: { tutors: [tutor] } })

    await listTutors(tokenGetter)
    expect(fetchWithBearerToken).toHaveBeenCalledWith('/api/tutors', {}, tokenGetter)
  })
})

describe('organiser allocation and tutor-detail API contracts', () => {
  beforeEach(() => {
    fetchWithBearerToken.mockReset()
    tokenGetter.mockReset()
  })

  it('requests and validates allocation candidates', async () => {
    const candidate = {
      tutorId: 7,
      fullName: 'Sam Tutor',
      mark: 75,
      weeklyLimit: 10,
      usedHours: 2,
      remainingHours: 8,
      hasClash: false,
      isEligible: true,
      reasonCodes: [],
      clashDetails: [],
    }
    fetchWithBearerToken.mockResolvedValue({ data: { candidates: [candidate] } })
    const input = {
      courseId: 3,
      startsAt: '2030-09-04T14:00:00.000Z',
      endsAt: '2030-09-04T16:00:00.000Z',
      minimumMark: 65,
      requestedHours: 2,
    }

    await expect(listAllocationCandidates(input, tokenGetter)).resolves.toEqual([candidate])
    const expectedQuery = new URLSearchParams({
      courseId: '3',
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      minimumMark: '65',
      requestedHours: '2',
    })
    expect(fetchWithBearerToken).toHaveBeenCalledWith(
      `/api/allocations/candidates?${expectedQuery.toString()}`,
      {},
      tokenGetter,
    )
  })

  it.each(['WEEKLY', 'ONCE', null])('accepts specific clash details with %s recurrence', async (recurrence) => {
    const candidate = { tutorId: 7, fullName: 'Sam Tutor', mark: 90, weeklyLimit: 15, usedHours: 0, remainingHours: 15, hasClash: true, isEligible: false, reasonCodes: ['schedule-clash'], clashDetails: [{ kind: 'busy', label: 'Lecture', startsAt: '2026-09-17T06:00:00.000Z', endsAt: '2026-09-17T07:45:00.000Z', recurrence }] }
    fetchWithBearerToken.mockResolvedValue({ data: { candidates: [candidate] } })
    await expect(listAllocationCandidates({ courseId: 3, startsAt: candidate.clashDetails[0].startsAt, endsAt: candidate.clashDetails[0].endsAt, minimumMark: 65, requestedHours: 1.75 }, tokenGetter)).resolves.toEqual([candidate])
  })

  it('excludes the allocation being edited from candidate checks', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: { candidates: [] } })
    await listAllocationCandidates(
      {
        courseId: 3,
        startsAt: '2030-09-04T14:00:00.000Z',
        endsAt: '2030-09-04T16:00:00.000Z',
        minimumMark: 65,
        requestedHours: 2,
        excludeAllocationId: 11,
      },
      tokenGetter,
    )

    expect(fetchWithBearerToken.mock.calls[0][0]).toContain('excludeAllocationId=11')
  })

  it('lists, creates, updates and removes live allocations', async () => {
    const allocation = {
      id: 11,
      tutorId: 7,
      courseId: 3,
      startsAt: '2030-09-04T14:00:00.000Z',
      endsAt: '2030-09-04T16:00:00.000Z',
      allocatedHours: 2,
      status: 'CONFIRMED',
    }
    const organiserAllocation = {
      ...allocation,
      tutorName: 'Sam Tutor',
      tutorEmail: 'sam@tutormx.example',
      courseCode: 'COMS3011',
      courseName: 'Software Design Project',
    }
    const input = {
      tutorId: 7,
      courseId: 3,
      startsAt: allocation.startsAt,
      endsAt: allocation.endsAt,
      minimumMark: 65,
      requestedHours: 2,
      status: 'CONFIRMED',
    }

    fetchWithBearerToken.mockResolvedValueOnce({ data: { allocations: [organiserAllocation] } })
    await expect(listAllocations(tokenGetter)).resolves.toEqual([organiserAllocation])
    expect(fetchWithBearerToken).toHaveBeenLastCalledWith('/api/allocations', {}, tokenGetter)

    fetchWithBearerToken.mockResolvedValueOnce({ data: { allocation } })
    await expect(createAllocation(input, tokenGetter)).resolves.toEqual(allocation)
    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(
      '/api/allocations',
      { method: 'POST', body: JSON.stringify(input) },
      tokenGetter,
    )

    fetchWithBearerToken.mockResolvedValueOnce({ data: { allocation } })
    await expect(updateAllocation({ allocationId: 11, ...input }, tokenGetter)).resolves.toEqual(allocation)
    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(
      '/api/allocations/11',
      { method: 'PATCH', body: JSON.stringify(input) },
      tokenGetter,
    )

    fetchWithBearerToken.mockResolvedValueOnce({})
    await expect(removeAllocation(11, tokenGetter)).resolves.toBeUndefined()
    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(
      '/api/allocations/11',
      { method: 'DELETE' },
      tokenGetter,
    )
  })

  it('rejects unknown allocation reason codes', async () => {
    fetchWithBearerToken.mockResolvedValue({
      data: {
        candidates: [
          {
            tutorId: 7,
            fullName: 'Sam Tutor',
            mark: 75,
            weeklyLimit: 10,
            usedHours: 2,
            remainingHours: 8,
            hasClash: false,
            isEligible: false,
            reasonCodes: ['server-internal-code'],
          },
        ],
      },
    })

    await expect(
      listAllocationCandidates(
        {
          courseId: 3,
          startsAt: '2030-09-04T14:00:00.000Z',
          endsAt: '2030-09-04T16:00:00.000Z',
          minimumMark: 65,
          requestedHours: 2,
        },
        tokenGetter,
      ),
    ).rejects.toThrow('The allocation-candidate response did not match the agreed contract.')
  })

  it('lists and saves tutor marks', async () => {
    const mark = {
      id: 11,
      courseId: 3,
      courseCode: 'COMS3011',
      courseName: 'Software Design Project',
      mark: 75,
      activeAllocationCount: 1,
    }
    fetchWithBearerToken.mockResolvedValueOnce({ data: { marks: [mark] } })
    await expect(listTutorMarks(7, tokenGetter)).resolves.toEqual([mark])
    expect(fetchWithBearerToken).toHaveBeenLastCalledWith('/api/tutors/7/marks', {}, tokenGetter)

    fetchWithBearerToken.mockResolvedValueOnce({ data: { mark } })
    await expect(
      saveTutorMark({ tutorId: 7, courseId: 3, mark: 75 }, tokenGetter),
    ).resolves.toEqual(mark)
    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(
      '/api/tutors/7/marks',
      { method: 'PUT', body: JSON.stringify({ courseId: 3, mark: 75 }) },
      tokenGetter,
    )
  })

  it('loads approval queues, saves decisions and removes tutor rule inputs', async () => {
    const timesheet = {
      id: 31,
      tutorId: 7,
      tutorName: 'Sam Tutor',
      tutorEmail: 'sam@tutormx.example',
      weekStart: '2030-09-02',
      submittedAt: '2030-09-07T10:00:00.000Z',
      totalHours: 2,
      workLogs: [{
        id: 41,
        allocationId: 11,
        courseCode: 'COMS3011',
        courseName: 'Software Design Project',
        workDate: '2030-09-04',
        hours: 2,
        description: 'Tutorial',
      }],
    }
    const claim = {
      id: 51,
      overflowWorkId: 61,
      studentId: 9,
      studentName: 'Ada Student',
      studentEmail: 'ada@tutormx.example',
      courseCode: 'COMS3011',
      courseName: 'Software Design Project',
      startsAt: '2030-09-10T14:00:00.000Z',
      endsAt: '2030-09-10T16:00:00.000Z',
      hours: 2,
      createdAt: '2030-09-08T10:00:00.000Z',
    }
    const excuse = {
      id: 71,
      tutorId: 7,
      tutorName: 'Sam Tutor',
      tutorEmail: 'sam@tutormx.example',
      allocationId: 11,
      courseCode: 'COMS3011',
      courseName: 'Software Design Project',
      startsAt: '2030-09-11T14:00:00.000Z',
      endsAt: '2030-09-11T16:00:00.000Z',
      reason: 'Hospital appointment.',
      createdAt: '2030-09-09T08:00:00.000Z',
    }
    const queues = { timesheets: [timesheet], volunteerClaims: [claim], excuses: [excuse] }
    fetchWithBearerToken.mockResolvedValueOnce({ data: queues })
    await expect(listOrganiserApprovals(tokenGetter)).resolves.toEqual(queues)

    fetchWithBearerToken.mockResolvedValueOnce({ data: { timesheet: { id: 31 } } })
    await decideTimesheet({ timesheetId: 31, decision: 'RETURN', reason: 'Add notes' }, tokenGetter)
    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(
      '/api/timesheets/31/decision',
      { method: 'PATCH', body: JSON.stringify({ decision: 'RETURN', reason: 'Add notes' }) },
      tokenGetter,
    )

    fetchWithBearerToken.mockResolvedValueOnce({ data: { volunteerClaim: { id: 51 } } })
    await decideVolunteerClaim({ claimId: 51, decision: 'APPROVE' }, tokenGetter)
    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(
      '/api/volunteer-claims/51/decision',
      { method: 'PATCH', body: JSON.stringify({ decision: 'APPROVE' }) },
      tokenGetter,
    )

    fetchWithBearerToken.mockResolvedValue({})
    await deleteTutorMark({ tutorId: 7, courseId: 3 }, tokenGetter)
    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(
      '/api/tutors/7/marks/3',
      { method: 'DELETE' },
      tokenGetter,
    )
  })
})

describe('staffing requirement API contract', () => {
  beforeEach(() => {
    fetchWithBearerToken.mockReset()
    tokenGetter.mockReset()
  })

  const staffingRequirement = {
    id: 12,
    courseId: 3,
    courseCode: 'COMS3011',
    courseName: 'Software Design Project',
    startsAt: '2030-09-04T14:00:00.000Z',
    endsAt: '2030-09-04T18:00:00.000Z',
    tutorsNeeded: 2,
    windowHours: 4,
    requiredHours: 8,
    assignedHours: 5,
    shortageHours: 3,
    shortageTutors: 1,
    fillState: 'partially-filled',
    status: 'OPEN',
    notes: 'Lab cover',
    createdById: 8,
    createdAt: '2026-09-21T09:00:00.000Z',
    updatedAt: '2026-09-21T09:00:00.000Z',
  }

  const writeInput = {
    courseId: 3,
    startsAt: '2030-09-04T14:00:00.000Z',
    endsAt: '2030-09-04T18:00:00.000Z',
    tutorsNeeded: 2,
    notes: 'Lab cover',
  }

  it.each([
    ['no filters', {}, '/api/staffing-requirements'],
    ['a course filter', { courseId: 3 }, '/api/staffing-requirements?courseId=3'],
    ['a status filter', { status: 'OPEN' }, '/api/staffing-requirements?status=OPEN'],
    [
      'both filters',
      { courseId: 3, status: 'CLOSED' },
      '/api/staffing-requirements?courseId=3&status=CLOSED',
    ],
  ])('lists requirements with %s', async (_label, input, expectedUrl) => {
    fetchWithBearerToken.mockResolvedValueOnce({
      data: { staffingRequirements: [staffingRequirement] },
    })

    await expect(listStaffingRequirements(input, tokenGetter)).resolves.toEqual([
      staffingRequirement,
    ])
    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(expectedUrl, {}, tokenGetter)
  })

  it('creates, updates and changes the status of a requirement', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: { staffingRequirement } })

    await createStaffingRequirement(writeInput, tokenGetter)
    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(
      '/api/staffing-requirements',
      { method: 'POST', body: JSON.stringify(writeInput) },
      tokenGetter,
    )

    await updateStaffingRequirement({ requirementId: 12, ...writeInput }, tokenGetter)
    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(
      '/api/staffing-requirements/12',
      { method: 'PATCH', body: JSON.stringify(writeInput) },
      tokenGetter,
    )

    await setStaffingRequirementStatus({ requirementId: 12, status: 'CLOSED' }, tokenGetter)
    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(
      '/api/staffing-requirements/12/status',
      { method: 'PATCH', body: JSON.stringify({ status: 'CLOSED' }) },
      tokenGetter,
    )
  })

  it('omits notes from the body when they are not supplied', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: { staffingRequirement } })
    const { notes, ...withoutNotes } = writeInput
    expect(notes).toBe('Lab cover')

    await createStaffingRequirement(withoutNotes, tokenGetter)
    expect(JSON.parse(fetchWithBearerToken.mock.calls[0][1].body)).not.toHaveProperty('notes')
  })

  it.each([
    ['a list that is not an array', { data: { staffingRequirements: {} } }],
    ['an unknown status', { data: { staffingRequirements: [{ ...staffingRequirement, status: 'FILLED' }] } }],
    ['tutors sent as text', { data: { staffingRequirements: [{ ...staffingRequirement, tutorsNeeded: '2' }] } }],
    ['a fraction of a tutor', { data: { staffingRequirements: [{ ...staffingRequirement, tutorsNeeded: 1.5 }] } }],
    ['missing derived hours', { data: { staffingRequirements: [{ ...staffingRequirement, requiredHours: undefined }] } }],
    ['a missing course name', { data: { staffingRequirements: [{ ...staffingRequirement, courseName: undefined }] } }],
  ])('rejects %s', async (_label, body) => {
    fetchWithBearerToken.mockResolvedValueOnce(body)
    await expect(listStaffingRequirements({}, tokenGetter)).rejects.toThrow(
      /did not match the agreed contract/i,
    )
  })

  it('rejects a single requirement that does not match the contract', async () => {
    fetchWithBearerToken.mockResolvedValueOnce({ data: { staffingRequirement: { id: 12 } } })
    await expect(createStaffingRequirement(writeInput, tokenGetter)).rejects.toThrow(
      /did not match the agreed contract/i,
    )
  })
})
