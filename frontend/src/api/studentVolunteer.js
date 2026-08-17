const INITIAL_WORK = [
    [
      4,
       {
        id: 4,
        courseCode: 'DEMO101',
        courseName: 'Demo Course',
        startsAt: '2026-08-20T14:00:00.000Z',
        endsAt: '2026-08-20T16:00:00.000Z',
        hours: 2,
        status: 'OPEN',
        closesAt: null,
       },
    ],
    [
        5,
        {
        id: 5,
        courseCode: 'COMS3011',
        courseName: 'SDP',
        startsAt: '2026-08-22T09:00:00.000Z',
        endsAt: '2026-08-22T12:00:00.000Z',
        hours: 3,
        status: 'OPEN',
        closesAt: null,
        },
    ],
    [
        6,
        {
        id: 6,
        courseCode: 'COMS3006',
        courseName: 'CGV',
        startsAt: '2026-08-24T13:00:00.000Z',
        endsAt: '2026-08-24T15:00:00.000Z',
        hours: 2,
        status: 'CLOSED',
        closesAt: '2026-08-23T12:00:00.000Z'
        },
    ],
]

let mockWork = createMockWork()

function createMockWork() {
  return new Map(
    INITIAL_WORK.map(([id, work]) => [id, { ...work }]),
  )
}

export function resetVolunteerMock() {
  mockWork = createMockWork()
}

export async function volunteerForWork(workId) {
  const work = mockWork.get(workId)

  if (!work) {
    throw new Error('Work item could not be found.')
  }

  if (work.status !== 'OPEN') {
    const error = new Error(
      'This work item is no longer available.',
    )

    error.code = 'WORK_NOT_AVAILABLE'

    throw error
  }

  work.status = 'CLAIMED'

  return {
    id: work.id,
    courseCode: work.courseCode,
    courseName: work.courseName,
    startsAt: work.startsAt,
    endsAt: work.endsAt,
    hours: work.hours,
    status: work.status,
  }
}
