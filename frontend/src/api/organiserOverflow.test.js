import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeOrganiserOverflowWork,
  createOrganiserOverflowWork,
  listOrganiserOverflowWork,
  updateOrganiserOverflowWork,
} from './organiserOverflow'

const fetchWithBearerToken = vi.fn()

vi.mock('./client', () => ({
  fetchWithBearerToken: (...args) => fetchWithBearerToken(...args),
}))

const tokenGetter = vi.fn()

const VERSION = '2026-09-23T09:00:00.000Z'

const overflowWork = {
  id: 4,
  courseId: 3,
  courseCode: 'COMS3011',
  courseName: 'Software Design Project',
  startsAt: '2030-09-04T14:00:00.000Z',
  endsAt: '2030-09-04T18:00:00.000Z',
  hours: 4,
  windowHours: 4,
  status: 'OPEN',
  closesAt: null,
  sourceRequirementId: 12,
  pendingClaims: 0,
  acceptedClaims: 0,
  createdAt: '2026-09-20T09:00:00.000Z',
  updatedAt: VERSION,
}

const writeInput = {
  courseId: 3,
  startsAt: '2030-09-04T14:00:00.000Z',
  endsAt: '2030-09-04T18:00:00.000Z',
  hours: 4,
  closesAt: null,
}

describe('organiser overflow work API contract', () => {
  beforeEach(() => {
    fetchWithBearerToken.mockReset()
    tokenGetter.mockReset()
  })

  it('requests every overflow item for the organiser', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: { overflowWork: [overflowWork] } })

    await expect(listOrganiserOverflowWork(tokenGetter)).resolves.toEqual([overflowWork])
    expect(fetchWithBearerToken).toHaveBeenCalledWith(
      '/api/organiser/overflow-work',
      {},
      tokenGetter,
    )
  })

  it('posts work with no source requirement as an explicit null', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: { overflowWork } })

    await createOrganiserOverflowWork(writeInput, tokenGetter)

    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(
      '/api/organiser/overflow-work',
      {
        method: 'POST',
        body: JSON.stringify({ ...writeInput, sourceRequirementId: null }),
      },
      tokenGetter,
    )
  })

  it('keeps the source requirement when converting a shortage', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: { overflowWork } })

    await createOrganiserOverflowWork({ ...writeInput, sourceRequirementId: 12 }, tokenGetter)

    expect(JSON.parse(fetchWithBearerToken.mock.calls[0][1].body)).toMatchObject({
      sourceRequirementId: 12,
    })
  })

  it('edits by identifier with the version the organiser was shown', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: { overflowWork } })

    await updateOrganiserOverflowWork(
      { ...writeInput, overflowWorkId: 4, hours: 3, expectedUpdatedAt: VERSION },
      tokenGetter,
    )

    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(
      '/api/organiser/overflow-work/4',
      {
        method: 'PATCH',
        body: JSON.stringify({ ...writeInput, hours: 3, expectedUpdatedAt: VERSION }),
      },
      tokenGetter,
    )
  })

  it('closes with nothing but the expected version', async () => {
    fetchWithBearerToken.mockResolvedValue({ data: { overflowWork } })

    await closeOrganiserOverflowWork({ overflowWorkId: 4, expectedUpdatedAt: VERSION }, tokenGetter)

    expect(fetchWithBearerToken).toHaveBeenLastCalledWith(
      '/api/organiser/overflow-work/4/close',
      {
        method: 'PATCH',
        body: JSON.stringify({ expectedUpdatedAt: VERSION }),
      },
      tokenGetter,
    )
  })

  it('accepts closed work that carries a deadline and decided claims', async () => {
    const closed = {
      ...overflowWork,
      status: 'CLOSED',
      closesAt: '2030-09-01T09:00:00.000Z',
      sourceRequirementId: null,
      acceptedClaims: 1,
    }
    fetchWithBearerToken.mockResolvedValue({ data: { overflowWork: [closed] } })

    await expect(listOrganiserOverflowWork(tokenGetter)).resolves.toEqual([closed])
  })

  it.each([
    ['a list that is not an array', { data: { overflowWork: {} } }],
    ['an unknown status', { data: { overflowWork: [{ ...overflowWork, status: 'DRAFT' }] } }],
    ['hours sent as text', { data: { overflowWork: [{ ...overflowWork, hours: '4' }] } }],
    ['a missing course name', { data: { overflowWork: [{ ...overflowWork, courseName: undefined }] } }],
    ['claims sent as text', { data: { overflowWork: [{ ...overflowWork, pendingClaims: '1' }] } }],
    ['a source requirement that is not a number', { data: { overflowWork: [{ ...overflowWork, sourceRequirementId: '12' }] } }],
    ['a deadline that is not a date', { data: { overflowWork: [{ ...overflowWork, closesAt: 'soon' }] } }],
    ['a missing version', { data: { overflowWork: [{ ...overflowWork, updatedAt: undefined }] } }],
  ])('rejects %s', async (_label, body) => {
    fetchWithBearerToken.mockResolvedValueOnce(body)

    await expect(listOrganiserOverflowWork(tokenGetter)).rejects.toThrow(
      /did not match the agreed contract/i,
    )
  })

  it('rejects a single item that does not match the contract', async () => {
    fetchWithBearerToken.mockResolvedValueOnce({ data: { overflowWork: { id: 4 } } })

    await expect(createOrganiserOverflowWork(writeInput, tokenGetter)).rejects.toThrow(
      /did not match the agreed contract/i,
    )
  })
})
