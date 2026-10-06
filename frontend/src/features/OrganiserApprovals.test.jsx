vi.mock('../api/studentSickNotes', () => ({ listStudentSickNotes: vi.fn(async () => ({ items: [], pendingCount: 0, page: 1, hasMore: false })), decideStudentSickNote: vi.fn() }))
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OrganiserApprovals from './OrganiserApprovals'

const listOrganiserApprovals = vi.fn()
const decideTimesheet = vi.fn()
const decideVolunteerClaim = vi.fn()
const decideExcuse = vi.fn()
const listTimesheetDisputes = vi.fn()
const resolveTimesheetDispute = vi.fn()
const approveTimesheets = vi.fn()
const getAccessTokenSilently = vi.fn()

vi.mock('../api/organiser', () => ({
  listOrganiserApprovals: (...args) => listOrganiserApprovals(...args),
  decideTimesheet: (...args) => decideTimesheet(...args),
  decideVolunteerClaim: (...args) => decideVolunteerClaim(...args),
  decideExcuse: (...args) => decideExcuse(...args),
  listTimesheetDisputes: (...args) => listTimesheetDisputes(...args),
  resolveTimesheetDispute: (...args) => resolveTimesheetDispute(...args),
  approveTimesheets: (...args) => approveTimesheets(...args),
}))

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently }),
}))

const timesheet = {
  id: 31,
  tutorId: 7,
  tutorName: 'Sam Tutor',
  tutorEmail: 'sam@tutormx.example',
  weekStart: '2030-09-02',
  submittedAt: '2030-09-07T10:00:00.000Z',
  totalHours: 2,
  workLogs: [{
    id: 41,
    allocationId: 11,
    courseCode: 'COMS3011',
    courseName: 'Software Design Project',
    workDate: '2030-09-04',
    hours: 2,
    description: 'Led the tutorial',
  }],
}

const claim = {
  id: 51,
  overflowWorkId: 61,
  studentId: 9,
  studentName: 'Ada Student',
  studentEmail: 'ada@tutormx.example',
  courseCode: 'COMS3011',
  courseName: 'Software Design Project',
  startsAt: '2030-09-10T14:00:00.000Z',
  endsAt: '2030-09-10T16:00:00.000Z',
  hours: 2,
  createdAt: '2030-09-08T10:00:00.000Z',
}

const excuse = {
  id: 71,
  tutorId: 7,
  tutorName: 'Sam Tutor',
  tutorEmail: 'sam@tutormx.example',
  allocationId: 11,
  courseCode: 'COMS3011',
  courseName: 'Software Design Project',
  startsAt: '2030-09-11T14:00:00.000Z',
  endsAt: '2030-09-11T16:00:00.000Z',
  reason: 'Hospital appointment that morning.',
  createdAt: '2030-09-09T08:00:00.000Z',
}

const queues = { timesheets: [timesheet], volunteerClaims: [claim], excuses: [] }
const queuesWithExcuse = { ...queues, excuses: [excuse] }
const emptyQueues = { timesheets: [], volunteerClaims: [], excuses: [] }

describe('OrganiserApprovals', () => {
  beforeEach(() => {
    listOrganiserApprovals.mockReset()
    decideTimesheet.mockReset()
    decideVolunteerClaim.mockReset()
    listTimesheetDisputes.mockReset().mockResolvedValue([])
    getAccessTokenSilently.mockReset()
  })

  it('shows decision-ready information and persists an approved timesheet', async () => {
    listOrganiserApprovals.mockResolvedValueOnce(queues).mockResolvedValueOnce(emptyQueues)
    decideTimesheet.mockResolvedValue({ id: 31, status: 'APPROVED' })

    render(<OrganiserApprovals />)
    const section = (await screen.findByRole('heading', { name: /^timesheets$/i })).closest('section')
    expect(within(section).getByText('Sam Tutor')).toBeInTheDocument()
    expect(within(section).getByText('COMS3011')).toBeInTheDocument()
    expect(within(section).getByText('Led the tutorial')).toBeInTheDocument()
    fireEvent.click(within(section).getByRole('button', { name: /approve timesheet/i }))

    await waitFor(() => {
      expect(decideTimesheet).toHaveBeenCalledWith(
        { timesheetId: 31, decision: 'APPROVE' },
        getAccessTokenSilently,
      )
    })
    expect(await screen.findByText(/Sam Tutor's request was approved/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /no timesheets waiting/i })).toBeInTheDocument()
  })

  it('requires a reason before returning a timesheet', async () => {
    listOrganiserApprovals.mockResolvedValue(queues)
    decideTimesheet.mockResolvedValue({ id: 31, status: 'RETURNED' })

    render(<OrganiserApprovals />)
    await screen.findByText('Sam Tutor')
    fireEvent.click(screen.getByRole('button', { name: /return for correction/i }))
    expect(screen.getByLabelText(/return reason/i)).toHaveAccessibleDescription(/add a reason/i)
    expect(decideTimesheet).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/return reason/i), { target: { value: 'Add session notes' } })
    fireEvent.click(screen.getByRole('button', { name: /return for correction/i }))
    await waitFor(() => {
      expect(decideTimesheet).toHaveBeenCalledWith(
        { timesheetId: 31, decision: 'RETURN', reason: 'Add session notes' },
        getAccessTokenSilently,
      )
    })
  })

  it('persists a rejected claim only after a reason is entered', async () => {
    listOrganiserApprovals.mockResolvedValueOnce(queues).mockResolvedValueOnce(emptyQueues)
    decideVolunteerClaim.mockResolvedValue({ id: 51, status: 'REJECTED' })

    render(<OrganiserApprovals />)
    await screen.findByText('Ada Student')
    fireEvent.click(screen.getByRole('button', { name: /reject claim/i }))
    expect(decideVolunteerClaim).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/rejection reason/i), { target: { value: 'Already assigned' } })
    fireEvent.click(screen.getByRole('button', { name: /reject claim/i }))

    await waitFor(() => {
      expect(decideVolunteerClaim).toHaveBeenCalledWith(
        { claimId: 51, decision: 'REJECT', reason: 'Already assigned' },
        getAccessTokenSilently,
      )
    })
    expect(await screen.findByText(/Ada Student's request was rejected/i)).toBeInTheDocument()
  })

  it('refreshes a stale decision and keeps a friendly error visible', async () => {
    listOrganiserApprovals.mockResolvedValueOnce(queues).mockResolvedValueOnce(emptyQueues)
    decideTimesheet.mockRejectedValue(
      Object.assign(new Error('internal detail'), { code: 'TIMESHEET_DECISION_CONFLICT' }),
    )

    render(<OrganiserApprovals />)
    fireEvent.click(await screen.findByRole('button', { name: /approve timesheet/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/changed before your decision/i)
    expect(screen.queryByText(/internal detail/i)).not.toBeInTheDocument()
    expect(listOrganiserApprovals).toHaveBeenCalledTimes(2)
  })

  it('shows a retry state when the approval API fails', async () => {
    listOrganiserApprovals
      .mockRejectedValueOnce(new Error('network detail'))
      .mockResolvedValueOnce(emptyQueues)

    render(<OrganiserApprovals />)
    expect(await screen.findByRole('heading', { name: /approvals unavailable/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('heading', { name: /no timesheets waiting/i })).toBeInTheDocument()
  })
})

describe('OrganiserApprovals excuse queue', () => {
  beforeEach(() => {
    listOrganiserApprovals.mockReset().mockResolvedValue(queuesWithExcuse)
    decideTimesheet.mockReset()
    decideVolunteerClaim.mockReset()
    decideExcuse.mockReset().mockResolvedValue({ id: 71, status: 'APPROVED' })
    listTimesheetDisputes.mockReset().mockResolvedValue([])
    getAccessTokenSilently.mockReset()
  })

  async function excuseCard() {
    render(<OrganiserApprovals />)
    const heading = await screen.findByRole('heading', { name: /^excuses$/i })
    return heading.closest('section')
  }

  it('shows enough to decide on: tutor, course, session, when asked and why', async () => {
    const section = await excuseCard()

    expect(within(section).getByText('Sam Tutor')).toBeVisible()
    expect(within(section).getByText(/COMS3011/)).toBeVisible()
    expect(within(section).getByText(/hospital appointment/i)).toBeVisible()
  })

  it('approves an excuse through the existing decision endpoint', async () => {
    const section = await excuseCard()
    fireEvent.click(within(section).getByRole('button', { name: /approve excuse/i }))

    await waitFor(() => {
      expect(decideExcuse).toHaveBeenCalledWith(
        { excuseId: 71, decision: 'APPROVE' },
        getAccessTokenSilently,
      )
    })
    // The queue is reloaded so the decided excuse leaves the list.
    await waitFor(() => expect(listOrganiserApprovals).toHaveBeenCalledTimes(2))
  })

  it('will not reject without a reason, and sends it once given', async () => {
    const section = await excuseCard()
    fireEvent.click(within(section).getByRole('button', { name: /reject excuse/i }))

    expect(
      await within(section).findByText(/add a reason for rejecting this excuse/i),
    ).toBeVisible()
    expect(decideExcuse).not.toHaveBeenCalled()

    fireEvent.change(within(section).getByLabelText(/rejection reason/i), {
      target: { value: 'Cover is already arranged.' },
    })
    fireEvent.click(within(section).getByRole('button', { name: /reject excuse/i }))

    await waitFor(() => {
      expect(decideExcuse).toHaveBeenCalledWith(
        { excuseId: 71, decision: 'REJECT', reason: 'Cover is already arranged.' },
        getAccessTokenSilently,
      )
    })
  })

  it('explains a decision someone else already made and refreshes', async () => {
    decideExcuse.mockRejectedValue(
      Object.assign(new Error('The excuse has already been decided or changed.'), {
        code: 'EXCUSE_DECISION_CONFLICT',
      }),
    )

    const section = await excuseCard()
    fireEvent.click(within(section).getByRole('button', { name: /approve excuse/i }))

    expect(await screen.findByText(/changed before your decision was saved/i)).toBeVisible()
    // Refreshed, so the screen shows the server's state rather than a card that
    // looks as though it was decided twice.
    await waitFor(() => expect(listOrganiserApprovals).toHaveBeenCalledTimes(2))
  })

  it('says so when no excuse is waiting', async () => {
    listOrganiserApprovals.mockResolvedValue(queues)

    const section = await excuseCard()
    expect(within(section).getByRole('heading', { name: /no excuses waiting/i })).toBeVisible()
  })
})


describe('Member 5 organiser approval recovery', () => {
  beforeEach(() => {
    listOrganiserApprovals.mockReset().mockResolvedValue(queues)
    listTimesheetDisputes.mockReset().mockResolvedValue([])
    decideTimesheet.mockReset()
    resolveTimesheetDispute.mockReset()
  })
  it('keeps normal approvals available if the disputes queue fails', async () => {
    listTimesheetDisputes.mockRejectedValue(new Error('404 internal detail'))
    render(<OrganiserApprovals />)
    expect(await screen.findByRole('button', { name: /approve timesheet/i })).toBeEnabled()
    expect(screen.getByText(/Disputes could not be loaded/i)).toBeInTheDocument()
    expect(screen.queryByText(/internal detail/i)).not.toBeInTheDocument()
    listTimesheetDisputes.mockResolvedValue([])
    fireEvent.click(screen.getByRole('button', { name: /retry disputes/i }))
    await waitFor(() => expect(screen.queryByText(/Disputes could not be loaded/i)).not.toBeInTheDocument())
  })
  it('shows a loading error rather than falsely claiming a decision failed', async () => {
    listOrganiserApprovals.mockRejectedValue(new Error('network'))
    render(<OrganiserApprovals />)
    expect(await screen.findByText(/could not load the approval queue/i)).toBeInTheDocument()
    expect(screen.queryByText(/Nothing changed/i)).not.toBeInTheDocument()
  })
  it('preserves a confirmed save and removes its card if refresh fails', async () => {
    listOrganiserApprovals.mockResolvedValueOnce(queues).mockRejectedValueOnce(new Error('refresh'))
    decideTimesheet.mockResolvedValue({ id: 31, status: 'APPROVED' })
    render(<OrganiserApprovals />)
    fireEvent.click(await screen.findByRole('button', { name: /approve timesheet/i }))
    expect(await screen.findByText(/Sam Tutor's request was approved/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve timesheet/i })).not.toBeInTheDocument()
    expect(screen.getByText(/queue could not be refreshed/i)).toBeInTheDocument()
  })
  it('renders the actual dispute DTO and records an honest resolution', async () => {
    listTimesheetDisputes.mockResolvedValueOnce([{ id: 71, timesheetId: 31, tutorId: 7, reason: 'Please recheck my hours.', createdAt: '2030-09-09T08:00:00Z', status: 'OPEN' }]).mockResolvedValueOnce([])
    resolveTimesheetDispute.mockResolvedValue({ id: 71, status: 'RESOLVED' })
    render(<OrganiserApprovals />)
    expect(await screen.findByText('Tutor #7')).toBeInTheDocument()
    expect(screen.getByText('#31')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reinstate timesheet/i })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/resolution reason/i), { target: { value: 'Reviewed together.' } })
    fireEvent.click(screen.getByRole('button', { name: /resolve dispute/i }))
    expect(await screen.findByText(/timesheet status is unchanged/i)).toBeInTheDocument()
    expect(resolveTimesheetDispute).toHaveBeenCalledWith({ disputeId: 71, resolutionReason: 'Reviewed together.' }, getAccessTokenSilently)
  })
  it('blocks repeated clicks while a decision is being saved', async () => {
    let finish
    decideTimesheet.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    render(<OrganiserApprovals />)
    const approve = await screen.findByRole('button', { name: /approve timesheet/i })
    fireEvent.click(approve)
    fireEvent.click(approve)
    expect(decideTimesheet).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /approve claim/i })).toBeDisabled()
    finish({ id: 31, status: 'APPROVED' })
    await screen.findByText(/request was approved/i)
  })
})

describe('OrganiserApprovals bulk timesheet approval', () => {
  const second = { ...timesheet, id: 32, tutorName: 'Lee Tutor', tutorEmail: 'lee@tutormx.example', totalHours: 3 }
  const third = { ...timesheet, id: 33, tutorName: 'Kim Tutor', tutorEmail: 'kim@tutormx.example', totalHours: 4 }

  beforeEach(() => {
    listOrganiserApprovals.mockReset()
    listTimesheetDisputes.mockReset().mockResolvedValue([])
    approveTimesheets.mockReset()
    getAccessTokenSilently.mockReset()
  })

  it('approves the selected timesheets together after confirmation', async () => {
    listOrganiserApprovals
      .mockResolvedValueOnce({ ...emptyQueues, timesheets: [timesheet, second, third] })
      .mockResolvedValue({ ...emptyQueues, timesheets: [third] })
    approveTimesheets.mockResolvedValue([
      { timesheetId: 31, outcome: 'approved' },
      { timesheetId: 32, outcome: 'approved' },
    ])
    render(<OrganiserApprovals />)

    const approveSelected = await screen.findByRole('button', { name: /approve selected \(0\)/i })
    expect(approveSelected).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/select Sam Tutor's timesheet/i))
    fireEvent.click(screen.getByLabelText(/select Lee Tutor's timesheet/i))
    fireEvent.click(screen.getByRole('button', { name: /approve selected \(2\)/i }))

    const dialog = await screen.findByRole('dialog', { name: /approve 2 timesheets/i })
    expect(within(dialog).getByText(/5 hours in total/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/Lee Tutor, week of/i)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: /approve timesheets/i }))

    await waitFor(() => expect(approveTimesheets).toHaveBeenCalledWith([31, 32], getAccessTokenSilently))
    expect(await screen.findByText('2 timesheets were approved.')).toBeInTheDocument()
    expect(screen.queryByText('Sam Tutor')).not.toBeInTheDocument()
    expect(screen.getByText('Kim Tutor')).toBeInTheDocument()
  })

  it('selects every waiting timesheet at once', async () => {
    listOrganiserApprovals.mockResolvedValue({ ...emptyQueues, timesheets: [timesheet, second] })
    render(<OrganiserApprovals />)

    fireEvent.click(await screen.findByLabelText(/select all 2 timesheets/i))
    expect(screen.getByRole('button', { name: /approve selected \(2\)/i })).toBeEnabled()
    fireEvent.click(screen.getByLabelText(/select all 2 timesheets/i))
    expect(screen.getByRole('button', { name: /approve selected \(0\)/i })).toBeDisabled()
  })

  it('reports timesheets that could not be approved and keeps them in the queue', async () => {
    listOrganiserApprovals
      .mockResolvedValueOnce({ ...emptyQueues, timesheets: [timesheet, second] })
      .mockResolvedValue({ ...emptyQueues, timesheets: [second] })
    approveTimesheets.mockResolvedValue([
      { timesheetId: 31, outcome: 'approved' },
      { timesheetId: 32, outcome: 'failed', code: 'TIMESHEET_DECISION_CONFLICT', message: 'The timesheet changed before this decision could be applied.' },
    ])
    render(<OrganiserApprovals />)

    fireEvent.click(await screen.findByLabelText(/select all 2 timesheets/i))
    fireEvent.click(screen.getByRole('button', { name: /approve selected \(2\)/i }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /approve timesheets/i }))

    expect(await screen.findByText('1 timesheet was approved.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/1 timesheet was not approved: The timesheet changed/i)
    expect(screen.getByText('Lee Tutor')).toBeInTheDocument()
  })
})
