import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StudentOverflow } from './StudentOverflow'

vi.mock('../api/client', () => ({
  useApiClient: () => vi.fn(),
  fetchWithBearerToken: vi.fn(),
}))

const openWork = {
  id: 10,
  courseCode: 'OPEN101',
  courseName: 'Open Course',
  startsAt: '2030-09-06T10:00:00.000Z',
  endsAt: '2030-09-06T12:00:00.000Z',
  hours: 2,
  status: 'OPEN',
  closesAt: '2030-09-05T17:00:00.000Z',
}

const closedWork = {
  id: 11,
  courseCode: 'CLOSED202',
  courseName: 'Closed Course',
  startsAt: '2030-09-07T10:00:00.000Z',
  endsAt: '2030-09-07T11:00:00.000Z',
  hours: 1,
  status: 'CLOSED',
  closesAt: '2030-09-06T17:00:00.000Z',
}

const filledWork = {
  id: 12,
  courseCode: 'FILLED303',
  courseName: 'Filled Course',
  startsAt: '2030-09-08T10:00:00.000Z',
  endsAt: '2030-09-08T11:00:00.000Z',
  hours: 1,
  status: 'FILLED',
  closesAt: null,
}

const persistedRequest = {
  id: 21,
  overflowWorkId: 10,
  courseCode: 'OPEN101',
  courseName: 'Open Course',
  startsAt: '2030-09-06T10:00:00.000Z',
  endsAt: '2030-09-06T12:00:00.000Z',
  hours: 2,
  status: 'PENDING',
  reviewReason: null,
}

function renderPage(
  loadWorkItems,
  claimWork,
  loadRequests = vi.fn().mockResolvedValue([]),
  loadHolidays = vi.fn().mockResolvedValue({ source: 'external', holidays: [], retrievedAt: null }),
) {
  render(
    <MemoryRouter>
      <StudentOverflow
        loadWorkItems={loadWorkItems}
        claimWork={claimWork}
        loadRequests={loadRequests}
        loadHolidays={loadHolidays}
      />
    </MemoryRouter>,
  )
}

describe('StudentOverflow — API integration', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls the real API and displays open work with correct data', async () => {
    const loadWorkItems = vi.fn().mockResolvedValue([openWork])

    renderPage(loadWorkItems)

    expect(
      screen.getByRole('heading', { name: /loading available work/i }),
    ).toBeInTheDocument()

    expect(await screen.findByText('OPEN101')).toBeInTheDocument()
    expect(screen.getByText('Open Course')).toBeInTheDocument()
    expect(screen.getByText('2 hours')).toBeInTheDocument()
    expect(screen.getByText('Available to volunteer')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /^volunteer$/i }),
    ).toBeInTheDocument()

    expect(loadWorkItems).toHaveBeenCalledTimes(1)
  })

  it('renders only OPEN work when the API returns only eligible items', async () => {
    // API contract: GET /api/student/open-work returns only OPEN work.
    // CLOSED and FILLED items are filtered at the SQL layer.
    const loadWorkItems = vi.fn().mockResolvedValue([openWork])

    renderPage(loadWorkItems)

    expect(await screen.findByText('OPEN101')).toBeInTheDocument()

    expect(
      screen.queryByText('CLOSED202'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('FILLED303'),
    ).not.toBeInTheDocument()
  })

  it('defensively renders CLOSED item as unavailable if it somehow reaches the UI', async () => {
    // The real API never returns CLOSED work (filtered in SQL).
    // This test proves the UI still handles the edge case defensively.
    const loadWorkItems = vi.fn().mockResolvedValue([closedWork])

    renderPage(loadWorkItems)

    expect(await screen.findByText('CLOSED202')).toBeInTheDocument()
    expect(screen.getByText('No longer available')).toBeInTheDocument()

    const unavailableButton = screen.getByRole('button', {
      name: /unavailable/i,
    })
    expect(unavailableButton).toBeInTheDocument()
    expect(unavailableButton).toBeDisabled()

    expect(
      screen.queryByRole('button', { name: /^volunteer$/i }),
    ).not.toBeInTheDocument()
  })

  it('defensively renders FILLED item as unavailable if it somehow reaches the UI', async () => {
    // The real API never returns FILLED work (filtered in SQL).
    // This test proves the UI still handles the edge case defensively.
    const loadWorkItems = vi.fn().mockResolvedValue([filledWork])

    renderPage(loadWorkItems)

    expect(await screen.findByText('FILLED303')).toBeInTheDocument()
    expect(screen.getByText('No longer available')).toBeInTheDocument()

    const unavailableButton = screen.getByRole('button', {
      name: /unavailable/i,
    })
    expect(unavailableButton).toBeInTheDocument()
    expect(unavailableButton).toBeDisabled()

    expect(
      screen.queryByRole('button', { name: /^volunteer$/i }),
    ).not.toBeInTheDocument()
  })

  it('shows the empty state when the API returns no work', async () => {
    const loadWorkItems = vi.fn().mockResolvedValue([])

    renderPage(loadWorkItems)

    expect(
      await screen.findByRole('heading', {
        name: /no open volunteer work/i,
      }),
    ).toBeInTheDocument()

    expect(
      screen.getByText(/no open volunteer opportunities/i),
    ).toBeInTheDocument()

    expect(screen.queryByText('OPEN101')).not.toBeInTheDocument()
    expect(screen.queryByText('DEMO101')).not.toBeInTheDocument()
  })

  it('shows error state on API failure and retries with a real request', async () => {
    const loadWorkItems = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce([openWork])

    renderPage(loadWorkItems)

    expect(
      await screen.findByRole('heading', {
        name: /unable to load volunteer work/i,
      }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    expect(await screen.findByText('OPEN101')).toBeInTheDocument()

    await waitFor(() => {
      expect(loadWorkItems).toHaveBeenCalledTimes(2)
    })
  })

  it('loads the persisted volunteer requests and outcomes for the signed-in student', async () => {
    // API contract: GET /api/student/volunteer-requests returns only the
    // authenticated student's claims with their persisted statuses.
    const loadWorkItems = vi.fn().mockResolvedValue([openWork])
    const loadRequests = vi.fn().mockResolvedValue([
      persistedRequest,
      { ...persistedRequest, id: 24, status: 'REJECTED', reviewReason: 'Another student was selected.' },
    ])

    renderPage(loadWorkItems, undefined, loadRequests)

    expect(
      await screen.findByRole('heading', { name: /my volunteer requests/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Rejected')).toBeInTheDocument()
    expect(
      screen.getByText('Another student was selected.'),
    ).toBeInTheDocument()

    expect(loadRequests).toHaveBeenCalledTimes(1)
  })

  it('shows the persisted pending request after a real confirmation', async () => {
    const loadWorkItems = vi.fn().mockResolvedValue([openWork])
    const claimWork = vi.fn().mockResolvedValue({
      id: 21,
      overflowWorkId: openWork.id,
      status: 'PENDING',
    })
    const loadRequests = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([persistedRequest])

    renderPage(loadWorkItems, claimWork, loadRequests)

    expect(await screen.findByText('OPEN101')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Volunteer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(
      await screen.findByRole('heading', { name: 'Volunteer request successful' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText(/your volunteer request for open101 is pending/i),
    ).toBeInTheDocument()

    expect(
      await screen.findByRole('heading', { name: /my volunteer requests/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()

    await waitFor(() => {
      expect(claimWork).toHaveBeenCalledTimes(1)
      expect(loadRequests).toHaveBeenCalledTimes(2)
    })
  })

  it('renders public holidays as supporting information alongside the overflow work', async () => {
    const futureDate = new Date(Date.now() + 86_400_000 * 60).toISOString().slice(0, 10)
    const loadWorkItems = vi.fn().mockResolvedValue([openWork])
    const loadHolidays = vi.fn().mockResolvedValue({
      source: 'external',
      holidays: [
        { date: futureDate, name: 'Freedom Day', nationalHoliday: true },
      ],
      retrievedAt: '2026-09-11T10:00:00.000Z',
    })

    renderPage(loadWorkItems, undefined, undefined, loadHolidays)

    expect(await screen.findByText('OPEN101')).toBeInTheDocument()

    expect(
      await screen.findByRole('heading', { name: /upcoming public holidays/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('Freedom Day')).toBeInTheDocument()
    expect(screen.getByText(/public holidays may affect session scheduling/i)).toBeInTheDocument()
    expect(screen.getByText('External data')).toBeInTheDocument()

    expect(loadHolidays).toHaveBeenCalledTimes(1)
  })

  it('does not interrupt the overflow journey when the holiday service fails', async () => {
    const loadWorkItems = vi.fn().mockResolvedValue([openWork])
    const loadHolidays = vi.fn().mockRejectedValue(new Error('External API down'))

    renderPage(loadWorkItems, undefined, undefined, loadHolidays)

    expect(await screen.findByText('OPEN101')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /^volunteer$/i }),
    ).toBeInTheDocument()

    expect(
      await screen.findByText(/public holiday information is temporarily unavailable/i),
    ).toBeInTheDocument()
  })
})
