import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OrganiserApprovals from './OrganiserApprovals'

const listOrganiserApprovals = vi.fn()
const decideTimesheet = vi.fn()
const decideVolunteerClaim = vi.fn()
const decideExcuse = vi.fn()
const getAccessTokenSilently = vi.fn()

vi.mock('../api/organiser', () => ({
  listOrganiserApprovals: (...args) => listOrganiserApprovals(...args),
  decideTimesheet: (...args) => decideTimesheet(...args),
  decideVolunteerClaim: (...args) => decideVolunteerClaim(...args),
  decideExcuse: (...args) => decideExcuse(...args),
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
