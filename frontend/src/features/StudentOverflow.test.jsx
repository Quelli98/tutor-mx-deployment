import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { StudentOverflow } from './StudentOverflow'

vi.mock('../api/client', () => ({
  useApiClient: () => vi.fn(),
}))

const openWork = {
  id: 4,
  courseCode: 'DEMO101',
  courseName: 'Demo Course',
  startsAt: '2026-08-20T14:00:00.000Z',
  endsAt: '2026-08-20T16:00:00.000Z',
  hours: 2,
  status: 'OPEN',
  closesAt: null,
}

const closedWork = {
  id: 6,
  courseCode: 'COMS3006',
  courseName: 'CGV',
  startsAt: '2026-08-24T13:00:00.000Z',
  endsAt: '2026-08-24T15:00:00.000Z',
  hours: 2,
  status: 'CLOSED',
  closesAt: '2026-08-23T12:00:00.000Z',
}

const pendingRequest = {
  id: 21,
  overflowWorkId: 4,
  courseCode: 'DEMO101',
  courseName: 'Demo Course',
  startsAt: '2026-08-20T14:00:00.000Z',
  endsAt: '2026-08-20T16:00:00.000Z',
  hours: 2,
  status: 'PENDING',
  reviewReason: null,
}

const approvedRequest = {
  id: 22,
  overflowWorkId: 5,
  courseCode: 'DEMO202',
  courseName: 'Second Course',
  startsAt: '2026-08-21T14:00:00.000Z',
  endsAt: '2026-08-21T15:00:00.000Z',
  hours: 1,
  status: 'ACCEPTED',
  reviewReason: null,
}

const rejectedRequest = {
  id: 23,
  overflowWorkId: 6,
  courseCode: 'COMS3006',
  courseName: 'CGV',
  startsAt: '2026-08-24T13:00:00.000Z',
  endsAt: '2026-08-24T15:00:00.000Z',
  hours: 2,
  status: 'REJECTED',
  reviewReason: 'Another student was selected.',
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

describe('StudentOverflow', () => {
  it('shows open work with the required details', async () => {
    const loadWorkItems = vi.fn().mockResolvedValue([openWork])

    renderPage(loadWorkItems)

    expect(
      screen.getByRole('heading', { name: /loading available work/i }),
    ).toBeInTheDocument()

    expect(await screen.findByText('DEMO101')).toBeInTheDocument()
    expect(screen.getByText('Demo Course')).toBeInTheDocument()
    expect(screen.getByText('2 hours')).toBeInTheDocument()
    expect(screen.getByText('Available to volunteer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^volunteer$/i })).toBeInTheDocument()
  })

  it('shows an empty state when there is no open work', async () => {
    const loadWorkItems = vi.fn().mockResolvedValue([])

    renderPage(loadWorkItems)

    expect(
      await screen.findByRole('heading', { name: /no open volunteer work/i }),
    ).toBeInTheDocument()

    expect(screen.getByText(/no open volunteer opportunities/i)).toBeInTheDocument()
  })

  it('does not allow volunteering for a closed item', async () => {
    const loadWorkItems = vi.fn().mockResolvedValue([closedWork])

    renderPage(loadWorkItems)

    expect(await screen.findByText('COMS3006')).toBeInTheDocument()
    expect(await screen.findByText('No longer available')).toBeInTheDocument()

    const unavailableButton = screen.getByRole('button', { name: /unavailable/i })
    expect(unavailableButton).toBeInTheDocument()
    expect(unavailableButton).toBeDisabled()
  })

  it('shows an error and allows retrying', async () => {
    const loadWorkItems = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce([openWork])

    renderPage(loadWorkItems)

    expect(
      await screen.findByRole('heading', { name: /unable to load volunteer work/i }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    expect(await screen.findByText('DEMO101')).toBeInTheDocument()

    await waitFor(() => {
      expect(loadWorkItems).toHaveBeenCalledTimes(2)
    })
  })

  it('opens confirmation when Volunteer is clicked', async () => {
    const user = userEvent.setup()
    const loadWorkItems = vi.fn().mockResolvedValue([openWork])

    renderPage(loadWorkItems)

    await screen.findByText('DEMO101')

    await user.click(screen.getByRole('button', { name: 'Volunteer' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()

    expect(
      screen.getByRole('heading', { name: 'Confirm volunteer' }),
    ).toBeInTheDocument()

    expect(
      screen.getByText(/are you sure you want to volunteer/i),
    ).toBeInTheDocument()

    expect(within(dialog).getByText(/DEMO101 — Demo Course/i)).toBeInTheDocument()

    expect(within(dialog).getByText('2 hours')).toBeInTheDocument()
  })

  it('supports the primary volunteer flow using only the keyboard', async () => {
    const user = userEvent.setup()
    const claimWork = vi.fn().mockResolvedValue({
      id: 21,
      overflowWorkId: openWork.id,
      status: 'PENDING',
    })

    renderPage(vi.fn().mockResolvedValue([openWork]), claimWork)

    const volunteerButton = await screen.findByRole('button', {
      name: /^volunteer$/i,
    })
    volunteerButton.focus()
    await user.keyboard('{Enter}')

    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    expect(cancelButton).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(
      await screen.findByRole('heading', { name: /volunteer request successful/i }),
    ).toBeInTheDocument()
    expect(claimWork).toHaveBeenCalledTimes(1)
  })

  it('closes confirmation without making a claim when Cancel is clicked', async () => {
    const user = userEvent.setup()

    const loadWorkItems = vi.fn().mockResolvedValue([openWork])
    const claimWork = vi.fn()

    renderPage(loadWorkItems, claimWork)

    await screen.findByText('DEMO101')

    await user.click(screen.getByRole('button', { name: 'Volunteer' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(claimWork).not.toHaveBeenCalled()
  })

  it('claims the work after Confirm is clicked', async () => {
    const user = userEvent.setup()

    const loadWorkItems = vi.fn().mockResolvedValue([openWork])
    const claimWork = vi.fn().mockResolvedValue({
      id: 21,
      overflowWorkId: openWork.id,
      status: 'PENDING',
    })

    renderPage(loadWorkItems, claimWork)

    await screen.findByText('DEMO101')

    await user.click(screen.getByRole('button', { name: 'Volunteer' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(claimWork).toHaveBeenCalledTimes(1)
    })

    expect(claimWork).toHaveBeenCalledWith(4)

    expect(
      await screen.findByRole('heading', { name: 'Volunteer request successful' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^volunteer$/i }),
    ).not.toBeInTheDocument()
  })

  it('prevents duplicate claim requests', async () => {
    const user = userEvent.setup()

    const loadWorkItems = vi.fn().mockResolvedValue([openWork])

    let resolveClaim
    const claimPromise = new Promise((resolve) => {
      resolveClaim = resolve
    })
    const claimWork = vi.fn().mockReturnValue(claimPromise)

    renderPage(loadWorkItems, claimWork)

    await screen.findByText('DEMO101')

    await user.click(screen.getByRole('button', { name: 'Volunteer' }))

    const confirmButton = screen.getByRole('button', { name: 'Confirm' })
    await user.click(confirmButton)

    expect(
      screen.getByRole('button', { name: 'Confirming...' }),
    ).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Confirming...' }))

    expect(claimWork).toHaveBeenCalledTimes(1)

    resolveClaim({ id: 21, overflowWorkId: openWork.id, status: 'PENDING' })

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Volunteer request successful' }),
      ).toBeInTheDocument()
    })
  })

  it('shows a safe message when the work is no longer available', async () => {
    const user = userEvent.setup()

    const loadWorkItems = vi.fn().mockResolvedValue([openWork])

    const error = new Error('This work item is no longer available.')
    error.code = 'OPEN_WORK_UNAVAILABLE'

    const claimWork = vi.fn().mockRejectedValue(error)

    renderPage(loadWorkItems, claimWork)

    await screen.findByText('DEMO101')

    await user.click(screen.getByRole('button', { name: 'Volunteer' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(
      await screen.findByRole('heading', { name: 'Volunteer request unsuccessful' }),
    ).toBeInTheDocument()

    expect(screen.getByText(/no longer available/i)).toBeInTheDocument()
  })

  it('shows a safe error when the claim fails unexpectedly', async () => {
    const user = userEvent.setup()

    const loadWorkItems = vi.fn().mockResolvedValue([openWork])
    const claimWork = vi.fn().mockRejectedValue(new Error('Database connection failed'))

    renderPage(loadWorkItems, claimWork)

    await screen.findByText('DEMO101')

    await user.click(screen.getByRole('button', { name: 'Volunteer' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(
      await screen.findByText(/could not complete your volunteer request/i),
    ).toBeInTheDocument()

    expect(screen.queryByText(/database connection failed/i)).not.toBeInTheDocument()
  })

  it('explains a duplicate persisted request without exposing internals', async () => {
    const user = userEvent.setup()
    const error = new Error('Unique constraint P2002')
    error.code = 'VOLUNTEER_REQUEST_DUPLICATE'

    renderPage(
      vi.fn().mockResolvedValue([openWork]),
      vi.fn().mockRejectedValue(error),
    )

    await screen.findByText('DEMO101')
    await user.click(screen.getByRole('button', { name: 'Volunteer' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(
      await screen.findByText(/already submitted a volunteer request/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/P2002/i)).not.toBeInTheDocument()
  })

  it('shows my volunteer requests with their persisted statuses', async () => {
    const loadWorkItems = vi.fn().mockResolvedValue([openWork])
    const loadRequests = vi
      .fn()
      .mockResolvedValue([pendingRequest, approvedRequest, rejectedRequest])

    renderPage(loadWorkItems, undefined, loadRequests)

    expect(
      await screen.findByRole('heading', { name: /my volunteer requests/i }),
    ).toBeInTheDocument()

    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Approved')).toBeInTheDocument()
    expect(screen.getByText('Rejected')).toBeInTheDocument()
    expect(screen.getByText('Another student was selected.')).toBeInTheDocument()
    expect(screen.getByText('DEMO202')).toBeInTheDocument()

    expect(loadRequests).toHaveBeenCalledTimes(1)
  })

  it('shows the pending outcome and refreshes the persisted requests after confirming', async () => {
    const user = userEvent.setup()

    const loadWorkItems = vi.fn().mockResolvedValue([openWork])
    const claimWork = vi.fn().mockResolvedValue({
      id: 21,
      overflowWorkId: openWork.id,
      status: 'PENDING',
    })
    const loadRequests = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([pendingRequest])

    renderPage(loadWorkItems, claimWork, loadRequests)

    await screen.findByText('DEMO101')

    await user.click(screen.getByRole('button', { name: 'Volunteer' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(
      await screen.findByRole('heading', { name: 'Volunteer request successful' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText(/your volunteer request for demo101 is pending/i),
    ).toBeInTheDocument()

    expect(
      await screen.findByRole('heading', { name: /my volunteer requests/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()

    expect(claimWork).toHaveBeenCalledTimes(1)
    expect(loadRequests).toHaveBeenCalledTimes(2)
  })

  it('shows an already-claimed outcome when another student claimed the work first', async () => {
    const user = userEvent.setup()

    const loadWorkItems = vi.fn().mockResolvedValue([openWork])

    const error = new Error('This work item is no longer available.')
    error.code = 'OPEN_WORK_UNAVAILABLE'

    const claimWork = vi.fn().mockRejectedValue(error)

    renderPage(loadWorkItems, claimWork)

    await screen.findByText('DEMO101')

    await user.click(screen.getByRole('button', { name: 'Volunteer' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(
      await screen.findByRole('heading', { name: 'Volunteer request unsuccessful' }),
    ).toBeInTheDocument()

    expect(screen.getByText(/no longer available/i)).toBeInTheDocument()

    expect(claimWork).toHaveBeenCalledTimes(1)
  })

  it('shows a safe requests error and allows retrying', async () => {
    const user = userEvent.setup()
    const loadWorkItems = vi.fn().mockResolvedValue([openWork])
    const loadRequests = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce([])

    renderPage(loadWorkItems, undefined, loadRequests)

    expect(
      await screen.findByText(/your volunteer requests could not be loaded/i),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('heading', { name: /my volunteer requests/i }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /retry requests/i }))

    expect(
      await screen.findByText(/have not submitted any volunteer requests yet/i),
    ).toBeInTheDocument()
    expect(loadRequests).toHaveBeenCalledTimes(2)
  })

  it('shows upcoming public holidays when the external API returns them', async () => {
    const loadWorkItems = vi.fn().mockResolvedValue([openWork])
    const futureDate = new Date(Date.now() + 86_400_000 * 30).toISOString().slice(0, 10)
    const loadHolidays = vi.fn().mockResolvedValue({
      source: 'external',
      holidays: [
        { date: futureDate, name: 'Heritage Day', nationalHoliday: true },
      ],
      retrievedAt: '2026-09-11T10:00:00.000Z',
    })

    renderPage(loadWorkItems, undefined, undefined, loadHolidays)

    expect(
      await screen.findByRole('heading', { name: /upcoming public holidays/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('Heritage Day')).toBeInTheDocument()
    expect(screen.getByText('National')).toBeInTheDocument()
    expect(screen.getByText('External data')).toBeInTheDocument()
    expect(screen.getByText(/updated/i)).toBeInTheDocument()
  })

  it('shows a fallback message when the external holiday service is unavailable', async () => {
    const loadWorkItems = vi.fn().mockResolvedValue([openWork])
    const loadHolidays = vi.fn().mockResolvedValue({
      source: 'fallback',
      holidays: [],
      retrievedAt: null,
    })

    renderPage(loadWorkItems, undefined, undefined, loadHolidays)

    expect(
      await screen.findByText(/public holiday information is temporarily unavailable/i),
    ).toBeInTheDocument()
  })

  it('shows a safe fallback when the holiday API throws', async () => {
    const loadWorkItems = vi.fn().mockResolvedValue([openWork])
    const loadHolidays = vi.fn().mockRejectedValue(new Error('Network error'))

    renderPage(loadWorkItems, undefined, undefined, loadHolidays)

    expect(
      await screen.findByText(/public holiday information is temporarily unavailable/i),
    ).toBeInTheDocument()
  })

  it('does not break the volunteer flow when holidays fail to load', async () => {
    const user = userEvent.setup()
    const loadWorkItems = vi.fn().mockResolvedValue([openWork])
    const claimWork = vi.fn().mockResolvedValue({
      id: 21,
      overflowWorkId: openWork.id,
      status: 'PENDING',
    })
    const loadHolidays = vi.fn().mockRejectedValue(new Error('Network error'))

    renderPage(loadWorkItems, claimWork, undefined, loadHolidays)

    await screen.findByText('DEMO101')

    await user.click(screen.getByRole('button', { name: 'Volunteer' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(
      await screen.findByRole('heading', { name: 'Volunteer request successful' }),
    ).toBeInTheDocument()
    expect(claimWork).toHaveBeenCalledTimes(1)
  })
})
