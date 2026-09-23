import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TimesheetCorrectionPanel from './TimesheetCorrectionPanel'

const mockCorrectTimesheetWorkLog = vi.fn()
const mockRaiseTimesheetDispute = vi.fn()
const tokenGetter = vi.fn()

vi.mock('../api/timesheetCorrections', () => ({
  correctTimesheetWorkLog: (...args) => mockCorrectTimesheetWorkLog(...args),
  raiseTimesheetDispute: (...args) => mockRaiseTimesheetDispute(...args),
}))

const statement =
  'I confirm the hours and descriptions on this timesheet are complete and accurate.'

function apiError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function history(overrides = {}) {
  const timesheet = {
    id: 12,
    weekStart: '2030-09-02',
    status: 'RETURNED',
    submittedAt: '2030-09-06T12:00:00.000Z',
    reviewedAt: '2030-09-09T08:30:00.000Z',
    reviewReason: 'Please correct Tuesday hours',
    totalHours: 4.5,
    editable: true,
    ...overrides.timesheet,
  }

  return {
    timesheet,
    workLogs: overrides.workLogs ?? [
      {
        id: 1,
        timesheetId: 12,
        allocationId: 1,
        workDate: '2030-09-02',
        hours: 2,
        description: 'Monday tutorial',
      },
      {
        id: 2,
        timesheetId: 12,
        allocationId: 2,
        workDate: '2030-09-03',
        hours: 2.5,
        description: 'Tuesday lab',
      },
    ],
    revisions: overrides.revisions ?? [
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
    declarations: overrides.declarations ?? [],
    disputes: overrides.disputes ?? [],
    declaration: { statementVersion: 's3-m3-v1', statement },
  }
}

const correctionRevision = {
  id: 6,
  kind: 'CORRECTION',
  workLogId: 2,
  authorProfileId: 7,
  reason: 'Please correct Tuesday hours',
  previousHours: 2.5,
  previousDescription: 'Tuesday lab',
  newHours: 1.5,
  newDescription: 'Shortened Tuesday lab',
  createdAt: '2030-09-10T09:00:00.000Z',
}

function renderPanel(props = {}) {
  return render(
    <TimesheetCorrectionPanel
      timesheetId={12}
      history={history()}
      tokenOrGetter={tokenGetter}
      onCorrected={vi.fn()}
      onDisputeChanged={vi.fn()}
      {...props}
    />,
  )
}

function chooseTuesdayLab() {
  fireEvent.change(screen.getByLabelText(/^session$/i), { target: { value: '2' } })
}

describe('TimesheetCorrectionPanel', () => {
  beforeEach(() => {
    mockCorrectTimesheetWorkLog.mockReset()
    mockRaiseTimesheetDispute.mockReset()
    tokenGetter.mockReset()
  })

  it('shows the loading state until the history arrives', () => {
    renderPanel({ history: null, loading: true })

    expect(screen.getByRole('status')).toHaveTextContent(/loading the correction timeline/i)
  })

  it('renders nothing when the history is missing and not loading', () => {
    const { container } = renderPanel({ history: null, loading: false })

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the return reason, the correction and the acknowledgement in order', () => {
    renderPanel({
      history: history({
        revisions: [history().revisions[0], correctionRevision],
        declarations: [
          { id: 3, timesheetId: 12, statementVersion: 's3-m3-v1', declaredAt: '2030-09-10T09:05:00.000Z' },
        ],
      }),
    })

    const events = screen.getAllByRole('listitem').map((item) => item.textContent)
    expect(events).toHaveLength(4)
    expect(events[0]).toMatch(/sent for review/i)
    expect(events[1]).toMatch(/returned by the organiser/i)
    expect(events[1]).toMatch(/please correct tuesday hours/i)
    expect(events[2]).toMatch(/corrected/i)
    expect(events[2]).toMatch(/2\.5h to 1\.5h/i)
    expect(events[3]).toMatch(/declaration acknowledged/i)
  })

  it('prefills the corrected figures from the session being corrected', () => {
    renderPanel()

    chooseTuesdayLab()

    expect(screen.getByLabelText(/corrected hours/i)).toHaveValue(2.5)
    expect(screen.getByLabelText(/corrected description/i)).toHaveValue('Tuesday lab')
  })

  it('saves a correction and repeats back what it replaced', async () => {
    const onCorrected = vi.fn()
    mockCorrectTimesheetWorkLog.mockResolvedValueOnce({ workLog: { id: 2 }, revision: correctionRevision })
    renderPanel({ onCorrected })

    chooseTuesdayLab()
    fireEvent.change(screen.getByLabelText(/corrected hours/i), { target: { value: '1.5' } })
    fireEvent.change(screen.getByLabelText(/corrected description/i), {
      target: { value: 'Shortened Tuesday lab' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save correction/i }))

    await waitFor(() => {
      expect(mockCorrectTimesheetWorkLog).toHaveBeenCalledWith(
        12,
        2,
        { hours: 1.5, description: 'Shortened Tuesday lab' },
        tokenGetter,
      )
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/the figures it replaced stay/i)
    expect(onCorrected).toHaveBeenCalled()
    expect(screen.getByLabelText(/^session$/i)).toHaveValue('')
  })

  it('refuses a correction with no session chosen, without calling the API', () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: /save correction/i }))

    expect(screen.getByText(/select the session you are correcting/i)).toBeInTheDocument()
    expect(mockCorrectTimesheetWorkLog).not.toHaveBeenCalled()
  })

  it('refuses hours that no single session could hold', () => {
    renderPanel()

    chooseTuesdayLab()
    fireEvent.change(screen.getByLabelText(/corrected hours/i), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: /save correction/i }))

    expect(screen.getByText(/cannot exceed 24/i)).toBeInTheDocument()
    expect(mockCorrectTimesheetWorkLog).not.toHaveBeenCalled()
  })

  it('explains that a locked week cannot be corrected', async () => {
    mockCorrectTimesheetWorkLog.mockRejectedValueOnce(
      apiError('TIMESHEET_EDIT_LOCKED', 'Only a draft or returned timesheet can be changed.'),
    )
    renderPanel()

    chooseTuesdayLab()
    fireEvent.click(screen.getByRole('button', { name: /save correction/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(/already been submitted and cannot be corrected/i)
  })

  it('explains a weekly hours limit refusal', async () => {
    mockCorrectTimesheetWorkLog.mockRejectedValueOnce(
      apiError('TIMESHEET_CORRECTION_CONFLICT', 'The change breaks a weekly hours rule.'),
    )
    renderPanel()

    chooseTuesdayLab()
    fireEvent.click(screen.getByRole('button', { name: /save correction/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(/breaks the weekly hours limit/i)
  })

  it('offers the declaration only while the week is returned', () => {
    const { unmount } = renderPanel()
    expect(screen.getByRole('checkbox', { name: /i acknowledge this declaration/i })).toBeInTheDocument()
    expect(screen.getByText(statement)).toBeInTheDocument()
    unmount()

    renderPanel({ history: history({ timesheet: { status: 'APPROVED' } }) })
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('reports the acknowledgement with the wording version on screen', () => {
    const onDeclaredChange = vi.fn()
    renderPanel({ onDeclaredChange })

    fireEvent.click(screen.getByRole('checkbox', { name: /i acknowledge this declaration/i }))

    expect(onDeclaredChange).toHaveBeenCalledWith(true)
  })

  it('hides the correction form on a week that is no longer editable', () => {
    renderPanel({
      history: history({ timesheet: { status: 'APPROVED', editable: false } }),
    })

    expect(screen.queryByRole('button', { name: /save correction/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /raise a dispute/i })).toBeInTheDocument()
  })

  it('has nothing to correct on a returned week with no logged sessions', () => {
    renderPanel({ history: history({ workLogs: [] }) })

    expect(screen.queryByRole('button', { name: /save correction/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /raise a dispute/i })).toBeInTheDocument()
  })

  it('raises a dispute and asks for the history to be reread', async () => {
    const onDisputeChanged = vi.fn()
    mockRaiseTimesheetDispute.mockResolvedValueOnce({
      id: 4,
      timesheetId: 12,
      tutorId: 7,
      reason: 'The session ran the full two hours',
      status: 'OPEN',
      raisedByProfileId: 7,
      resolvedByProfileId: null,
      resolutionReason: null,
      resolvedAt: null,
      createdAt: '2030-09-11T10:00:00.000Z',
    })
    renderPanel({ onDisputeChanged })

    fireEvent.change(screen.getByLabelText(/what are you disputing/i), {
      target: { value: 'The session ran the full two hours' },
    })
    fireEvent.click(screen.getByRole('button', { name: /raise a dispute/i }))

    await waitFor(() => {
      expect(mockRaiseTimesheetDispute).toHaveBeenCalledWith(
        12,
        'The session ran the full two hours',
        tokenGetter,
      )
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/sent to the organiser/i)
    expect(onDisputeChanged).toHaveBeenCalled()
  })

  it('refuses an empty dispute rather than sending it', () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: /raise a dispute/i }))

    expect(screen.getByText(/explain what you are disputing/i)).toBeInTheDocument()
    expect(mockRaiseTimesheetDispute).not.toHaveBeenCalled()
  })

  it('shows an open dispute instead of the form that would raise another', () => {
    renderPanel({
      history: history({
        disputes: [
          {
            id: 4,
            timesheetId: 12,
            tutorId: 7,
            reason: 'The session ran the full two hours',
            status: 'OPEN',
            raisedByProfileId: 7,
            resolvedByProfileId: null,
            resolutionReason: null,
            resolvedAt: null,
            createdAt: '2030-09-11T10:00:00.000Z',
          },
        ],
      }),
    })

    expect(screen.getByRole('alert')).toHaveTextContent(/dispute open since/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/the session ran the full two hours/i)
    expect(screen.queryByRole('button', { name: /raise a dispute/i })).not.toBeInTheDocument()
  })

  it('reports an objection the organiser has already answered', () => {
    renderPanel({
      history: history({
        disputes: [
          {
            id: 4,
            timesheetId: 12,
            tutorId: 7,
            reason: 'The session ran the full two hours',
            status: 'RESOLVED',
            raisedByProfileId: 7,
            resolvedByProfileId: 8,
            resolutionReason: 'Hours corrected after all',
            resolvedAt: '2030-09-12T09:00:00.000Z',
            createdAt: '2030-09-11T10:00:00.000Z',
          },
        ],
      }),
    })

    expect(screen.getByText(/dispute answered/i)).toBeInTheDocument()
    expect(screen.getByText(/hours corrected after all/i)).toBeInTheDocument()
    // A resolved dispute is history, so the tutor may object again.
    expect(screen.getByRole('button', { name: /raise a dispute/i })).toBeInTheDocument()
  })
})
