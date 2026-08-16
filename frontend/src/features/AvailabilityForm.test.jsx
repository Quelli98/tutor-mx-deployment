import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AvailabilityForm from './AvailabilityForm'

const mockSubmitTimeSlot = vi.fn()
const tokenGetter = vi.fn()

vi.mock('../api/availability', () => ({
  submitTimeSlot: (...args) => mockSubmitTimeSlot(...args),
}))

describe('AvailabilityForm', () => {
  beforeEach(() => {
    mockSubmitTimeSlot.mockReset()
    mockSubmitTimeSlot.mockResolvedValue({ id: 1, type: 'BUSY' })
  })

  it('associates missing-field errors and does not send a request', () => {
    render(<AvailabilityForm tokenOrGetter={tokenGetter} />)
    fireEvent.click(screen.getByRole('button', { name: /save availability/i }))

    const start = screen.getByLabelText(/^start$/i)
    const end = screen.getByLabelText(/^end$/i)
    expect(start).toHaveAccessibleDescription(/start time is required/i)
    expect(end).toHaveAccessibleDescription(/end time is required/i)
    expect(mockSubmitTimeSlot).not.toHaveBeenCalled()
  })

  it('rejects an impossible time range before sending a request', () => {
    render(<AvailabilityForm tokenOrGetter={tokenGetter} />)
    fireEvent.change(screen.getByLabelText(/^start$/i), {
      target: { value: '2030-09-04T16:00' },
    })
    fireEvent.change(screen.getByLabelText(/^end$/i), {
      target: { value: '2030-09-04T14:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save availability/i }))

    expect(screen.getByText(/end time must be after the start time/i)).toBeInTheDocument()
    expect(mockSubmitTimeSlot).not.toHaveBeenCalled()
  })

  it('submits ISO dates and the agreed recurrence placeholder', async () => {
    render(<AvailabilityForm tokenOrGetter={tokenGetter} />)
    fireEvent.change(screen.getByLabelText(/^start$/i), {
      target: { value: '2030-09-04T14:00' },
    })
    fireEvent.change(screen.getByLabelText(/^end$/i), {
      target: { value: '2030-09-04T16:00' },
    })
    fireEvent.change(screen.getByLabelText(/recurrence/i), {
      target: { value: 'WEEKLY' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save availability/i }))

    await waitFor(() => {
      expect(mockSubmitTimeSlot).toHaveBeenCalledWith(
        {
          type: 'BUSY',
          startsAt: new Date('2030-09-04T14:00').toISOString(),
          endsAt: new Date('2030-09-04T16:00').toISOString(),
          recurrence: 'WEEKLY',
        },
        tokenGetter,
      )
    })
    expect(await screen.findByText(/availability saved/i)).toBeInTheDocument()
  })
})
