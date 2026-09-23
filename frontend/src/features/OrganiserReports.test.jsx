import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OrganiserReports from './OrganiserReports'

const getWorkloadReport = vi.fn()
const getAccessTokenSilently = vi.fn()

vi.mock('../api/organiser', () => ({
  getWorkloadReport: (...args) => getWorkloadReport(...args),
}))

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently }),
}))

const course = {
  courseId: 3,
  courseCode: 'COMS3011',
  courseName: 'Software Design Project',
  allocatedHours: 24,
  approvedWorkedHours: 18,
  hourlyRate: 30,
  budget: 5000,
  spend: 540,
  committed: 720,
  budgetRemaining: 4460,
}

const tutor = {
  tutorId: 7,
  fullName: 'Sam Tutor',
  capacityHours: 40,
  allocatedHours: 6,
  approvedWorkedHours: 4,
  shareOfAllocatedHours: 0.25,
}

const report = {
  period: { weekStart: '2026-09-14T00:00:00.000Z', weekEnd: '2026-10-12T00:00:00.000Z', weeks: 4 },
  courses: [course],
  tutors: [tutor],
}

function reportWith(overrides) {
  return { ...report, ...overrides }
}

async function renderReports() {
  render(<OrganiserReports />)
  return (await screen.findByRole('heading', { name: /^courses$/i })).closest('section')
}

describe('OrganiserReports', () => {
  beforeEach(() => {
    // Frozen so the default period is the same on any day the suite runs.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-16T12:00:00.000Z'))
    getWorkloadReport.mockReset().mockResolvedValue(report)
    getAccessTokenSilently.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('asks for whole weeks starting on a Monday', async () => {
    await renderReports()

    // 2026-09-16 is a Wednesday; the week it falls in starts Monday the 14th.
    expect(getWorkloadReport).toHaveBeenCalledWith(
      { weekStart: '2026-09-14', weeks: 4 },
      getAccessTokenSilently,
    )
  })

  it('reloads with a different length when the organiser picks one', async () => {
    await renderReports()
    fireEvent.change(screen.getByLabelText(/length/i), { target: { value: '12' } })

    await waitFor(() =>
      expect(getWorkloadReport).toHaveBeenLastCalledWith(
        { weekStart: '2026-09-14', weeks: 12 },
        getAccessTokenSilently,
      ),
    )
  })

  it('keeps allocated hours, approved worked hours and money in separate columns', async () => {
    const section = await renderReports()
    const cells = within(section).getAllByRole('row')[1].querySelectorAll('td')

    expect(cells[1]).toHaveTextContent('24 h')
    expect(cells[2]).toHaveTextContent('18 h')
    expect(cells[3]).toHaveTextContent('R540.00')
    expect(cells[4]).toHaveTextContent('R720.00')
  })

  it('states the budget position in a sentence, not only a bar', async () => {
    const section = await renderReports()

    expect(within(section).getByText('R540.00 of R5000.00 spent, R4460.00 left.')).toBeVisible()
  })

  it('says how far over budget a course has gone', async () => {
    getWorkloadReport.mockResolvedValue(
      reportWith({
        courses: [{ ...course, spend: 5400, budgetRemaining: -400 }],
      }),
    )

    const section = await renderReports()
    expect(
      within(section).getByText('R5400.00 spent against a R5000.00 budget, R400.00 over.'),
    ).toBeVisible()
  })

  it('does not invent money when a course has no rate', async () => {
    getWorkloadReport.mockResolvedValue(
      reportWith({
        courses: [{ ...course, hourlyRate: null, spend: null, committed: null, budgetRemaining: null }],
      }),
    )

    const section = await renderReports()
    expect(within(section).getByText(/no hourly rate set/i)).toBeVisible()
    // Hours are still known, so they are still shown.
    expect(within(section).getByText('24 h')).toBeVisible()
  })

  it('shows capacity and share per tutor, and capacity nowhere else', async () => {
    await renderReports()
    const tutorSection = screen.getByRole('heading', { name: /^tutors$/i }).closest('section')
    const cells = within(tutorSection).getAllByRole('row')[1].querySelectorAll('td')

    expect(cells[1]).toHaveTextContent('40 h')
    expect(cells[4]).toHaveTextContent('25%')
    // A weekly limit is not divided between courses, so a per-course capacity
    // would count the same hours once per course.
    const courseSection = screen.getByRole('heading', { name: /^courses$/i }).closest('section')
    expect(within(courseSection).queryByText(/capacity/i)).not.toBeInTheDocument()
  })

  it('says when a tutor has no weekly limit set rather than showing zero', async () => {
    getWorkloadReport.mockResolvedValue(
      reportWith({ tutors: [{ ...tutor, capacityHours: null }] }),
    )

    await renderReports()
    const tutorSection = screen.getByRole('heading', { name: /^tutors$/i }).closest('section')
    expect(within(tutorSection).getByText('Not set')).toBeVisible()
  })

  it('carries the notes an organiser needs to read the figures correctly', async () => {
    await renderReports()

    expect(screen.getByText(/current hourly rate/i)).toBeVisible()
    expect(screen.getByText(/only count once a timesheet has been approved/i)).toBeVisible()
    expect(screen.getByText(/today's weekly limits/i)).toBeVisible()
    expect(screen.getByText(/counted in the week a session starts/i)).toBeVisible()
  })

  it('keeps every row the same width as its header', async () => {
    await renderReports()

    for (const table of screen.getAllByRole('table')) {
      const rows = within(table).getAllByRole('row')
      const headerCount = within(rows[0]).getAllByRole('columnheader').length
      for (const row of rows.slice(1)) {
        expect(within(row).getAllByRole('cell')).toHaveLength(headerCount)
      }

      // A <td> with display:grid stops being a table cell, and two adjacent
      // ones merge into one anonymous cell, shifting every later column left.
      // jsdom does no layout and cannot see that, so the rule is guarded
      // structurally: the grid belongs on a wrapper inside the cell.
      expect(table.querySelectorAll('td.table-cell-stack')).toHaveLength(0)
    }
  })

  it('explains a failed report without leaking detail', async () => {
    getWorkloadReport.mockRejectedValue(
      Object.assign(new Error('private detail'), { code: 'REPORTING_UNAVAILABLE' }),
    )

    render(<OrganiserReports />)

    expect(await screen.findByRole('heading', { name: /report unavailable/i })).toBeVisible()
    expect(screen.getByText(/not available right now/i)).toBeVisible()
    expect(screen.queryByText(/private detail/i)).not.toBeInTheDocument()
  })

  it('says so when there is nothing to report', async () => {
    getWorkloadReport.mockResolvedValue(reportWith({ courses: [], tutors: [] }))

    render(<OrganiserReports />)
    expect(await screen.findByRole('heading', { name: /nothing to report yet/i })).toBeVisible()
  })
})
