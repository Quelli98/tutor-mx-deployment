import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AvailabilityForm from './AvailabilityForm'

const mockSubmitTimeSlot = vi.fn()
const mockListOwnTimeSlots = vi.fn()
const mockDeleteOwnTimeSlot = vi.fn()
const mockUpdateOwnTimeSlot = vi.fn()
const tokenGetter = vi.fn()

vi.mock('../api/availability', () => ({
  submitTimeSlot: (...args) => mockSubmitTimeSlot(...args),
  listOwnTimeSlots: (...args) => mockListOwnTimeSlots(...args),
  deleteOwnTimeSlot: (...args) => mockDeleteOwnTimeSlot(...args),
  updateOwnTimeSlot: (...args) => mockUpdateOwnTimeSlot(...args),
}))

describe('AvailabilityForm', () => {
  beforeEach(() => {
    mockSubmitTimeSlot.mockReset()
    mockSubmitTimeSlot.mockResolvedValue({
      id: 1,
      type: 'BUSY',
      startsAt: '2030-09-04T14:00:00.000Z',
      endsAt: '2030-09-04T16:00:00.000Z',
      recurrence: null,
      label: null,
      recurrenceUntil: null,
    })
    mockListOwnTimeSlots.mockReset()
    mockListOwnTimeSlots.mockResolvedValue([])
    mockDeleteOwnTimeSlot.mockReset()
    mockUpdateOwnTimeSlot.mockReset()
  })

  it('associates missing-field errors and does not send a request', async () => {
    render(<AvailabilityForm tokenOrGetter={tokenGetter} />)
    fireEvent.click(screen.getByRole('button', { name: /add busy time/i }))

    const start = screen.getByLabelText(/start.*first occurrence/i)
    const end = screen.getByLabelText(/end.*first occurrence/i)
    expect(start).toHaveAccessibleDescription(/start time is required/i)
    expect(end).toHaveAccessibleDescription(/end time is required/i)
    expect(mockSubmitTimeSlot).not.toHaveBeenCalled()
  })

  it('rejects an impossible time range before sending a request', async () => {
    render(<AvailabilityForm tokenOrGetter={tokenGetter} />)
    fireEvent.change(screen.getByLabelText(/start.*first occurrence/i), {
      target: { value: '2030-09-04T16:00' },
    })
    fireEvent.change(screen.getByLabelText(/end.*first occurrence/i), {
      target: { value: '2030-09-04T14:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add busy time/i }))

    expect(screen.getByText(/end time must be after the start time/i)).toBeInTheDocument()
    expect(mockSubmitTimeSlot).not.toHaveBeenCalled()
  })

  it('submits ISO dates with the repeat-weekly flag', async () => {
    render(<AvailabilityForm tokenOrGetter={tokenGetter} />)
    fireEvent.change(screen.getByLabelText(/start.*first occurrence/i), {
      target: { value: '2030-09-04T14:00' },
    })
    fireEvent.change(screen.getByLabelText(/end.*first occurrence/i), {
      target: { value: '2030-09-04T16:00' },
    })
    fireEvent.click(screen.getByLabelText(/repeat weekly/i))
    fireEvent.click(screen.getByRole('button', { name: /add busy time/i }))

    await waitFor(() => {
      expect(mockSubmitTimeSlot).toHaveBeenCalledWith(
        {
          type: 'BUSY',
          startsAt: new Date('2030-09-04T14:00').toISOString(),
          endsAt: new Date('2030-09-04T16:00').toISOString(),
          recurrence: 'WEEKLY',
          label: null,
          recurrenceUntil: null,
        },
        tokenGetter,
      )
    })
    expect(await screen.findByText(/busy time added/i)).toBeInTheDocument()
  })
})
