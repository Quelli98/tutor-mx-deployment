import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkLogForm from './WorkLogForm'

const mockSubmitWorkLog = vi.fn()
const mockSubmitTimesheet = vi.fn()
const tokenGetter = vi.fn()
const allocations = [
  {
    id: 1,
    courseCode: 'DEMO101',
    courseName: 'Demo Course',
    startsAt: '2030-09-04T14:00:00.000Z',
    endsAt: '2030-09-04T16:00:00.000Z',
    allocatedHours: 2,
    status: 'CONFIRMED',
  },
]

vi.mock('../api/workLog', () => ({
  submitWorkLog: (...args) => mockSubmitWorkLog(...args),
}))
vi.mock('../api/timesheet', () => ({
  fetchTimesheetStatus: vi.fn(),
  submitTimesheet: (...args) => mockSubmitTimesheet(...args),
}))

describe('WorkLogForm', () => {
  beforeEach(() => {
    mockSubmitWorkLog.mockReset()
    mockSubmitTimesheet.mockReset()
    window.sessionStorage.clear()
  })

  it.each([
    ['-1', /hours must be a positive number/i],
    ['30', /hours cannot exceed 24/i],
  ])('rejects invalid hours %s', (hours, expectedMessage) => {
    render(<WorkLogForm allocations={allocations} tokenOrGetter={tokenGetter} />)
    fireEvent.change(screen.getByLabelText(/^session$/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/hours worked/i), { target: { value: hours } })
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Tutorial session' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add to draft/i }))

    expect(screen.getByText(expectedMessage)).toBeInTheDocument()
    expect(mockSubmitWorkLog).not.toHaveBeenCalled()
  })

  it('rejects a date that does not match the selected session', () => {
    render(<WorkLogForm allocations={allocations} tokenOrGetter={tokenGetter} />)
    fireEvent.change(screen.getByLabelText(/^session$/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/^date$/i), {
      target: { value: '2030-09-05' },
    })
    fireEvent.change(screen.getByLabelText(/hours worked/i), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Tutorial session' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add to draft/i }))

    expect(screen.getByText(/date must match the selected session/i)).toBeInTheDocument()
    expect(mockSubmitWorkLog).not.toHaveBeenCalled()
  })

  it('shows the date, session and hours in the draft list', async () => {
    mockSubmitWorkLog.mockResolvedValue({
      id: 2,
      allocationId: 1,
      timesheetId: 3,
      workDate: '2030-09-04',
      hours: 2,
      description: 'Tutorial session',
    })
    render(<WorkLogForm allocations={allocations} tokenOrGetter={tokenGetter} />)
    fireEvent.change(screen.getByLabelText(/^session$/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/hours worked/i), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Tutorial session' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add to draft/i }))

    await waitFor(() => {
      expect(mockSubmitWorkLog).toHaveBeenCalledWith(
        {
          allocationId: 1,
          workDate: '2030-09-04',
          hours: 2,
          description: 'Tutorial session',
        },
        tokenGetter,
      )
    })
    const draftList = screen.getByRole('region', { name: 'Draft work log' })
    expect(await within(draftList).findByRole('listitem')).toHaveTextContent(
      /DEMO101.*2030-09-04.*2h.*Tutorial session/i,
    )
  })

  it('offers the saved week for timesheet approval', async () => {
    mockSubmitWorkLog.mockResolvedValue({
      id: 2,
      allocationId: 1,
      timesheetId: 3,
      workDate: '2030-09-04',
      hours: 2,
      description: 'Tutorial session',
    })
    mockSubmitTimesheet.mockResolvedValue({
      id: 3,
      weekStart: '2030-09-02',
      status: 'SUBMITTED',
      submittedAt: '2030-09-06T12:00:00.000Z',
      reviewedAt: null,
      reviewReason: null,
      totalHours: 2,
    })
    render(<WorkLogForm allocations={allocations} tokenOrGetter={tokenGetter} />)
    fireEvent.change(screen.getByLabelText(/^session$/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/hours worked/i), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Tutorial session' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add to draft/i }))

    const timesheets = screen.getByRole('region', { name: 'Weekly timesheets' })
    expect(await within(timesheets).findByText('Week of 2030-09-02')).toBeInTheDocument()

    fireEvent.click(within(timesheets).getByRole('button', { name: /submit for approval/i }))

    expect(mockSubmitTimesheet).toHaveBeenCalledWith(3, tokenGetter)
    expect(
      await within(timesheets).findByText(/waiting for the organiser decision/i),
    ).toBeInTheDocument()
  })

  it('explains when the week timesheet is locked', async () => {
    const lockedError = new Error('Worked hours cannot be changed on this timesheet.')
    lockedError.code = 'TIMESHEET_LOCKED'
    mockSubmitWorkLog.mockRejectedValue(lockedError)

    render(<WorkLogForm allocations={allocations} tokenOrGetter={tokenGetter} />)
    fireEvent.change(screen.getByLabelText(/^session$/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/hours worked/i), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Tutorial session' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add to draft/i }))

    expect(
      await screen.findByText(/this week's timesheet has already been submitted/i),
    ).toBeInTheDocument()
    expect(mockSubmitWorkLog).toHaveBeenCalled()
  })
})
