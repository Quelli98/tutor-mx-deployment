import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import OwedWork from './OwedWork'

describe('What you owe', () => {
  it('says so when the tutor is up to date', () => {
    render(<OwedWork obligations={[]} />)
    expect(screen.getByRole('heading', { name: 'What you owe' })).toBeInTheDocument()
    expect(screen.getByText(/You are up to date/)).toBeInTheDocument()
  })

  it('lists what is owed, when, and where to do it', () => {
    render(<OwedWork obligations={[
      { kind: 'RESUBMIT_TIMESHEET', title: 'Fix and resubmit your timesheet for the week ending Sun 27 Sept', weekEnding: '2026-09-27',
        dueAt: '2026-10-04T08:00:00.000Z', overdue: true, allocationId: null, timesheetId: 7 },
      { kind: 'LOG_HOURS', title: 'Log your hours for COMS3011 on Tue 6 Oct', weekEnding: '2026-10-11',
        dueAt: null, overdue: false, allocationId: 4, timesheetId: null },
      { kind: 'SUBMIT_TIMESHEET', title: 'Submit your timesheet for the week ending Sun 4 Oct', weekEnding: '2026-10-04',
        dueAt: null, overdue: true, allocationId: null, timesheetId: 3 },
    ]} />)

    const items = within(screen.getByRole('list', { name: 'Work you still owe' })).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent(/Was due/)
    expect(within(items[0]).getByRole('link', { name: 'Fix timesheet' })).toHaveAttribute('href', '/tutor/forms')
    expect(items[1]).toHaveTextContent(/For the week ending/)
    expect(within(items[1]).getByRole('link', { name: 'Log hours' })).toBeInTheDocument()
    expect(items[2]).toHaveTextContent(/Week ended/)
    expect(within(items[2]).getByRole('link', { name: 'Submit timesheet' })).toBeInTheDocument()
    expect(screen.getByText('3 to do, 2 past due')).toBeInTheDocument()
  })
})
