import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TimesheetSection from './TimesheetSection'

const mockFetchTimesheetStatus = vi.fn()
const mockSubmitTimesheet = vi.fn()
const mockFetchTimesheetHistory = vi.fn()
const mockDeclareTimesheet = vi.fn()
const tokenGetter = vi.fn()

vi.mock('../api/timesheet', () => ({
  fetchTimesheetStatus: (...args) => mockFetchTimesheetStatus(...args),
  submitTimesheet: (...args) => mockSubmitTimesheet(...args),
}))

vi.mock('../api/timesheetCorrections', () => ({
  fetchTimesheetHistory: (...args) => mockFetchTimesheetHistory(...args),
  declareTimesheet: (...args) => mockDeclareTimesheet(...args),
  correctTimesheetWorkLog: vi.fn(),
  raiseTimesheetDispute: vi.fn(),
}))

const STORAGE_KEY = 'tutormx.tutorTimesheets'

const draftSummary = {
  id: 12,
  weekStart: '2030-09-02',
  status: 'DRAFT',
  submittedAt: null,
  reviewedAt: null,
  reviewReason: null,
  totalHours: 4.5,
}

const submittedSummary = {
  ...draftSummary,
  status: 'SUBMITTED',
  submittedAt: '2030-09-06T12:00:00.000Z',
}

const returnedSummary = {
  ...draftSummary,
  status: 'RETURNED',
  submittedAt: '2030-09-06T12:00:00.000Z',
  reviewedAt: '2030-09-09T08:30:00.000Z',
  reviewReason: 'Please correct Tuesday hours',
}

const approvedSummary = {
  ...draftSummary,
  status: 'APPROVED',
  submittedAt: '2030-09-06T12:00:00.000Z',
  reviewedAt: '2030-09-09T08:30:00.000Z',
}

const emptyHistory = {
  timesheet: { ...draftSummary, editable: false },
  workLogs: [],
  revisions: [],
  declarations: [],
  disputes: [],
  declaration: {
    statementVersion: 's3-m3-v1',
    statement: 'I confirm the hours and descriptions on this timesheet are complete and accurate.',
  },
}

function returnedHistory(overrides = {}) {
  return {
    ...emptyHistory,
    timesheet: { ...returnedSummary, editable: true },
    workLogs: [
      {
        id: 1,
        timesheetId: 12,
        allocationId: 1,
        workDate: '2030-09-02',
        hours: 2,
        description: 'Monday tutorial',
      },
    ],
    revisions: [
      {
        id: 5,
        kind: 'RETURN',
        workLogId: null,
        authorProfileId: 8,
        reason: 'Please correct Tuesday hours',
        previousHours: null,
        previousDescription: null,
        newHours: null,
        newDescription: null,
        createdAt: '2030-09-09T08:30:05.000Z',
      },
    ],
    ...overrides,
  }
}

const entryA = {
  id: 1,
  allocationId: 1,
  timesheetId: 12,
  workDate: '2030-09-02',
  hours: 2,
  description: 'Monday tutorial',
  session: 'DEMO101 - Monday',
}

const entryB = {
  id: 2,
  allocationId: 2,
  timesheetId: 12,
  workDate: '2030-09-03',
  hours: 2.5,
  description: 'Tuesday lab',
  session: 'DEMO101 - Tuesday',
}

const entryC = {
  id: 3,
  allocationId: 3,
  timesheetId: 15,
  workDate: '2030-09-09',
  hours: 1,
  description: 'Next week tutorial',
  session: 'DEMO101 - Next week',
}

function apiError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function storeTimesheets(summaries, scope = null) {
  const key = scope ? `${STORAGE_KEY}.${scope}` : STORAGE_KEY
  window.sessionStorage.setItem(key, JSON.stringify(summaries))
}

describe('TimesheetSection', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    mockFetchTimesheetStatus.mockReset()
    mockSubmitTimesheet.mockReset()
    mockFetchTimesheetHistory.mockReset()
    mockDeclareTimesheet.mockReset()
    tokenGetter.mockReset()
    // A week that has left the draft state has its timeline read, so the read
    // has to answer even in the tests that do not care about it.
    mockFetchTimesheetHistory.mockResolvedValue(emptyHistory)
  })

  it('shows guidance when no work logs or stored timesheets exist', () => {
    render(<TimesheetSection savedLogs={[]} tokenOrGetter={tokenGetter} />)

    expect(screen.getByText(/grouped by week/i)).toBeInTheDocument()
    expect(mockFetchTimesheetStatus).not.toHaveBeenCalled()
  })

  it('groups saved work logs by timesheet week with entry counts and totals', () => {
    render(<TimesheetSection savedLogs={[entryA, entryB, entryC]} tokenOrGetter={tokenGetter} />)

    expect(screen.getByText('Week of 2030-09-02')).toBeInTheDocument()
    expect(screen.getByText(/\(2 entries, 4\.5h\)/)).toBeInTheDocument()
    expect(screen.getByText('Week of 2030-09-09')).toBeInTheDocument()
    expect(screen.getByText(/\(1 entry, 1h\)/)).toBeInTheDocument()
    expect(screen.getAllByText(/Draft, not submitted yet/i)).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /submit for approval/i })).toHaveLength(2)
  })

  it('does not show timesheets cached for another signed-in tutor', () => {
    storeTimesheets([submittedSummary], 'auth0|other-tutor')

    render(
      <TimesheetSection
        savedLogs={[]}
        tokenOrGetter={tokenGetter}
        storageScope="auth0|current-tutor"
      />,
    )

    expect(screen.getByText(/no timesheets yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/waiting for the organiser decision/i)).not.toBeInTheDocument()
  })

  it('submits a draft week and shows the pending decision state', async () => {
    mockSubmitTimesheet.mockResolvedValueOnce(submittedSummary)
    render(<TimesheetSection savedLogs={[entryA]} tokenOrGetter={tokenGetter} />)

    fireEvent.click(screen.getByRole('button', { name: /submit for approval/i }))

    expect(mockSubmitTimesheet).toHaveBeenCalledWith(12, tokenGetter)
    expect(await screen.findByText(/waiting for the organiser decision/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /submit for approval/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /check for decision/i })).toBeInTheDocument()
  })

  it('resyncs and shows a safe message when the week was already submitted', async () => {
    mockSubmitTimesheet.mockRejectedValueOnce(
      apiError('TIMESHEET_SUBMISSION_CONFLICT', 'The timesheet cannot be submitted.'),
    )
    mockFetchTimesheetStatus.mockResolvedValueOnce(submittedSummary)
    render(<TimesheetSection savedLogs={[entryA]} tokenOrGetter={tokenGetter} />)

    fireEvent.click(screen.getByRole('button', { name: /submit for approval/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /already been sent for review/i,
    )
    expect(mockFetchTimesheetStatus).toHaveBeenCalledWith(12, tokenGetter)
    expect(await screen.findByText(/waiting for the organiser decision/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /submit for approval/i })).not.toBeInTheDocument()
  })

  it('shows a safe message when logged hours break the weekly limit', async () => {
    mockSubmitTimesheet.mockRejectedValueOnce(
      apiError('TIMESHEET_HOURS_INVALID', 'The timesheet hours or weekly limit are invalid.'),
    )
    render(<TimesheetSection savedLogs={[entryA]} tokenOrGetter={tokenGetter} />)

    fireEvent.click(screen.getByRole('button', { name: /submit for approval/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /exceed the weekly hour limit/i,
    )
    expect(mockFetchTimesheetStatus).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /submit for approval/i })).toBeInTheDocument()
  })

  it('restores a returned week from storage and shows its timeline', async () => {
    storeTimesheets([returnedSummary])
    mockFetchTimesheetStatus.mockResolvedValue(returnedSummary)
    mockFetchTimesheetHistory.mockResolvedValue(returnedHistory())
    render(<TimesheetSection savedLogs={[]} tokenOrGetter={tokenGetter} />)

    expect(screen.getByText(/organiser note: please correct tuesday hours/i)).toBeInTheDocument()
    // The status line repeats the words of the timeline, so the timeline is
    // read where it stands, from the panel that owns it.
    const timelineHeading = await screen.findByRole('heading', {
      name: /return and correction timeline/i,
    })
    expect(mockFetchTimesheetHistory).toHaveBeenCalledWith(12, tokenGetter)
    const timeline = within(timelineHeading.closest('.timesheet-history'))
    expect(timeline.getByText('Returned by the organiser')).toBeInTheDocument()
    expect(timeline.getByText(/note: please correct tuesday hours/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /resubmit for approval/i })).toBeInTheDocument()
  })

  it('refuses a resubmission until the declaration is acknowledged', async () => {
    storeTimesheets([returnedSummary])
    mockFetchTimesheetStatus.mockResolvedValue(returnedSummary)
    mockFetchTimesheetHistory.mockResolvedValue(returnedHistory())
    render(<TimesheetSection savedLogs={[]} tokenOrGetter={tokenGetter} />)

    await screen.findByRole('checkbox', { name: /i acknowledge this declaration/i })
    fireEvent.click(screen.getByRole('button', { name: /resubmit for approval/i }))

    // The organiser note is an alert as well, so the refusal is picked out by
    // its own words and then checked for the announcement it should make.
    const refusal = await screen.findByText(/acknowledge the declaration for this week/i)
    expect(refusal).toHaveAttribute('role', 'alert')
    expect(mockDeclareTimesheet).not.toHaveBeenCalled()
    expect(mockSubmitTimesheet).not.toHaveBeenCalled()
  })

  it('records the acknowledgement and then resubmits the returned week', async () => {
    storeTimesheets([returnedSummary])
    mockFetchTimesheetStatus.mockResolvedValue(returnedSummary)
    mockFetchTimesheetHistory.mockResolvedValue(returnedHistory())
    mockDeclareTimesheet.mockResolvedValue({
      id: 3,
      timesheetId: 12,
      statementVersion: 's3-m3-v1',
      declaredAt: '2030-09-10T09:05:00.000Z',
    })
    mockSubmitTimesheet.mockResolvedValueOnce(submittedSummary)
    render(<TimesheetSection savedLogs={[]} tokenOrGetter={tokenGetter} />)

    fireEvent.click(
      await screen.findByRole('checkbox', { name: /i acknowledge this declaration/i }),
    )
    fireEvent.click(screen.getByRole('button', { name: /resubmit for approval/i }))

    await waitFor(() => {
      expect(mockDeclareTimesheet).toHaveBeenCalledWith(12, 's3-m3-v1', tokenGetter)
    })
    // The acknowledgement is recorded before the sheet is sent, never after.
    expect(mockDeclareTimesheet.mock.invocationCallOrder[0]).toBeLessThan(
      mockSubmitTimesheet.mock.invocationCallOrder[0],
    )
    expect(mockSubmitTimesheet).toHaveBeenCalledWith(12, tokenGetter)
    expect(await screen.findByText(/waiting for the organiser decision/i)).toBeInTheDocument()
  })

  it('keeps the resubmission button busy while the timeline is still loading', async () => {
    storeTimesheets([returnedSummary])
    mockFetchTimesheetStatus.mockResolvedValue(returnedSummary)
    mockFetchTimesheetHistory.mockImplementationOnce(() => new Promise(() => {}))
    render(<TimesheetSection savedLogs={[]} tokenOrGetter={tokenGetter} />)

    expect(await screen.findByText(/loading the correction timeline/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /resubmit for approval/i })).toBeDisabled()
  })

  it('refreshes the organiser decision when the tutor checks a submitted week', async () => {
    storeTimesheets([submittedSummary])
    mockFetchTimesheetStatus
      .mockResolvedValueOnce(submittedSummary)
      .mockResolvedValueOnce(approvedSummary)
    render(<TimesheetSection savedLogs={[]} tokenOrGetter={tokenGetter} />)

    fireEvent.click(await screen.findByRole('button', { name: /check for decision/i }))

    expect(await screen.findByText(/approved by the organiser/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /submit for approval/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /check for decision/i })).toBeInTheDocument()
  })

  it('drops a stored week the server no longer knows', async () => {
    storeTimesheets([submittedSummary])
    mockFetchTimesheetStatus.mockRejectedValueOnce(
      apiError('TIMESHEET_NOT_FOUND', 'The requested timesheet could not be found.'),
    )
    render(<TimesheetSection savedLogs={[]} tokenOrGetter={tokenGetter} />)

    expect(await screen.findByText(/no timesheets yet/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY))).toEqual([])
    })
  })

  it('refetches the decision quietly when the window regains focus', async () => {
    mockSubmitTimesheet.mockResolvedValueOnce(submittedSummary)
    mockFetchTimesheetStatus.mockResolvedValueOnce(returnedSummary)
    render(<TimesheetSection savedLogs={[entryA]} tokenOrGetter={tokenGetter} />)

    fireEvent.click(screen.getByRole('button', { name: /submit for approval/i }))
    expect(await screen.findByText(/waiting for the organiser decision/i)).toBeInTheDocument()

    fireEvent(window, new Event('focus'))

    expect(await screen.findByText(/returned by the organiser/i)).toBeInTheDocument()
    expect(screen.getByText(/organiser note: please correct tuesday hours/i)).toBeInTheDocument()
  })

  it('does not stack refreshes when focus fires while a check is running', async () => {
    storeTimesheets([submittedSummary])
    mockFetchTimesheetStatus.mockImplementationOnce(() => new Promise(() => {}))
    render(<TimesheetSection savedLogs={[]} tokenOrGetter={tokenGetter} />)

    await waitFor(() => expect(mockFetchTimesheetStatus).toHaveBeenCalledTimes(1))
    fireEvent(window, new Event('focus'))
    fireEvent(window, new Event('focus'))

    expect(mockFetchTimesheetStatus).toHaveBeenCalledTimes(1)
  })
})


describe('timesheet timeline recovery', () => {
  it('retries a failed history read without requiring a status change', async () => {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([returnedSummary]))
    mockFetchTimesheetStatus.mockReset().mockResolvedValue(returnedSummary)
    mockFetchTimesheetHistory.mockReset()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(returnedHistory())
    render(<TimesheetSection tokenOrGetter={tokenGetter} />)
    expect(await screen.findByText(/timeline could not be refreshed/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /check for decision/i }))
    expect(await screen.findByRole('heading', { name: /return and correction timeline/i })).toBeInTheDocument()
    expect(screen.queryByText(/timeline could not be refreshed/i)).not.toBeInTheDocument()
    expect(mockFetchTimesheetHistory).toHaveBeenCalledTimes(2)
  })
})
