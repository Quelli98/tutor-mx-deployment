import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MyTimetable from './MyTimetable'
import { listOwnTimeSlots, submitTimeSlot } from '../api/availability'
import { fetchTutorDashboard } from '../api/tutorDashboard'
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ getAccessTokenSilently: 'student-token', user: { sub: 'student-1' } }) }))
vi.mock('../api/availability', () => ({ listOwnTimeSlots: vi.fn(), submitTimeSlot: vi.fn(), updateOwnTimeSlot: vi.fn(), deleteOwnTimeSlot: vi.fn() }))
vi.mock('../api/tutorDashboard', () => ({ fetchTutorDashboard: vi.fn() }))
vi.mock('../api/timetableImport', () => ({ listPublishedAcademicTerms: vi.fn(async () => []), previewTimetableImport: vi.fn(), commitTimetableImport: vi.fn(), currentTimeZone: () => 'Africa/Johannesburg' }))
beforeEach(() => { vi.clearAllMocks(); listOwnTimeSlots.mockResolvedValue([]) })
describe('Student My timetable', () => {
  it('uses own schedule and shared UI without Tutor allocations or capacity controls', async () => {
    render(<MyTimetable role="STUDENT" />)
    expect(await screen.findByRole('heading', { name: 'My timetable' })).toBeInTheDocument()
    expect(screen.getByText('Student workspace')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Add manually' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Import timetable' })).toBeInTheDocument()
    expect(screen.queryByText(/weekly capacity/i)).not.toBeInTheDocument()
    expect(fetchTutorDashboard).not.toHaveBeenCalled()
    expect(screen.getAllByRole('region', { name: 'My timetable' })).toHaveLength(1)
  })
  it('preserves a manual draft when switching between manual and import tabs', async () => {
    render(<MyTimetable role="STUDENT" />)
    await screen.findByRole('heading', { name: 'My timetable' })
    const description = document.querySelector('input[maxlength="120"]')
    await userEvent.type(description, 'Physics lab')
    await userEvent.click(screen.getByRole('tab', { name: 'Import timetable' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Add manually' }))
    expect(description).toHaveValue('Physics lab')
  })
  it('saves a fortnightly class and refreshes the calendar', async () => {
    const slot = { id: 9, type: 'BUSY', category: 'CLASS', startsAt: '2030-09-02T08:00:00Z', endsAt: '2030-09-02T09:00:00Z', label: 'Physics lab', recurrence: 'FORTNIGHTLY' }
    submitTimeSlot.mockImplementation(async () => { listOwnTimeSlots.mockResolvedValue([slot]); return slot })
    render(<MyTimetable role="STUDENT" />)
    await screen.findByRole('heading', { name: 'My timetable' })
    fireEvent.change(document.getElementById('starts-at'), { target: { value: '2030-09-02T08:00' } })
    fireEvent.change(document.getElementById('ends-at'), { target: { value: '2030-09-02T09:00' } })
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /repeat/i }), 'FORTNIGHTLY')
    fireEvent.submit(document.querySelector('form.schedule-editor'))
    await waitFor(() => expect(submitTimeSlot).toHaveBeenCalledWith(expect.objectContaining({ recurrence: 'FORTNIGHTLY' }), 'student-token'))
    expect(await screen.findByText('Schedule entry added.')).toBeInTheDocument()
    expect(listOwnTimeSlots.mock.calls.length).toBeGreaterThan(2)
  })
})
