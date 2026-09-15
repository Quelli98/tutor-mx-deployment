import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TutorDashboard from './TutorDashboard'

const mockFetchTutorDashboard = vi.fn()
const tokenGetter = vi.fn()

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently: tokenGetter }),
}))
vi.mock('../api/tutorDashboard', () => ({
  fetchTutorDashboard: (...args) => mockFetchTutorDashboard(...args),
}))

const allocationA = {
  allocations: [
    {
      id: 1,
      courseCode: 'COMS3011A',
      courseName: 'Software Design',
      startsAt: '2030-09-04T14:00:00.000Z',
      endsAt: '2030-09-04T16:00:00.000Z',
      allocatedHours: 2,
      status: 'CONFIRMED',
    },
  ],
  weeklyLimit: 10,
  usedHours: 2,
  remainingHours: 8,
}

const allocationB = {
  allocations: [
    {
      id: 2,
      courseCode: 'COMS3006',
      courseName: 'Computer Graphics',
      startsAt: '2030-09-11T08:00:00.000Z',
      endsAt: '2030-09-11T10:00:00.000Z',
      allocatedHours: 4,
      status: 'PROPOSED',
    },
  ],
  weeklyLimit: 10,
  usedHours: 6,
  remainingHours: 4,
}

const unsetLimitDashboard = {
  allocations: [],
  weeklyLimit: null,
  usedHours: 0,
  remainingHours: null,
}

describe('TutorDashboard', () => {
  beforeEach(() => {
    mockFetchTutorDashboard.mockReset()
  })

  it('shows own course/session, date/time, hours and weekly summary', async () => {
    mockFetchTutorDashboard.mockResolvedValue({
      allocations: [
        {
          id: 1,
          courseCode: 'COMS3011A',
          courseName: 'Software Design',
          startsAt: '2030-09-04T14:00:00.000Z',
          endsAt: '2030-09-04T16:00:00.000Z',
          allocatedHours: 2,
          status: 'CONFIRMED',
        },
      ],
      weeklyLimit: 10,
      usedHours: 6,
      remainingHours: 4,
    })

    render(<TutorDashboard />)

    expect(await screen.findByText(/COMS3011A - Software Design/i)).toBeInTheDocument()
    expect(screen.getByText(/4 of 10 hours remaining/i)).toBeInTheDocument()
    expect(screen.getByText('2h')).toBeInTheDocument()
    expect(mockFetchTutorDashboard).toHaveBeenCalledWith(tokenGetter)
  })

  it('shows a clear no-work state', async () => {
    mockFetchTutorDashboard.mockResolvedValue({
      allocations: [],
      weeklyLimit: 10,
      usedHours: 0,
      remainingHours: 10,
    })
    render(<TutorDashboard />)
    expect(await screen.findByText(/no work assigned/i)).toBeInTheDocument()
  })


  it('keeps a newly onboarded tutor dashboard usable before an hour limit is configured', async () => {
    mockFetchTutorDashboard.mockResolvedValue({
      allocations: [],
      weeklyLimit: null,
      usedHours: 0,
      remainingHours: null,
    })

    render(<TutorDashboard />)

    expect(await screen.findByText(/Weekly work capacity not set/i)).toBeInTheDocument()
    expect(screen.getByText(/no work assigned/i)).toBeInTheDocument()
    expect(screen.queryByText(/dashboard unavailable/i)).not.toBeInTheDocument()
  })

  it('shows loading and retries after a safe error', async () => {
    mockFetchTutorDashboard.mockRejectedValueOnce(new Error('private detail'))
    render(<TutorDashboard />)

    expect(screen.getByRole('status')).toHaveTextContent(/loading/i)
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i)
    expect(screen.queryByText(/private detail/i)).not.toBeInTheDocument()

    mockFetchTutorDashboard.mockResolvedValueOnce({
      allocations: [],
      weeklyLimit: 10,
      usedHours: 0,
      remainingHours: 10,
    })
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => {
      expect(screen.getByText(/no work assigned/i)).toBeInTheDocument()
    })
  })

  it('refreshes assignments and hours after an organiser changes allocations', async () => {
    mockFetchTutorDashboard.mockResolvedValueOnce(allocationA).mockResolvedValueOnce(allocationB)

    render(<TutorDashboard />)

    expect(await screen.findByText(/COMS3011A - Software Design/i)).toBeInTheDocument()
    expect(screen.getByText(/8 of 10 hours remaining/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByText(/COMS3006 - Computer Graphics/i)).toBeInTheDocument()
    expect(screen.getByText(/4 of 10 hours remaining/i)).toBeInTheDocument()
    expect(screen.queryByText(/COMS3011A - Software Design/i)).not.toBeInTheDocument()
    expect(mockFetchTutorDashboard).toHaveBeenCalledTimes(2)
  })

  it('keeps the last safe dashboard on screen when a refresh fails, and retry recovers', async () => {
    mockFetchTutorDashboard
      .mockResolvedValueOnce(allocationA)
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce(allocationB)

    render(<TutorDashboard />)
    expect(await screen.findByText(/COMS3011A - Software Design/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent(/refresh failed/i)
    expect(screen.getByText(/COMS3011A - Software Design/i)).toBeInTheDocument()
    expect(screen.getByText(/8 of 10 hours remaining/i)).toBeInTheDocument()
    expect(screen.queryByText(/temporary network failure/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText(/COMS3006 - Computer Graphics/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(/4 of 10 hours remaining/i)).toBeInTheDocument()
  })

  it('refetches quietly when the window regains focus', async () => {
    mockFetchTutorDashboard.mockResolvedValueOnce(allocationA).mockResolvedValueOnce(allocationB)

    render(<TutorDashboard />)
    expect(await screen.findByText(/COMS3011A - Software Design/i)).toBeInTheDocument()

    fireEvent(window, new Event('focus'))

    expect(await screen.findByText(/COMS3006 - Computer Graphics/i)).toBeInTheDocument()
    expect(mockFetchTutorDashboard).toHaveBeenCalledTimes(2)
  })

  it('does not stack refreshes when focus fires while a refresh is already running', async () => {
    mockFetchTutorDashboard
      .mockResolvedValueOnce(allocationA)
      .mockImplementationOnce(() => new Promise(() => {}))

    render(<TutorDashboard />)
    expect(await screen.findByText(/COMS3011A - Software Design/i)).toBeInTheDocument()

    fireEvent(window, new Event('focus'))
    fireEvent(window, new Event('focus'))

    expect(mockFetchTutorDashboard).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Refreshing...' })).toBeDisabled()
  })

  it('keeps the unset hour limit state usable across refreshes and shows a later configured limit', async () => {
    mockFetchTutorDashboard
      .mockResolvedValueOnce(unsetLimitDashboard)
      .mockResolvedValueOnce(unsetLimitDashboard)
      .mockResolvedValueOnce(allocationB)

    render(<TutorDashboard />)
    expect(await screen.findByText(/Weekly work capacity not set/i)).toBeInTheDocument()
    expect(screen.getByText(/no work assigned/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByText(/Weekly work capacity not set/i)).toBeInTheDocument()
    expect(screen.getByText(/no work assigned/i)).toBeInTheDocument()
    expect(screen.queryByText(/dashboard unavailable/i)).not.toBeInTheDocument()
    expect(mockFetchTutorDashboard).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByText(/4 of 10 hours remaining/i)).toBeInTheDocument()
    expect(screen.getByText(/COMS3006 - Computer Graphics/i)).toBeInTheDocument()
  })
})
