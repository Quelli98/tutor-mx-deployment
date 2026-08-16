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
})
