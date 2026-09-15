import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TutorForms from './TutorForms'

const fetchTutorDashboard = vi.fn()
const tokenGetter = vi.fn()
const submitTimeSlot = vi.fn().mockResolvedValue({})
const submitWorkLog = vi.fn().mockResolvedValue({})
const submitExcuse = vi.fn().mockResolvedValue({})
const fetchExcuseStatus = vi.fn()
const fetchTimesheetStatus = vi.fn()
const submitTimesheet = vi.fn().mockResolvedValue({})
const listOwnTimeSlots = vi.fn().mockResolvedValue([])
const deleteOwnTimeSlot = vi.fn()
const updateOwnTimeSlot = vi.fn()

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    getAccessTokenSilently: tokenGetter,
    user: { sub: 'auth0|current-tutor' },
  }),
}))
vi.mock('../api/tutorDashboard', () => ({
  fetchTutorDashboard: (...args) => fetchTutorDashboard(...args),
}))
vi.mock('../api/availability', () => ({
  submitTimeSlot: (...args) => submitTimeSlot(...args),
  listOwnTimeSlots: (...args) => listOwnTimeSlots(...args),
  deleteOwnTimeSlot: (...args) => deleteOwnTimeSlot(...args),
  updateOwnTimeSlot: (...args) => updateOwnTimeSlot(...args),
}))
vi.mock('../api/workLog', () => ({
  submitWorkLog: (...args) => submitWorkLog(...args),
}))
vi.mock('../api/excuse', () => ({
  submitExcuse: (...args) => submitExcuse(...args),
  fetchExcuseStatus: (...args) => fetchExcuseStatus(...args),
}))
vi.mock('../api/timesheet', () => ({
  fetchTimesheetStatus: (...args) => fetchTimesheetStatus(...args),
  submitTimesheet: (...args) => submitTimesheet(...args),
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
    window.sessionStorage.clear()
    fetchTutorDashboard.mockResolvedValue(dashboard)
    listOwnTimeSlots.mockResolvedValue([])
  })

  it('reaches every labelled control and action in keyboard order', async () => {
    const user = userEvent.setup()
    render(<TutorForms />)
    await screen.findByRole('heading', { name: /forms and submissions/i })

    const expectedControls = [
      screen.getByLabelText(/start.*first occurrence/i),
      screen.getByLabelText(/end.*first occurrence/i),
      screen.getByLabelText(/class or busy label/i),
      screen.getByLabelText(/repeat weekly/i),
      screen.getByRole('button', { name: /add busy time/i }),
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
  }, 15000) // Allow sequential keyboard interactions to finish on busy CI runners.

  it('activates validation from the keyboard', async () => {
    const user = userEvent.setup()
    render(<TutorForms />)
    const saveButton = await screen.findByRole('button', { name: /add busy time/i })
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
      expect(screen.getByRole('heading', { name: /forms and submissions/i }))
        .toBeInTheDocument()
    })
  })

  it('runs the tutor basic workflow from availability to the excuse decision together', async () => {
    submitTimeSlot.mockResolvedValueOnce({
      id: 1,
      type: 'BUSY',
      startsAt: new Date('2030-09-05T09:00').toISOString(),
      endsAt: new Date('2030-09-05T11:00').toISOString(),
      recurrence: null,
      label: null,
      recurrenceUntil: null,
    })
    submitWorkLog.mockResolvedValueOnce({
      id: 2,
      allocationId: 1,
      timesheetId: 3,
      workDate: '2030-09-04',
      hours: 2,
      description: 'Regression tutorial',
    })
    submitTimesheet.mockResolvedValueOnce({
      id: 3,
      weekStart: '2030-09-02',
      status: 'SUBMITTED',
      submittedAt: '2030-09-06T12:00:00.000Z',
      reviewedAt: null,
      reviewReason: null,
      totalHours: 2,
    })
    submitExcuse.mockResolvedValueOnce({
      id: 7,
      allocationId: 1,
      reason: 'Sick',
      status: 'PENDING',
    })
    fetchExcuseStatus.mockResolvedValueOnce({
      id: 7,
      allocationId: 1,
      reason: 'Sick',
      status: 'APPROVED',
      reviewReason: null,
      createdAt: '2030-09-03T08:00:00.000Z',
      updatedAt: '2030-09-05T09:00:00.000Z',
    })
    render(<TutorForms />)

    await screen.findByRole('heading', { name: /forms and submissions/i })

    fireEvent.change(screen.getByLabelText(/start.*first occurrence/i), { target: { value: '2030-09-05T09:00' } })
    fireEvent.change(screen.getByLabelText(/end.*first occurrence/i), { target: { value: '2030-09-05T11:00' } })
    fireEvent.click(screen.getByRole('button', { name: /add busy time/i }))
    await screen.findByText(/busy time added/i)

    fireEvent.change(screen.getAllByLabelText(/^session$/i)[0], { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/^hours worked$/i), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(/^description$/i), {
      target: { value: 'Regression tutorial' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add to draft/i }))

    const timesheets = screen.getByRole('region', { name: /weekly timesheets/i })
    await within(timesheets).findByText('Week of 2030-09-02')
    fireEvent.click(within(timesheets).getByRole('button', { name: /submit for approval/i }))
    await within(timesheets).findByText(/waiting for the organiser decision/i)

    fireEvent.change(screen.getAllByLabelText(/^session$/i)[1], { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/^reason$/i), { target: { value: 'Sick' } })
    fireEvent.click(screen.getByRole('button', { name: /submit excuse/i }))

    const excuses = screen.getByRole('region', { name: /submitted excuses/i })
    await within(excuses).findByText(/waiting for the organiser decision/i)

    fireEvent.click(within(excuses).getByRole('button', { name: /check for decision/i }))
    await within(excuses).findByText(/approved by the organiser/i)

    expect(submitTimeSlot).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'BUSY' }),
      tokenGetter,
    )
    expect(submitWorkLog).toHaveBeenCalledWith(
      {
        allocationId: 1,
        workDate: '2030-09-04',
        hours: 2,
        description: 'Regression tutorial',
      },
      tokenGetter,
    )
    expect(submitTimesheet).toHaveBeenCalledWith(3, tokenGetter)
    expect(submitExcuse).toHaveBeenCalledWith({ allocationId: 1, reason: 'Sick' }, tokenGetter)
    expect(fetchExcuseStatus).toHaveBeenCalledWith(7, tokenGetter)
  })
})
