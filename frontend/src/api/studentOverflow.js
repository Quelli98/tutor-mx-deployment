const MOCK_STUDENT_WORK = [
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

    {
        id: 6,
        courseCode: 'COMS3006',
        courseName: 'CGV',
        startsAt: '2026-08-24T13:00:00.000Z',
        endsAt: '2026-08-24T15:00:00.000Z',
        hours: 2,
        status: 'CLOSED',
        closesAt: '2026-08-23T12:00:00.000Z',
    },
]

export async function getStudentOverflowWork() {
    return MOCK_STUDENT_WORK
}
