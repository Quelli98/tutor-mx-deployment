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

function renderPage(loadWorkItems, claimWork) {
  render(
    <MemoryRouter>
      <StudentOverflow loadWorkItems={loadWorkItems} claimWork={claimWork} />
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
      ...openWork,
      status: 'CLAIMED',
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

    resolveClaim({ ...openWork, status: 'CLAIMED' })

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
    error.code = 'WORK_NOT_AVAILABLE'

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
})
