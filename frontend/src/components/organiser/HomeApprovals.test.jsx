import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HomeApprovals } from './HomeApprovals'
import { useOrganiserApprovals } from '../../features/useOrganiserApprovals'

const listOrganiserApprovals = vi.fn()
const listTimesheetDisputes = vi.fn()
const decideTimesheet = vi.fn()
const decideVolunteerClaim = vi.fn()
const decideExcuse = vi.fn()
const resolveTimesheetDispute = vi.fn()
const getAccessTokenSilently = vi.fn()

vi.mock('../../api/organiser', () => ({
  listOrganiserApprovals: (...args) => listOrganiserApprovals(...args),
  listTimesheetDisputes: (...args) => listTimesheetDisputes(...args),
  decideTimesheet: (...args) => decideTimesheet(...args),
  decideVolunteerClaim: (...args) => decideVolunteerClaim(...args),
  decideExcuse: (...args) => decideExcuse(...args),
  resolveTimesheetDispute: (...args) => resolveTimesheetDispute(...args),
}))

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently }),
}))

const timesheet = {
  id: 5,
  tutorId: 7,
  tutorName: 'Thabo Nkosi',
  tutorEmail: 'thabo@example.com',
  weekStart: '2026-09-14T00:00:00.000Z',
  submittedAt: '2026-09-19T10:00:00.000Z',
  totalHours: 8.5,
  workLogs: [
    { id: 1, allocationId: 3, courseCode: 'COMS1018A', courseName: 'Basic Computer Organisation', workDate: '2026-09-15', hours: 4, description: 'Lab' },
    { id: 2, allocationId: 4, courseCode: 'COMS1018A', courseName: 'Basic Computer Organisation', workDate: '2026-09-17', hours: 4.5, description: 'Lab' },
  ],
}
const claim = {
  id: 9,
  overflowWorkId: 2,
  studentId: 4,
  studentName: 'Lindiwe Zulu',
  studentEmail: 'lindiwe@example.com',
  courseCode: 'COMS2002A',
  courseName: 'Database Fundamentals',
  startsAt: '2026-09-23T08:15:00.000Z',
  endsAt: '2026-09-23T10:00:00.000Z',
  hours: 1.75,
  createdAt: '2026-09-20T09:00:00.000Z',
}
const dispute = {
  id: 12,
  timesheetId: 5,
  tutorId: 8,
  tutorName: 'Aisha Patel',
  tutorEmail: 'aisha@example.com',
  reason: 'My lab on Thursday is missing.',
  createdAt: '2026-09-21T09:00:00.000Z',
}

function Harness() {
  return <HomeApprovals approvals={useOrganiserApprovals()} />
}

function renderCard() {
  render(<Harness />, { wrapper: MemoryRouter })
}

describe('HomeApprovals', () => {
  beforeEach(() => {
    listOrganiserApprovals.mockReset().mockResolvedValue({ timesheets: [timesheet], volunteerClaims: [claim], excuses: [] })
    listTimesheetDisputes.mockReset().mockResolvedValue([dispute])
    decideTimesheet.mockReset().mockResolvedValue({ id: 5 })
    decideVolunteerClaim.mockReset().mockResolvedValue({ id: 9 })
    decideExcuse.mockReset().mockResolvedValue({ id: 1, status: 'APPROVED' })
    resolveTimesheetDispute.mockReset().mockResolvedValue({ id: 12 })
    getAccessTokenSilently.mockReset()
  })

  it('shows the four queues as tabs with how many are waiting', async () => {
    renderCard()

    const tabs = await screen.findByRole('tablist', { name: /approval queues/i })
    expect(within(tabs).getByRole('tab', { name: /timesheets, 1 waiting/i })).toHaveAttribute('aria-selected', 'true')
    expect(within(tabs).getByRole('tab', { name: /overflow claims, 1 waiting/i })).toBeInTheDocument()
    expect(within(tabs).getByRole('tab', { name: /excuses, 0 waiting/i })).toBeInTheDocument()
    expect(within(tabs).getByRole('tab', { name: /disputes, 1 waiting/i })).toBeInTheDocument()
    expect(screen.getByText(/^COMS1018A · Week of 14 Sept? · 8.5 h$/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /see all approvals/i })).toHaveAttribute('href', '/organiser/approvals')
  })

  it('approves a timesheet straight from Home', async () => {
    renderCard()

    fireEvent.click(await screen.findByRole('button', { name: "Approve Thabo Nkosi's timesheet" }))

    await waitFor(() => {
      expect(decideTimesheet).toHaveBeenCalledWith({ timesheetId: 5, decision: 'APPROVE' }, getAccessTokenSilently)
    })
    expect(await screen.findByRole('status')).toHaveTextContent("Thabo Nkosi's request was approved.")
  })

  it('asks for a reason before returning a timesheet', async () => {
    renderCard()

    fireEvent.click(await screen.findByRole('button', { name: "Return Thabo Nkosi's timesheet" }))
    const reason = screen.getByLabelText(/return reason/i)
    fireEvent.click(screen.getByRole('button', { name: /^return timesheet$/i }))

    expect(reason).toHaveAccessibleDescription('Add a reason for returning this timesheet.')
    expect(decideTimesheet).not.toHaveBeenCalled()

    fireEvent.change(reason, { target: { value: 'Split Thursday into two entries.' } })
    fireEvent.click(screen.getByRole('button', { name: /^return timesheet$/i }))
    await waitFor(() => {
      expect(decideTimesheet).toHaveBeenCalledWith(
        { timesheetId: 5, decision: 'RETURN', reason: 'Split Thursday into two entries.' },
        getAccessTokenSilently,
      )
    })
  })

  it('rejects an overflow claim with a reason from its tab', async () => {
    renderCard()

    fireEvent.click(await screen.findByRole('tab', { name: /overflow claims/i }))
    fireEvent.click(screen.getByRole('button', { name: "Reject Lindiwe Zulu's claim" }))
    fireEvent.change(screen.getByLabelText(/rejection reason/i), { target: { value: 'Already filled.' } })
    fireEvent.click(screen.getByRole('button', { name: /^reject claim$/i }))

    await waitFor(() => {
      expect(decideVolunteerClaim).toHaveBeenCalledWith(
        { claimId: 9, decision: 'REJECT', reason: 'Already filled.' },
        getAccessTokenSilently,
      )
    })
  })

  it('resolves a dispute only with a written resolution', async () => {
    renderCard()

    fireEvent.click(await screen.findByRole('tab', { name: /disputes/i }))
    expect(screen.getByText('Their reason: My lab on Thursday is missing.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: "Resolve Aisha Patel's dispute" }))
    fireEvent.click(screen.getByRole('button', { name: /^resolve dispute$/i }))
    expect(screen.getByLabelText(/resolution reason/i)).toHaveAccessibleDescription('A resolution reason is required.')

    fireEvent.change(screen.getByLabelText(/resolution reason/i), { target: { value: 'Added the missing lab.' } })
    fireEvent.click(screen.getByRole('button', { name: /^resolve dispute$/i }))
    await waitFor(() => {
      expect(resolveTimesheetDispute).toHaveBeenCalledWith(
        { disputeId: 12, resolutionReason: 'Added the missing lab.' },
        getAccessTokenSilently,
      )
    })
  })

  it('moves between tabs with the arrow keys', async () => {
    renderCard()

    const first = await screen.findByRole('tab', { name: /timesheets/i })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: /overflow claims/i })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('tab', { name: /overflow claims/i }), { key: 'ArrowLeft' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(first, { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: /disputes/i })).toHaveAttribute('aria-selected', 'true')
  })

  it('explains a failed load without showing the raw error', async () => {
    listOrganiserApprovals.mockRejectedValue(Object.assign(new Error('database host 10.0.0.4'), { code: 'REQUEST_FAILED' }))
    renderCard()

    expect(await screen.findByRole('heading', { name: /approvals unavailable/i })).toBeInTheDocument()
    expect(screen.getByText('We could not load the approval queue. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(/10\.0\.0\.4/)).not.toBeInTheDocument()
  })
})
