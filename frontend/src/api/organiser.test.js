import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTutor,
  createTutorTimeSlot,
  createCourse,
  deleteCourse,
  listAllocationCandidates,
  listCourses,
  listTutorMarks,
  listTutorTimeSlots,
  listTutors,
  saveTutorMark,
  updateCourse,
  updateTutor,
} from './organiser'

const fetchWithBearerToken = vi.fn()

vi.mock('./client', () => ({
  fetchWithBearerToken: (...args) => fetchWithBearerToken(...args),
}))

const tokenGetter = vi.fn()

const course = { id: 1, code: 'DEMO101', name: 'Demo Course' }
const tutor = {
  id: 7,
  auth0Id: 'auth0|tutor-7',
  email: 'tutor@tutormx.example',
  fullName: 'Sam Tutor',
  role: 'TUTOR',
  weeklyHours: 10,
}

describe('organiser course API contract', () => {
  beforeEach(() => {
    fetchWithBearerToken.mockReset()
    tokenGetter.mockReset()
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

  it('posts the exact tutor create payload', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: { tutor } })

    await expect(
      createTutor(
        {
          auth0Id: 'auth0|tutor-7',
          email: 'tutor@tutormx.example',
          fullName: 'Sam Tutor',
          weeklyHours: 10,
        },
        tokenGetter,
      ),
    ).resolves.toEqual(tutor)
    expect(fetchWithBearerToken).toHaveBeenCalledWith(
      '/api/tutors',
      {
        method: 'POST',
        body: JSON.stringify({
          auth0Id: 'auth0|tutor-7',
          email: 'tutor@tutormx.example',
          fullName: 'Sam Tutor',
          weeklyHours: 10,
        }),
      },
      tokenGetter,
    )
  })

  it('accepts an unconfigured weekly-hour limit as null', async () => {
    const unconfigured = { ...tutor, id: 8, weeklyHours: null }
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

  it('does not send the tutor identifier in the update body', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: { tutor } })

    await expect(
      updateTutor({ tutorId: 7, weeklyHours: 12 }, tokenGetter),
    ).resolves.toEqual(tutor)
    expect(fetchWithBearerToken).toHaveBeenCalledWith(
      '/api/tutors/7',
      {
        method: 'PATCH',
        body: JSON.stringify({ weeklyHours: 12 }),
      },
      tokenGetter,
    )

    const [, options] = fetchWithBearerToken.mock.calls[0]
    expect(JSON.parse(options.body)).not.toHaveProperty('tutorId')
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

  it('lists and creates tutor time slots', async () => {
    const timeSlot = {
      id: 9,
      type: 'BUSY',
      startsAt: '2030-09-04T14:00:00.000Z',
      endsAt: '2030-09-04T16:00:00.000Z',
      recurrence: 'WEEKLY',
    }
    fetchWithBearerToken.mockResolvedValueOnce({ data: { timeSlots: [timeSlot] } })
    await expect(listTutorTimeSlots(7, tokenGetter)).resolves.toEqual([timeSlot])
    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(
      '/api/tutors/7/time-slots',
      {},
      tokenGetter,
    )

    fetchWithBearerToken.mockResolvedValueOnce({ data: { timeSlot } })
    await expect(
      createTutorTimeSlot(
        {
          tutorId: 7,
          type: 'BUSY',
          startsAt: timeSlot.startsAt,
          endsAt: timeSlot.endsAt,
          recurrence: 'WEEKLY',
        },
        tokenGetter,
      ),
    ).resolves.toEqual(timeSlot)
    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(
      '/api/tutors/7/time-slots',
      {
        method: 'POST',
        body: JSON.stringify({
          type: 'BUSY',
          startsAt: timeSlot.startsAt,
          endsAt: timeSlot.endsAt,
          recurrence: 'WEEKLY',
        }),
      },
      tokenGetter,
    )
  })
})
