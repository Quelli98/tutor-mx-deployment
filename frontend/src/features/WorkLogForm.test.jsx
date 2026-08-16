import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkLogForm from './WorkLogForm'

const mockSubmitWorkLog = vi.fn()
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

describe('WorkLogForm', () => {
  beforeEach(() => {
    mockSubmitWorkLog.mockReset()
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
    expect(await screen.findByRole('listitem')).toHaveTextContent(
      /DEMO101.*2030-09-04.*2h.*Tutorial session/i,
    )
  })
})
