import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getVolunteerRequests,
  volunteerForWork,
  withdrawVolunteerRequest,
} from './studentVolunteer'
import { fetchWithBearerToken } from './client'

vi.mock('./client', () => ({
  fetchWithBearerToken: vi.fn(),
}))

describe('student volunteer API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the signed-in student persisted requests and outcomes', async () => {
    const requests = [
      {
        id: 21,
        overflowWorkId: 4,
        courseCode: 'DEMO101',
        courseName: 'Demo Course',
        startsAt: '2030-09-06T10:00:00.000Z',
        endsAt: '2030-09-06T12:00:00.000Z',
        hours: 2,
        status: 'PENDING',
        reviewReason: null,
      },
    ]
    fetchWithBearerToken.mockResolvedValue({
      data: { volunteerRequests: requests },
    })

    await expect(getVolunteerRequests(vi.fn())).resolves.toEqual(requests)
    expect(fetchWithBearerToken).toHaveBeenCalledWith(
      '/api/student/volunteer-requests',
      {},
      expect.any(Function),
    )
  })

  it('posts the selected work ID without a browser-supplied student ID', async () => {
    const request = {
      id: 21,
      overflowWorkId: 4,
      status: 'PENDING',
      reviewReason: null,
      createdAt: '2030-09-01T08:00:00.000Z',
      updatedAt: '2030-09-01T08:00:00.000Z',
    }
    fetchWithBearerToken.mockResolvedValue({
      data: { volunteerRequest: request },
    })

    await expect(volunteerForWork(4, vi.fn())).resolves.toEqual(request)
    expect(fetchWithBearerToken).toHaveBeenCalledWith(
      '/api/student/volunteer-requests',
      {
        method: 'POST',
        body: JSON.stringify({ overflowWorkId: 4 }),
      },
      expect.any(Function),
    )
  })

  it.each([
    [{ data: {} }, getVolunteerRequests],
    [{ data: { volunteerRequest: { id: 21, overflowWorkId: 99 } } },
      (token) => volunteerForWork(4, token)],
  ])('rejects an invalid backend contract', async (body, action) => {
    fetchWithBearerToken.mockResolvedValue(body)

    await expect(action(vi.fn())).rejects.toThrow(/agreed contract/i)
  })

  it('withdraws the signed-in student request through the existing PATCH route', async () => {
    const request = {
      id: 21,
      overflowWorkId: 4,
      status: 'WITHDRAWN',
      reviewReason: null,
      createdAt: '2030-09-01T08:00:00.000Z',
      updatedAt: '2030-09-02T09:30:00.000Z',
    }
    fetchWithBearerToken.mockResolvedValue({
      data: { volunteerRequest: request },
    })

    await expect(withdrawVolunteerRequest(21, vi.fn())).resolves.toEqual(request)
    expect(fetchWithBearerToken).toHaveBeenCalledWith(
      '/api/student/volunteer-requests/21/withdraw',
      { method: 'PATCH' },
      expect.any(Function),
    )
  })

  it.each([
    [{ data: {} }],
    [{ data: { volunteerRequest: { id: 21, overflowWorkId: 4 } } }],
    [
      {
        data: {
          volunteerRequest: {
            id: 21,
            overflowWorkId: 4,
            status: 'PENDING',
          },
        },
      },
    ],
    [
      {
        data: {
          volunteerRequest: {
            id: 99,
            overflowWorkId: 4,
            status: 'WITHDRAWN',
          },
        },
      },
    ],
  ])('rejects an invalid withdrawal response %#', async (body) => {
    fetchWithBearerToken.mockResolvedValue(body)

    await expect(withdrawVolunteerRequest(21, vi.fn())).rejects.toThrow(
      /agreed contract/i,
    )
  })
})
