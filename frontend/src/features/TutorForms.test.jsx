import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TutorForms from './TutorForms'

const fetchTutorDashboard = vi.fn()
const tokenGetter = vi.fn()
const submitTimeSlot = vi.fn().mockResolvedValue({})
const submitWorkLog = vi.fn().mockResolvedValue({})
const submitExcuse = vi.fn().mockResolvedValue({})

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently: tokenGetter }),
}))
vi.mock('../api/tutorDashboard', () => ({
  fetchTutorDashboard: (...args) => fetchTutorDashboard(...args),
}))
vi.mock('../api/availability', () => ({
  submitTimeSlot: (...args) => submitTimeSlot(...args),
}))
vi.mock('../api/workLog', () => ({
  submitWorkLog: (...args) => submitWorkLog(...args),
}))
vi.mock('../api/excuse', () => ({
  submitExcuse: (...args) => submitExcuse(...args),
}))

const dashboard = {
  allocations: [
    {
      id: 1,
      courseCode: 'DEMO101',
      courseName: 'Demo Course',
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

describe('TutorForms accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchTutorDashboard.mockResolvedValue(dashboard)
  })

  it('reaches every labelled control and action in keyboard order', async () => {
    const user = userEvent.setup()
    render(<TutorForms />)
    await screen.findByRole('heading', { name: /availability, work log and excuses/i })

    const expectedControls = [
      screen.getByLabelText(/^type$/i),
      screen.getByLabelText(/^start$/i),
      screen.getByLabelText(/^end$/i),
      screen.getByLabelText(/recurrence/i),
      screen.getByRole('button', { name: /save availability/i }),
      screen.getAllByLabelText(/^session$/i)[0],
      screen.getByLabelText(/^date$/i),
      screen.getByLabelText(/hours worked/i),
      screen.getByLabelText(/description/i),
      screen.getByRole('button', { name: /add to draft/i }),
      screen.getAllByLabelText(/^session$/i)[1],
      screen.getByLabelText(/^reason$/i),
      screen.getByRole('button', { name: /submit excuse/i }),
    ]

    await user.tab()
    for (const control of expectedControls) {
      expect(control).toHaveFocus()
      await user.tab()
    }
  })

  it('activates validation from the keyboard', async () => {
    const user = userEvent.setup()
    render(<TutorForms />)
    const saveButton = await screen.findByRole('button', { name: /save availability/i })
    saveButton.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByText(/start time is required/i)).toBeInTheDocument()
  })

  it('shows a safe shared error and retries loading assigned sessions', async () => {
    fetchTutorDashboard.mockRejectedValueOnce(new Error('private detail'))
    render(<TutorForms />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded safely/i)
    expect(screen.queryByText(/private detail/i)).not.toBeInTheDocument()

    fetchTutorDashboard.mockResolvedValueOnce(dashboard)
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /availability, work log and excuses/i }))
        .toBeInTheDocument()
    })
  })
})
