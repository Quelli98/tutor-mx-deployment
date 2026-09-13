import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithBearerToken } from './client'
import { getStudentOverflowWork } from './studentOverflow'

vi.mock('./client', () => ({
  fetchWithBearerToken: vi.fn(),
}))

describe('getStudentOverflowWork', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads real open work for the signed-in student', async () => {
    const workItems = [
      {
        id: 4,
        courseCode: 'DEMO101',
        courseName: 'Demo Course',
        startsAt: '2030-09-06T10:00:00.000Z',
        endsAt: '2030-09-06T12:00:00.000Z',
        hours: 2,
        status: 'OPEN',
        closesAt: null,
      },
    ]
    fetchWithBearerToken.mockResolvedValue({ data: { workItems } })

    await expect(getStudentOverflowWork(vi.fn())).resolves.toEqual(workItems)
    expect(fetchWithBearerToken).toHaveBeenCalledWith(
      '/api/student/open-work',
      {},
      expect.any(Function),
    )
  })

  it('rejects an invalid open-work response', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: {} })

    await expect(getStudentOverflowWork(vi.fn())).rejects.toThrow(
      /agreed contract/i,
    )
  })
})
