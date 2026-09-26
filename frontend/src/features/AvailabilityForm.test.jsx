import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    await screen.findByRole('region', { name: 'Your weekly schedule' })
    fireEvent.click(screen.getByRole('button', { name: /add schedule entry/i }))

    const start = screen.getByLabelText(/from.*date and time/i)
    const end = screen.getByLabelText(/until.*date and time/i)
    expect(start).toHaveAccessibleDescription(/start time is required/i)
    expect(end).toHaveAccessibleDescription(/end time is required/i)
    expect(mockSubmitTimeSlot).not.toHaveBeenCalled()
  })

  it('rejects an impossible time range before sending a request', async () => {
    render(<AvailabilityForm tokenOrGetter={tokenGetter} />)
    await screen.findByRole('region', { name: 'Your weekly schedule' })
    fireEvent.change(screen.getByLabelText(/from.*date and time/i), {
      target: { value: '2030-09-04T16:00' },
    })
    fireEvent.change(screen.getByLabelText(/until.*date and time/i), {
      target: { value: '2030-09-04T14:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add schedule entry/i }))

    expect(screen.getByText(/end time must be after the start time/i)).toBeInTheDocument()
    expect(mockSubmitTimeSlot).not.toHaveBeenCalled()
  })

  it('adds, edits and deletes an entry while keeping the primary calendar in sync', async () => {
    const today = new Date()
    const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const slot = { id: 4, type: 'BUSY', label: 'Lecture', startsAt: new Date(`${localDate}T08:00`).toISOString(), endsAt: new Date(`${localDate}T09:45`).toISOString(), recurrence: null, recurrenceUntil: null }
    mockSubmitTimeSlot.mockResolvedValue(slot)
    mockUpdateOwnTimeSlot.mockResolvedValue({ ...slot, label: 'Study group' })
    mockDeleteOwnTimeSlot.mockResolvedValue(undefined)
    render(<AvailabilityForm tokenOrGetter={tokenGetter} />)
    const calendar = await screen.findByRole('region', { name: 'Your weekly schedule' })
    expect(within(calendar).getByText('No times added')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/from.*date and time/i), { target: { value: `${localDate}T08:00` } })
    fireEvent.change(screen.getByLabelText(/until.*date and time/i), { target: { value: `${localDate}T09:45` } })
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Lecture' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add schedule entry' }))
    expect(await within(calendar).findByText('Lecture')).toBeInTheDocument()
    expect(within(calendar).getByText('08:00–09:45')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit schedule entry Lecture' }))
    expect(screen.getByLabelText(/from.*date and time/i)).toHaveValue(`${localDate}T08:00`)
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Study group' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule entry' }))
    expect(await within(calendar).findByText('Study group')).toBeInTheDocument()
    expect(within(calendar).queryByText('Lecture')).not.toBeInTheDocument()
    expect(mockUpdateOwnTimeSlot).toHaveBeenCalledWith(4, expect.objectContaining({ label: 'Study group', startsAt: slot.startsAt }), tokenGetter)
    fireEvent.click(screen.getByRole('button', { name: 'Delete schedule entry Study group' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete schedule entry' }))
    expect(await within(calendar).findByText('No unavailable times added')).toBeInTheDocument()
    expect(mockDeleteOwnTimeSlot).toHaveBeenCalledWith(4, tokenGetter)
    expect(screen.queryByRole('list', { name: 'Your schedule entries' })).not.toBeInTheDocument()
  })

  it('submits ISO dates with the repeat-weekly flag', async () => {
    render(<AvailabilityForm tokenOrGetter={tokenGetter} />)
    await screen.findByRole('region', { name: 'Your weekly schedule' })
    fireEvent.change(screen.getByLabelText(/from.*date and time/i), {
      target: { value: '2030-09-04T14:00' },
    })
    fireEvent.change(screen.getByLabelText(/until.*date and time/i), {
      target: { value: '2030-09-04T16:00' },
    })
    fireEvent.change(screen.getByLabelText(/^repeat$/i), {
      target: { value: 'WEEKLY' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add schedule entry/i }))

    await waitFor(() => {
      expect(mockSubmitTimeSlot).toHaveBeenCalledWith(
        {
          type: 'BUSY',
          startsAt: new Date('2030-09-04T14:00').toISOString(),
          endsAt: new Date('2030-09-04T16:00').toISOString(),
          recurrence: 'WEEKLY',
          label: null,
          recurrenceUntil: null,
          category: 'UNAVAILABLE',
          seriesId: null,
        },
        tokenGetter,
      )
    })
    expect(await screen.findByText(/schedule entry added/i)).toBeInTheDocument()
  })
})
