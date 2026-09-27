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
const listAcademicTerms = vi.fn()
const previewTimetableImport = vi.fn()
const commitTimetableImport = vi.fn()

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
vi.mock('../api/timetableImport', () => ({
  listAcademicTerms: (...args) => listAcademicTerms(...args),
  previewTimetableImport: (...args) => previewTimetableImport(...args),
  commitTimetableImport: (...args) => commitTimetableImport(...args),
  currentTimeZone: () => 'UTC',
}))

const academicTerms = [
  { id: 2, name: 'Demo 2030 Semester 2', startsOn: '2030-08-26', endsOn: '2030-11-29' },
]

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
    listAcademicTerms.mockResolvedValue(academicTerms)
  })

  it('reaches every labelled control and action in keyboard order', async () => {
    const user = userEvent.setup()
    render(<TutorForms />)
    await screen.findByRole('heading', { name: /forms and submissions/i })
    // The import card only becomes reachable once its terms have loaded, which is
    // the state a tutor is in when they work down the page.
    await waitFor(() => expect(screen.getByLabelText(/academic term/i)).not.toBeDisabled())

    const expectedControls = [
      screen.getByRole('tab', { name: 'Add manually' }),
      screen.getByRole('tab', { name: 'Import timetable' }),
      await screen.findByRole('button', { name: /previous week/i }),
      screen.getByRole('button', { name: /^this week$/i }),
      screen.getByRole('button', { name: /next week/i }),
      document.querySelector('.calendar-scroll'),
      screen.getByLabelText(/^category$/i),
      screen.getByLabelText(/from.*date and time/i),
      screen.getByLabelText(/until.*date and time/i),
      screen.getByLabelText(/description \(optional\)/i),
      screen.getByLabelText(/^repeat$/i),
      screen.getByRole('button', { name: /add schedule entry/i }),
      screen.getAllByLabelText(/^session$/i)[0],
      screen.getByLabelText(/^date$/i),
      screen.getByLabelText(/hours worked/i),
      screen.getByLabelText(/^description$/i),
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

    const importTab = screen.getByRole('tab', { name: 'Import timetable' })
    importTab.focus()
    await user.keyboard('{Enter}')
    expect(importTab).toHaveAttribute('aria-selected', 'true')
    for (const control of [
      screen.getByLabelText(/academic term/i),
      screen.getByLabelText(/pasted rows or a \.csv file/i),
      screen.getByLabelText(/choose a file \(optional\)/i),
      screen.getByLabelText(/timetable rows/i),
    ]) {
      await user.tab()
      expect(control).toHaveFocus()
    }
  }, 15000) // Allow sequential keyboard interactions to finish on busy CI runners.

  it('activates validation from the keyboard', async () => {
    const user = userEvent.setup()
    render(<TutorForms />)
    const saveButton = await screen.findByRole('button', { name: /add schedule entry/i })
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

    fireEvent.change(screen.getByLabelText(/from.*date and time/i), { target: { value: '2030-09-05T09:00' } })
    fireEvent.change(screen.getByLabelText(/until.*date and time/i), { target: { value: '2030-09-05T11:00' } })
    fireEvent.click(screen.getByRole('button', { name: /add schedule entry/i }))
    await screen.findByText(/schedule entry added/i)

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

describe('TutorForms unified timetable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
    fetchTutorDashboard.mockResolvedValue(dashboard)
    listOwnTimeSlots.mockResolvedValue([])
    listAcademicTerms.mockResolvedValue(academicTerms)
  })

  it('renders the unified "Add to my timetable" section with both options', async () => {
    render(<TutorForms />)
    await screen.findByRole('heading', { name: /add to my timetable/i })
    expect(screen.getByRole('tab', { name: /add manually/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /import timetable/i })).toBeInTheDocument()
  })

  it('shows only the selected tab panel', async () => {
    render(<TutorForms />)
    await screen.findByRole('heading', { name: /add to my timetable/i })

    const manualTab = screen.getByRole('tab', { name: /add manually/i })
    const importTab = screen.getByRole('tab', { name: /import timetable/i })

    expect(manualTab).toHaveAttribute('aria-selected', 'true')
    expect(importTab).toHaveAttribute('aria-selected', 'false')

    const manualPanel = document.getElementById('tab-panel-manual')
    const importPanel = document.getElementById('tab-panel-import')

    expect(manualPanel).not.toHaveAttribute('hidden')
    expect(importPanel).toHaveAttribute('hidden')

    fireEvent.click(importTab)

    expect(manualTab).toHaveAttribute('aria-selected', 'false')
    expect(importTab).toHaveAttribute('aria-selected', 'true')
    expect(manualPanel).toHaveAttribute('hidden')
    expect(importPanel).not.toHaveAttribute('hidden')
  })

  it('preserves manual form state when switching tabs', async () => {
    const user = userEvent.setup()
    render(<TutorForms />)
    await screen.findByRole('heading', { name: /add to my timetable/i })

    const labelInput = screen.getByLabelText(/description \(optional\)/i)
    await user.type(labelInput, 'Maths lecture')
    expect(labelInput).toHaveValue('Maths lecture')

    fireEvent.click(screen.getByRole('tab', { name: /import timetable/i }))
    await waitFor(() => {
      expect(screen.getByLabelText(/academic term/i)).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('tab', { name: /add manually/i }))

    expect(screen.getByLabelText(/description \(optional\)/i)).toHaveValue('Maths lecture')
  })

  it('preserves import form state when switching tabs', async () => {
    const user = userEvent.setup()
    render(<TutorForms />)
    await screen.findByRole('heading', { name: /add to my timetable/i })
    await waitFor(() => {
      expect(screen.getByLabelText(/academic term/i)).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('tab', { name: /import timetable/i }))

    const textarea = screen.getByLabelText(/timetable rows/i)
    await user.type(textarea, 'date,start,end,label')
    expect(textarea).toHaveValue('date,start,end,label')

    fireEvent.click(screen.getByRole('tab', { name: /add manually/i }))
    await waitFor(() => {
      expect(screen.getByLabelText(/description \(optional\)/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('tab', { name: /import timetable/i }))

    expect(screen.getByLabelText(/timetable rows/i)).toHaveValue('date,start,end,label')
  })

  it('does not submit forms when switching tabs', async () => {
    render(<TutorForms />)
    await screen.findByRole('heading', { name: /add to my timetable/i })

    fireEvent.click(screen.getByRole('tab', { name: /import timetable/i }))
    await waitFor(() => {
      expect(screen.getByLabelText(/academic term/i)).not.toBeDisabled()
    })

    expect(submitTimeSlot).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('tab', { name: /add manually/i }))

    expect(submitTimeSlot).not.toHaveBeenCalled()
  })

  it('creates a manual Class entry with correct category', async () => {
    submitTimeSlot.mockResolvedValueOnce({
      id: 10,
      type: 'BUSY',
      startsAt: new Date('2030-09-05T09:00').toISOString(),
      endsAt: new Date('2030-09-05T11:00').toISOString(),
      recurrence: null,
      label: 'CSAM101 Lecture',
      recurrenceUntil: null,
      category: 'CLASS',
    })

    render(<TutorForms />)
    await screen.findByRole('heading', { name: /add to my timetable/i })

    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: 'CLASS' } })
    fireEvent.change(screen.getByLabelText(/from.*date and time/i), { target: { value: '2030-09-05T09:00' } })
    fireEvent.change(screen.getByLabelText(/until.*date and time/i), { target: { value: '2030-09-05T11:00' } })
    fireEvent.change(screen.getByLabelText(/description \(optional\)/i), { target: { value: 'CSAM101 Lecture' } })

    fireEvent.click(screen.getByRole('button', { name: /add schedule entry/i }))

    await waitFor(() => {
      expect(screen.getByText(/schedule entry added/i)).toBeInTheDocument()
    })

    expect(submitTimeSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'BUSY',
        category: 'CLASS',
        label: 'CSAM101 Lecture',
      }),
      tokenGetter,
    )
  })

  it('creates a manual Unavailable entry with correct category', async () => {
    submitTimeSlot.mockResolvedValueOnce({
      id: 11,
      type: 'BUSY',
      startsAt: new Date('2030-09-06T14:00').toISOString(),
      endsAt: new Date('2030-09-06T16:00').toISOString(),
      recurrence: null,
      label: 'Doctor appointment',
      recurrenceUntil: null,
      category: 'UNAVAILABLE',
    })

    render(<TutorForms />)
    await screen.findByRole('heading', { name: /add to my timetable/i })

    fireEvent.change(screen.getByLabelText(/from.*date and time/i), { target: { value: '2030-09-06T14:00' } })
    fireEvent.change(screen.getByLabelText(/until.*date and time/i), { target: { value: '2030-09-06T16:00' } })
    fireEvent.change(screen.getByLabelText(/description \(optional\)/i), { target: { value: 'Doctor appointment' } })

    fireEvent.click(screen.getByRole('button', { name: /add schedule entry/i }))

    await waitFor(() => {
      expect(screen.getByText(/schedule entry added/i)).toBeInTheDocument()
    })

    expect(submitTimeSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'BUSY',
        category: 'UNAVAILABLE',
        label: 'Doctor appointment',
      }),
      tokenGetter,
    )
  })

  it('supports weekly recurrence for manual entries', async () => {
    submitTimeSlot.mockResolvedValueOnce({
      id: 12,
      type: 'BUSY',
      startsAt: new Date('2030-09-05T09:00').toISOString(),
      endsAt: new Date('2030-09-05T11:00').toISOString(),
      recurrence: 'WEEKLY',
      label: 'Weekly tutorial',
      recurrenceUntil: new Date('2030-11-29').toISOString(),
      category: 'CLASS',
    })

    render(<TutorForms />)
    await screen.findByRole('heading', { name: /add to my timetable/i })

    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: 'CLASS' } })
    fireEvent.change(screen.getByLabelText(/from.*date and time/i), { target: { value: '2030-09-05T09:00' } })
    fireEvent.change(screen.getByLabelText(/until.*date and time/i), { target: { value: '2030-09-05T11:00' } })
    fireEvent.change(screen.getByLabelText(/description \(optional\)/i), { target: { value: 'Weekly tutorial' } })
    fireEvent.change(screen.getByLabelText(/repeat/i), { target: { value: 'WEEKLY' } })
    fireEvent.change(screen.getByLabelText(/repeat until/i), { target: { value: '2030-11-29T00:00' } })

    fireEvent.click(screen.getByRole('button', { name: /add schedule entry/i }))

    await waitFor(() => {
      expect(screen.getByText(/schedule entry added/i)).toBeInTheDocument()
    })

    expect(submitTimeSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'BUSY',
        category: 'CLASS',
        recurrence: 'WEEKLY',
        recurrenceUntil: expect.any(String),
      }),
      tokenGetter,
    )
  })

  it('supports fortnightly recurrence for manual entries', async () => {
    submitTimeSlot.mockResolvedValueOnce({
      id: 13,
      type: 'BUSY',
      startsAt: new Date('2030-09-05T09:00').toISOString(),
      endsAt: new Date('2030-09-05T11:00').toISOString(),
      recurrence: 'FORTNIGHTLY',
      label: 'Fortnightly lab',
      recurrenceUntil: new Date('2030-11-29').toISOString(),
      category: 'CLASS',
    })

    render(<TutorForms />)
    await screen.findByRole('heading', { name: /add to my timetable/i })

    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: 'CLASS' } })
    fireEvent.change(screen.getByLabelText(/from.*date and time/i), { target: { value: '2030-09-05T09:00' } })
    fireEvent.change(screen.getByLabelText(/until.*date and time/i), { target: { value: '2030-09-05T11:00' } })
    fireEvent.change(screen.getByLabelText(/repeat/i), { target: { value: 'FORTNIGHTLY' } })

    fireEvent.click(screen.getByRole('button', { name: /add schedule entry/i }))

    await waitFor(() => {
      expect(screen.getByText(/schedule entry added/i)).toBeInTheDocument()
    })

    expect(submitTimeSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'BUSY',
        category: 'CLASS',
        recurrence: 'FORTNIGHTLY',
      }),
      tokenGetter,
    )
  })
})

it('keeps import success and an unsaved manual draft while refreshing imported slots', async () => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
  fetchTutorDashboard.mockResolvedValue(dashboard)
  listOwnTimeSlots.mockResolvedValue([])
  listAcademicTerms.mockResolvedValue(academicTerms)
  previewTimetableImport.mockResolvedValue({
    timeZone: 'UTC', term: academicTerms[0], rows: [], validCount: 1, invalidCount: 0, duplicateCount: 0,
  })
  commitTimetableImport.mockResolvedValue({ created: 1 })
  render(<TutorForms />)
  await screen.findByRole('region', { name: 'Your weekly schedule' })
  fireEvent.change(screen.getByLabelText(/description \(optional\)/i), { target: { value: 'Unsaved draft' } })
  fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
  const navigatedWeek = document.querySelector('.calendar-toolbar p').textContent
  fireEvent.click(screen.getByRole('tab', { name: 'Import timetable' }))
  await waitFor(() => expect(screen.getByLabelText(/academic term/i)).not.toBeDisabled())
  fireEvent.change(screen.getByLabelText(/timetable rows/i), { target: { value: 'date,start,end\n2030-09-02,09:00,10:00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Preview import' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Save 1 entry' }))
  expect(await screen.findByText('Imported 1 schedule entry.')).toBeVisible()
  await waitFor(() => expect(listOwnTimeSlots).toHaveBeenCalledTimes(2))
  expect(listAcademicTerms).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('tab', { name: 'Add manually' }))
  expect(screen.getByLabelText(/description \(optional\)/i)).toHaveValue('Unsaved draft')
  expect(document.querySelector('.calendar-toolbar p').textContent).toBe(navigatedWeek)
})
