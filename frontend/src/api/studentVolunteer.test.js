import { beforeEach, describe, expect, it, } from 'vitest'
import { resetVolunteerMock, volunteerForWork, } from './studentVolunteer'

describe('volunteerForWork', () => {
  beforeEach(() => {
    resetVolunteerMock()
  })

  it('claims an open work item', async () => {
    const result = await volunteerForWork(5)

    expect(result).toMatchObject({
      id: 5,
      courseCode: 'COMS3011',
      courseName: 'SDP',
      hours: 3,
      status: 'CLAIMED',
    })
  })

  it('rejects a closed work item', async () => {
    await expect(
      volunteerForWork(6),
    ).rejects.toMatchObject({
      code: 'WORK_NOT_AVAILABLE',
    })
  })

  it('rejects an unknown work item', async () => {
    await expect(
      volunteerForWork(999),
    ).rejects.toThrow(
      'Work item could not be found.',
    )
  })

  it('does not allow the same work item to be claimed twice', async () => {
    await volunteerForWork(5)

    await expect(
      volunteerForWork(5),
    ).rejects.toMatchObject({
      code: 'WORK_NOT_AVAILABLE',
    })
  })
})