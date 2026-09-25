import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CommandCentre from './CommandCentre'

const getCommandCentreSummary = vi.fn()
const getAccessTokenSilently = vi.fn()

vi.mock('../api/organiser', () => ({
  getCommandCentreSummary: (...args) => getCommandCentreSummary(...args),
}))

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently }),
}))

function requirement(overrides = {}) {
  return {
    id: 12,
    courseId: 3,
    courseCode: 'COMS3011',
    courseName: 'Software Design Project',
    startsAt: '2026-09-14T14:00:00.000Z',
    endsAt: '2026-09-14T18:00:00.000Z',
    tutorsNeeded: 2,
    windowHours: 4,
    requiredHours: 8,
    assignedHours: 0,
    shortageHours: 8,
    shortageTutors: 2,
    fillState: 'unfilled',
    status: 'OPEN',
    notes: null,
    createdById: 8,
    createdAt: '2026-09-08T09:00:00.000Z',
    updatedAt: '2026-09-08T09:00:00.000Z',
    ...overrides,
  }
}

function days() {
  return Array.from({ length: 7 }, (_, index) => ({
    date: `2026-09-${String(14 + index).padStart(2, '0')}`,
    requiredHours: index === 0 ? 12 : 0,
    assignedHours: index === 0 ? 6 : 0,
    unfilledHours: index === 0 ? 6 : 0,
    requirements: index === 0 ? 2 : 0,
    fillState: index === 0 ? 'partially-filled' : null,
  }))
}

const summary = {
  period: {
    weekStart: '2026-09-14T00:00:00.000Z',
    weekEnd: '2026-10-12T00:00:00.000Z',
    weeks: 4,
  },
  staffing: {
    requiredHours: 12,
    assignedHours: 6,
    unfilledHours: 6,
    openRequirements: 2,
    unfilledRequirements: 1,
    requirements: [requirement()],
    days: days(),
  },
  finance: {
    budget: 1500,
    spend: 1100,
    committed: 300,
    remaining: 400,
    overBudgetCourses: 0,
    unpricedCourses: 0,
    courses: [
      {
        courseId: 3,
        courseCode: 'COMS3011',
        courseName: 'Software Design Project',
        allocatedHours: 6,
        approvedWorkedHours: 4,
        hourlyRate: 30,
        budget: 1500,
        spend: 1100,
        committed: 300,
        budgetRemaining: 400,
      },
    ],
  },
  workload: {
    tutors: [
      {
        tutorId: 7,
        fullName: 'Ada Tutor',
        capacityHours: 40,
        allocatedHours: 6,
        approvedWorkedHours: 4,
        shareOfAllocatedHours: 1,
      },
    ],
  },
  actions: {
    pendingTimesheets: 1,
    pendingVolunteerClaims: 0,
    pendingExcuses: 0,
    openDisputes: 0,
    total: 1,
  },
  overflow: { openItems: 1, openHours: 2, unclaimedItems: 0 },
}

function summaryWith(overrides) {
  return { ...summary, ...overrides }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CommandCentre />
    </MemoryRouter>,
  )
}

async function renderLoaded() {
  renderPage()
  return (await screen.findByRole('heading', { name: 'At a glance' })).closest('section')
}

function kpiCard(label) {
  return screen.getByRole('heading', { name: label }).closest('article')
}

describe('CommandCentre', () => {
  beforeEach(() => {
    // Frozen so the default period is the same on any day the suite runs.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-16T12:00:00.000Z'))
    getCommandCentreSummary.mockReset().mockResolvedValue(summary)
    getAccessTokenSilently.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('asks for whole weeks starting on a Monday', async () => {
    await renderLoaded()

    // 2026-09-16 is a Wednesday; the week it falls in starts Monday the 14th.
    expect(getCommandCentreSummary).toHaveBeenCalledWith(
      { weekStart: '2026-09-14', weeks: 4 },
      getAccessTokenSilently,
    )
  })

  it('shows the figures the server sent, and no others', async () => {
    await renderLoaded()

    expect(within(kpiCard('Allocated hours')).getByText('6 h')).toBeVisible()
    expect(within(kpiCard('Required hours')).getByText('12 h')).toBeVisible()
    expect(within(kpiCard('Unfilled work')).getByText('6 h')).toBeVisible()
    expect(within(kpiCard('Spend')).getByText('R1100.00')).toBeVisible()
    expect(within(kpiCard('Budget')).getByText('R1500.00')).toBeVisible()
    expect(within(kpiCard('Outstanding actions')).getByText('1')).toBeVisible()
  })

  it('asks the same question again when the organiser presses Refresh', async () => {
    await renderLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => expect(getCommandCentreSummary).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('heading', { name: 'At a glance' })).toBeVisible()
  })

  it('reads a longer period when the organiser picks one', async () => {
    await renderLoaded()

    fireEvent.change(screen.getByLabelText(/length/i), { target: { value: '12' } })

    await waitFor(() =>
      expect(getCommandCentreSummary).toHaveBeenLastCalledWith(
        { weekStart: '2026-09-14', weeks: 12 },
        getAccessTokenSilently,
      ),
    )
  })

  it('snaps a chosen day to the Monday of its week', async () => {
    await renderLoaded()

    fireEvent.change(screen.getByLabelText(/go to week/i), { target: { value: '2026-10-01' } })

    await waitFor(() =>
      expect(getCommandCentreSummary).toHaveBeenLastCalledWith(
        { weekStart: '2026-09-28', weeks: 4 },
        getAccessTokenSilently,
      ),
    )
  })

  it('says it is reading the summary before the figures arrive', () => {
    getCommandCentreSummary.mockReturnValue(new Promise(() => {}))
    renderPage()

    expect(screen.getByRole('heading', { name: /reading the command centre/i })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'At a glance' })).not.toBeInTheDocument()
  })

  it('explains a failure without leaking detail and reads again on retry', async () => {
    getCommandCentreSummary
      .mockRejectedValueOnce(
        Object.assign(new Error('private connection detail'), {
          code: 'COMMAND_CENTRE_UNAVAILABLE',
        }),
      )
      .mockResolvedValueOnce(summary)

    renderPage()

    expect(
      await screen.findByRole('heading', { name: /command centre unavailable/i }),
    ).toBeVisible()
    expect(screen.getByText(/not available right now/i)).toBeVisible()
    expect(screen.queryByText(/private connection detail/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { name: 'At a glance' })).toBeVisible()
    expect(getCommandCentreSummary).toHaveBeenCalledTimes(2)
  })

  it('says the period is empty instead of drawing blank panels', async () => {
    getCommandCentreSummary.mockResolvedValue(
      summaryWith({
        staffing: { ...summary.staffing, requirements: [], days: [], unfilledRequirements: 0 },
        finance: { ...summary.finance, courses: [] },
        workload: { tutors: [] },
        actions: { ...summary.actions, pendingTimesheets: 0, total: 0 },
        overflow: { openItems: 0, openHours: 0, unclaimedItems: 0 },
      }),
    )

    renderPage()

    expect(await screen.findByRole('heading', { name: /nothing in these weeks yet/i })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'At a glance' })).not.toBeInTheDocument()
  })

  it('takes every headline figure to the screen that handles it', async () => {
    await renderLoaded()

    expect(within(kpiCard('Allocated hours')).getByRole('link')).toHaveAttribute(
      'href',
      '/organiser',
    )
    expect(within(kpiCard('Unfilled work')).getByRole('link')).toHaveAttribute(
      'href',
      '/organiser/staffing/bulk',
    )
    expect(within(kpiCard('Outstanding actions')).getByRole('link')).toHaveAttribute(
      'href',
      '/organiser/approvals',
    )
    expect(within(kpiCard('Spend')).getByRole('link')).toHaveAttribute(
      'href',
      '/organiser/reports',
    )
  })

  it('shows the day-by-day staffing the server summed', async () => {
    await renderLoaded()

    const table = screen.getByRole('table', { name: /hours required, allocated/i })
    expect(within(table).getByText('12 h')).toBeVisible()
    expect(within(table).getByText('6 h unfilled')).toBeVisible()
    // The other six days of the week hold nothing, and say so.
    expect(within(table).getAllByText(/nothing starts/i)).toHaveLength(6)
    expect(screen.getByText(/1 of the period's days still have hours unfilled/i)).toBeVisible()
  })

  it('writes the state of each day in its square rather than in colour alone', async () => {
    await renderLoaded()

    const table = screen.getByRole('table', { name: /hours required, allocated/i })
    expect(within(table).getByText('Partly staffed')).toBeVisible()
    expect(within(table).queryByText('Unstaffed')).not.toBeInTheDocument()
    // The legend says the same words the squares carry.
    expect(screen.getByText('Fully staffed')).toBeVisible()
  })

  it('links the course that starts on a day to the course screen', async () => {
    await renderLoaded()

    const table = screen.getByRole('table', { name: /hours required, allocated/i })
    expect(
      within(table).getByRole('link', { name: 'Open COMS3011: Software Design Project' }),
    ).toHaveAttribute('href', '/organiser/courses/3')
  })

  it('offers the same days as a written table only when it is asked for', async () => {
    await renderLoaded()

    const toggle = screen.getByRole('button', { name: 'Show the written list' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByRole('table', { name: /the same days in words/i }),
    ).not.toBeInTheDocument()

    fireEvent.click(toggle)

    const written = screen.getByRole('table', { name: /the same days in words/i })
    expect(written).toBeVisible()
    expect(screen.getByRole('button', { name: 'Hide the written list' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    // The same day the squares show, with the same figures, in words.
    expect(within(written).getByText('Partly staffed')).toBeVisible()
    expect(within(written).getByText('12 h')).toBeVisible()
    // Allocated and unfilled hold the same figure on this day, so it appears twice.
    expect(within(written).getAllByText('6 h')).toHaveLength(2)
    expect(within(written).getByRole('link', { name: /Open COMS3011/ })).toHaveAttribute(
      'href',
      '/organiser/courses/3',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Hide the written list' }))
    expect(
      screen.queryByRole('table', { name: /the same days in words/i }),
    ).not.toBeInTheDocument()
  })

  it('shows the budget as a gauge with the position written beside it', async () => {
    await renderLoaded()

    expect(screen.getByText('Within budget')).toBeVisible()
    expect(screen.getByText('73% of budget used')).toBeVisible()
    const meter = screen.getByRole('meter', { name: 'Budget used: R1100.00 of R1500.00' })
    expect(meter).toHaveAttribute('aria-valuenow', '73')
    expect(meter).toHaveAttribute('aria-valuetext', '73% of the budget spent')
  })

  it('writes that a period is over budget when spend has passed it', async () => {
    getCommandCentreSummary.mockResolvedValue(
      summaryWith({
        finance: {
          ...summary.finance,
          spend: 1900,
          remaining: -400,
          overBudgetCourses: 1,
          courses: [
            { ...summary.finance.courses[0], spend: 1900, budget: 1500, budgetRemaining: -400 },
          ],
        },
      }),
    )

    await renderLoaded()

    expect(screen.getByText('Over budget')).toBeVisible()
    expect(screen.getByText('127% of budget used')).toBeVisible()
    expect(screen.getByText('R1900.00 spent against a R1500.00 budget, R400.00 over.')).toBeVisible()
    // The bar can be no fuller than full, and the words say how far past it is.
    expect(screen.getByRole('meter', { name: 'Budget used: R1900.00 of R1500.00' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
    expect(screen.getByRole('link', { name: 'Open COMS3011' })).toHaveAttribute(
      'href',
      '/organiser/courses/3',
    )
  })

  it('says spend cannot be worked out rather than dividing by nothing', async () => {
    getCommandCentreSummary.mockResolvedValue(
      summaryWith({
        finance: { ...summary.finance, budget: null, spend: null, committed: null, remaining: null },
      }),
    )

    await renderLoaded()

    expect(screen.getByText('Spend cannot be worked out')).toBeVisible()
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'No hourly rate is set for a course with work in this period, so spend cannot be worked out.',
      ),
    ).toBeVisible()
  })

  it('says what is left of a tutor capacity and links to that tutor', async () => {
    await renderLoaded()

    const workload = screen
      .getByRole('heading', { name: 'Who is carrying the work' })
      .closest('section')

    expect(within(workload).getByText('34 h of 40 h capacity left.')).toBeVisible()
    expect(within(workload).getByRole('link', { name: 'Open Ada Tutor' })).toHaveAttribute(
      'href',
      '/organiser/tutors/7',
    )
    expect(
      within(workload).getByText('1 tutor carrying allocated or approved hours in this period.'),
    ).toBeVisible()
    // The spread of work is described as an indication, never as a rule.
    expect(
      within(workload).getByText(/indicative only, not a target or a fair-share rule/),
    ).toBeVisible()
  })

  it('says no tutor has hours instead of drawing an empty list', async () => {
    getCommandCentreSummary.mockResolvedValue(
      summaryWith({
        workload: {
          tutors: [
            {
              tutorId: 7,
              fullName: 'Ada Tutor',
              capacityHours: null,
              allocatedHours: 0,
              approvedWorkedHours: 0,
              shareOfAllocatedHours: 0,
            },
          ],
        },
      }),
    )

    await renderLoaded()

    const workload = screen
      .getByRole('heading', { name: 'Who is carrying the work' })
      .closest('section')

    expect(
      within(workload).getByText('No tutor has allocated or approved hours in this period.'),
    ).toBeVisible()
    expect(within(workload).queryByRole('link')).not.toBeInTheDocument()
  })

  it('keeps every heatmap row the same width as its header', async () => {
    await renderLoaded()

    const table = screen.getByRole('table', { name: /hours required, allocated/i })
    const rows = within(table).getAllByRole('row')
    const headerCount = within(rows[0]).getAllByRole('columnheader').length

    for (const row of rows.slice(1)) {
      expect(within(row).getAllByRole('cell')).toHaveLength(headerCount - 1)
    }
    // A <td> with display:grid stops being a table cell and shifts every later
    // column left; jsdom cannot see that, so the wrapper is guarded instead.
    expect(table.querySelectorAll('td.heat-cell')).toHaveLength(0)
  })

  it('sends each item that needs a person to the screen that deals with it', async () => {
    await renderLoaded()

    const feed = screen
      .getByRole('heading', { name: 'Needs attention' })
      .closest('section')

    expect(within(feed).getByText('COMS3011: 8 h still unfilled')).toBeVisible()
    expect(within(feed).getByRole('link', { name: 'Open staffing requirements' })).toHaveAttribute(
      'href',
      '/organiser/staffing',
    )
    expect(within(feed).getByRole('link', { name: 'Open approval queues' })).toHaveAttribute(
      'href',
      '/organiser/approvals',
    )
  })

  it('says nothing needs attention when the queues are clear', async () => {
    getCommandCentreSummary.mockResolvedValue(
      summaryWith({
        staffing: {
          ...summary.staffing,
          unfilledHours: 0,
          unfilledRequirements: 0,
          requirements: [requirement({ assignedHours: 8, shortageHours: 0, shortageTutors: 0 })],
        },
        actions: { ...summary.actions, pendingTimesheets: 0, total: 0 },
      }),
    )

    await renderLoaded()

    expect(screen.getByText('Nothing needs attention in this period.')).toBeVisible()
    expect(within(kpiCard('Unfilled work')).getByText('0 h')).toBeVisible()
  })

  it('shows the budget position as a sentence, not only a bar', async () => {
    await renderLoaded()

    expect(screen.getByText('R1100.00 of R1500.00 spent, R400.00 left.')).toBeVisible()
  })

  it('shows who is carrying the period and how the work is spread', async () => {
    await renderLoaded()

    const workload = screen
      .getByRole('heading', { name: 'Who is carrying the work' })
      .closest('section')

    expect(within(workload).getByText(/6 h allocated, 4 h approved, 100% of allocated hours/)).toBeVisible()
    expect(within(workload).getByText(/against 40 h capacity/)).toBeVisible()
  })
})
