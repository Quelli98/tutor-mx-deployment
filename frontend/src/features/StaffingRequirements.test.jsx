import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StaffingRequirements from './StaffingRequirements'

const listStaffingRequirements = vi.fn()
const createStaffingRequirement = vi.fn()
const updateStaffingRequirement = vi.fn()
const setStaffingRequirementStatus = vi.fn()
const listCourses = vi.fn()
const getAccessTokenSilently = vi.fn()

vi.mock('../api/organiser', () => ({
  listStaffingRequirements: (...args) => listStaffingRequirements(...args),
  createStaffingRequirement: (...args) => createStaffingRequirement(...args),
  updateStaffingRequirement: (...args) => updateStaffingRequirement(...args),
  setStaffingRequirementStatus: (...args) => setStaffingRequirementStatus(...args),
  listCourses: (...args) => listCourses(...args),
}))

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently }),
}))

const courses = [
  { id: 3, code: 'COMS3011', name: 'Software Design Project' },
  { id: 4, code: 'COMS3009', name: 'Software Engineering' },
]

const openRequirement = {
  id: 12,
  courseId: 3,
  courseCode: 'COMS3011',
  courseName: 'Software Design Project',
  startsAt: '2030-09-04T14:00:00.000Z',
  endsAt: '2030-09-04T18:00:00.000Z',
  tutorsNeeded: 2,
  windowHours: 4,
  requiredHours: 8,
  assignedHours: 5,
  shortageHours: 3,
  shortageTutors: 1,
  fillState: 'partially-filled',
  status: 'OPEN',
  notes: 'Lab cover',
  createdById: 8,
  createdAt: '2026-09-21T09:00:00.000Z',
  updatedAt: '2026-09-21T09:00:00.000Z',
}

const closedRequirement = {
  ...openRequirement,
  id: 13,
  status: 'CLOSED',
  notes: null,
  // A closed requirement keeps what is assigned but has no shortage.
  shortageHours: 0,
  shortageTutors: 0,
  fillState: 'not-being-filled',
}

function errorWithCode(code, message = 'raw server detail') {
  const error = new Error(message)
  error.code = code
  return error
}

function renderPage() {
  render(
    <MemoryRouter>
      <StaffingRequirements />
    </MemoryRouter>,
  )
}

function fillForm() {
  fireEvent.change(screen.getByLabelText(/^course$/i), { target: { value: '3' } })
  fireEvent.change(screen.getByLabelText(/^starts$/i), {
    target: { value: '2030-09-04T14:00' },
  })
  fireEvent.change(screen.getByLabelText(/^ends$/i), {
    target: { value: '2030-09-04T18:00' },
  })
  fireEvent.change(screen.getByLabelText(/tutors needed/i), { target: { value: '2' } })
}

describe('StaffingRequirements', () => {
  beforeEach(() => {
    listStaffingRequirements.mockReset().mockResolvedValue([openRequirement])
    createStaffingRequirement.mockReset().mockResolvedValue(openRequirement)
    updateStaffingRequirement.mockReset().mockResolvedValue(openRequirement)
    setStaffingRequirementStatus.mockReset().mockResolvedValue(closedRequirement)
    listCourses.mockReset().mockResolvedValue(courses)
    getAccessTokenSilently.mockReset()
  })

  it('shows a loading state while the list is in flight', () => {
    listStaffingRequirements.mockReturnValue(new Promise(() => {}))

    renderPage()

    expect(screen.getByRole('heading', { name: /loading staffing requirements/i })).toBeVisible()
    expect(screen.getByRole('heading', { name: /^staffing requirements$/i })).toBeVisible()
  })

  it('lists the course, window, hours and status of each requirement', async () => {
    listStaffingRequirements.mockResolvedValue([openRequirement, closedRequirement])

    renderPage()

    const table = await screen.findByRole('table')
    expect(within(table).getAllByText('COMS3011')).toHaveLength(2)
    expect(within(table).getByRole('columnheader', { name: /tutor hours/i })).toBeVisible()
    // Both the number the organiser entered and the total derived by the server,
    // with the total named so it cannot read as the length of the session.
    const cellText = (index) =>
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[index].textContent)
    expect(cellText(2)).toEqual(['2', '2'])
    expect(cellText(3)).toEqual([
      '8 tutor hours4 hours x 2 tutors',
      '8 tutor hours4 hours x 2 tutors',
    ])
    expect(within(table).getByText('Open')).toBeVisible()
    expect(within(table).getByText('Closed')).toBeVisible()
    // The window is shown as readable local times rather than raw ISO text.
    expect(within(table).queryByText(/2030-09-04T14:00:00.000Z/)).not.toBeInTheDocument()
    expect(listStaffingRequirements).toHaveBeenCalledWith({}, getAccessTokenSilently)
  })

  it.each([
    [
      'nothing assigned',
      { assignedHours: 0, shortageHours: 8, shortageTutors: 2, fillState: 'unfilled' },
      '8 tutor hours short',
      'Nothing assigned yet, 2 more tutors needed',
    ],
    [
      'part of it assigned',
      { assignedHours: 5, shortageHours: 3, shortageTutors: 1, fillState: 'partially-filled' },
      '3 tutor hours short',
      '5 of 8 tutor hours assigned, 1 more tutor needed',
    ],
    [
      'fully covered',
      { assignedHours: 8, shortageHours: 0, shortageTutors: 0, fillState: 'fully-filled' },
      'Fully filled',
      '8 of 8 tutor hours assigned',
    ],
    [
      'closed',
      { status: 'CLOSED', shortageHours: 0, shortageTutors: 0, fillState: 'not-being-filled' },
      'Not being filled',
      'Closed or cancelled, so nothing is being sought',
    ],
  ])('shows the shortage in words when %s', async (_label, overrides, headline, detail) => {
    listStaffingRequirements.mockResolvedValue([{ ...openRequirement, ...overrides }])

    renderPage()
    const table = await screen.findByRole('table')

    // The words carry the meaning, so the column works without colour.
    expect(within(table).getByText(headline)).toBeVisible()
    expect(within(table).getByText(new RegExp(detail))).toBeVisible()
  })

  it('never asks for another tutor over a rounding difference', async () => {
    // The server settles this; the screen must not invent a shortage from the
    // numbers it is given.
    listStaffingRequirements.mockResolvedValue([
      {
        ...openRequirement,
        windowHours: 0.33,
        requiredHours: 0.33,
        assignedHours: 0.32,
        shortageHours: 0,
        shortageTutors: 0,
        fillState: 'fully-filled',
      },
    ])

    renderPage()
    const table = await screen.findByRole('table')

    expect(within(table).getByText('Fully filled')).toBeVisible()
    expect(within(table).queryByText(/tutor hours short/)).not.toBeInTheDocument()
    expect(within(table).queryByText(/more tutor/)).not.toBeInTheDocument()
  })

  it('keeps every row a real table row, one cell per column', async () => {
    listStaffingRequirements.mockResolvedValue([openRequirement, closedRequirement])

    renderPage()
    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row')
    const headerCount = within(rows[0]).getAllByRole('columnheader').length

    for (const row of rows.slice(1)) {
      expect(within(row).getAllByRole('cell')).toHaveLength(headerCount)
    }

    // A <td> with display:grid stops being a table cell, and two adjacent ones
    // merge into one anonymous cell, shifting every later column left. jsdom
    // does no layout and cannot see that, so the rule is guarded structurally:
    // the grid belongs on a wrapper inside the cell.
    expect(table.querySelectorAll('td.table-cell-stack')).toHaveLength(0)
    expect(table.querySelectorAll('td > .table-cell-stack').length).toBeGreaterThan(0)
  })

  it('keeps row buttons short on screen but fully described for screen readers', async () => {
    renderPage()
    const table = await screen.findByRole('table')

    // The accessible name still identifies the row, so the buttons are
    // distinguishable out of context, while the visible text stays compact.
    for (const [visible, accessible] of [
      ['Edit', /^edit COMS3011 on /i],
      ['Close', /^close COMS3011 on /i],
      ['Cancel', /^cancel COMS3011 on /i],
    ]) {
      const button = within(table).getByRole('button', { name: accessible })
      expect(button).toHaveTextContent(new RegExp(`^${visible}$`))
    }
  })

  it('explains a failure and retries the load', async () => {
    listStaffingRequirements.mockRejectedValueOnce(errorWithCode('REQUEST_FAILED'))

    renderPage()

    expect(
      await screen.findByRole('heading', { name: /staffing requirements unavailable/i }),
    ).toBeVisible()
    expect(screen.getByText(/could not be loaded safely/i)).toBeVisible()
    expect(screen.queryByText(/raw server detail/i)).not.toBeInTheDocument()

    listStaffingRequirements.mockResolvedValueOnce([openRequirement])
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    expect(await screen.findByRole('table')).toBeVisible()
  })

  it('shows an empty state when nothing has been recorded', async () => {
    listStaffingRequirements.mockResolvedValue([])

    renderPage()

    expect(
      await screen.findByRole('heading', { name: /no staffing requirements yet/i }),
    ).toBeVisible()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('adds a requirement and reloads the list', async () => {
    renderPage()
    await screen.findByRole('table')

    fillForm()
    fireEvent.change(screen.getByLabelText(/notes/i), { target: { value: ' Lab cover ' } })
    fireEvent.click(screen.getByRole('button', { name: /^add requirement$/i }))

    await waitFor(() => {
      expect(createStaffingRequirement).toHaveBeenCalledWith(
        {
          courseId: 3,
          startsAt: new Date('2030-09-04T14:00').toISOString(),
          endsAt: new Date('2030-09-04T18:00').toISOString(),
          tutorsNeeded: 2,
          notes: 'Lab cover',
        },
        getAccessTokenSilently,
      )
    })
    expect(await screen.findByText(/staffing requirement was added/i)).toBeVisible()
    expect(listStaffingRequirements).toHaveBeenCalledTimes(2)
  })

  it('sends no notes value when the box is left empty', async () => {
    renderPage()
    await screen.findByRole('table')

    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /^add requirement$/i }))

    await waitFor(() => expect(createStaffingRequirement).toHaveBeenCalled())
    expect(createStaffingRequirement.mock.calls[0][0].notes).toBeNull()
  })

  it.each([
    ['course', /^course$/i, /select a course/i],
    ['start time', /^starts$/i, /choose when the work starts/i],
    ['end time', /^ends$/i, /choose when the work ends/i],
    ['tutor count', /tutors needed/i, /enter how many tutors are needed/i],
  ])('blocks a missing %s and sends no request', async (_field, label, message) => {
    renderPage()
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: /^add requirement$/i }))

    // Checked through the field's own description, so each message is tied to
    // the input a screen reader would announce it with.
    await waitFor(() =>
      expect(screen.getByLabelText(label)).toHaveAccessibleDescription(message),
    )
    expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true')
    expect(createStaffingRequirement).not.toHaveBeenCalled()
  })

  it('blocks a requirement that spans days before any request is sent', async () => {
    renderPage()
    await screen.findByRole('table')

    fillForm()
    // The shape the real fault took: the start a month behind the end.
    fireEvent.change(screen.getByLabelText(/^starts$/i), {
      target: { value: '2026-09-01T10:27' },
    })
    fireEvent.change(screen.getByLabelText(/^ends$/i), {
      target: { value: '2026-10-01T12:27' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^add requirement$/i }))

    await waitFor(() =>
      expect(screen.getByLabelText(/^ends$/i)).toHaveAccessibleDescription(
        'A session cannot be longer than 8 hours. This one is 722 hours. Check the start and end dates.',
      ),
    )
    // Required hours are window x tutorsNeeded, so this would have been
    // recorded as 1,444 hours short.
    expect(createStaffingRequirement).not.toHaveBeenCalled()
  })

  it('allows a requirement of exactly the maximum length', async () => {
    renderPage()
    await screen.findByRole('table')

    fillForm()
    fireEvent.change(screen.getByLabelText(/^starts$/i), {
      target: { value: '2030-09-04T09:00' },
    })
    fireEvent.change(screen.getByLabelText(/^ends$/i), {
      target: { value: '2030-09-04T17:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^add requirement$/i }))

    await waitFor(() => expect(createStaffingRequirement).toHaveBeenCalled())
  })

  it('leaves an end before the start to the server, as before', async () => {
    renderPage()
    await screen.findByRole('table')

    fillForm()
    fireEvent.change(screen.getByLabelText(/^ends$/i), {
      target: { value: '2030-09-04T13:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^add requirement$/i }))

    // Only the window-length rule moved to the screen; every other value rule
    // still belongs to the server.
    await waitFor(() => expect(createStaffingRequirement).toHaveBeenCalled())
  })

  it('shows the server refusal when it rejects the values', async () => {
    createStaffingRequirement.mockRejectedValue(
      errorWithCode(
        'VALIDATION_ERROR',
        'Enter a valid course, an end time later than the start, a whole number of tutors from 1 to 20, and optional notes.',
      ),
    )

    renderPage()
    await screen.findByRole('table')
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /^add requirement$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /an end time later than the start/i,
    )
  })

  it('edits an existing requirement', async () => {
    renderPage()
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: /^edit COMS3011/i }))
    expect(screen.getByRole('heading', { name: /edit COMS3011 requirement/i })).toBeVisible()
    expect(screen.getByLabelText(/^course$/i)).toHaveValue('3')
    expect(screen.getByLabelText(/tutors needed/i)).toHaveValue(2)
    expect(screen.getByLabelText(/notes/i)).toHaveValue('Lab cover')

    fireEvent.change(screen.getByLabelText(/tutors needed/i), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(updateStaffingRequirement).toHaveBeenCalledWith(
        expect.objectContaining({ requirementId: 12, tutorsNeeded: 3 }),
        getAccessTokenSilently,
      )
    })
    expect(await screen.findByText(/staffing requirement was updated/i)).toBeVisible()
  })

  it('leaves the edit form when the edit is cancelled', async () => {
    renderPage()
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: /^edit COMS3011/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel edit/i }))

    expect(screen.getByRole('heading', { name: /add a staffing requirement/i })).toBeVisible()
    expect(screen.getByLabelText(/^course$/i)).toHaveValue('')
    expect(updateStaffingRequirement).not.toHaveBeenCalled()
  })

  it.each([
    ['Close', 'CLOSED'],
    ['Cancel', 'CANCELLED'],
  ])('%ss an open requirement after confirmation', async (label, status) => {
    renderPage()
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label} COMS3011`, 'i') }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Software Design Project/)).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: new RegExp(`${label} requirement`, 'i') }))

    await waitFor(() => {
      expect(setStaffingRequirementStatus).toHaveBeenCalledWith(
        { requirementId: 12, status },
        getAccessTokenSilently,
      )
    })
    expect(listStaffingRequirements).toHaveBeenCalledTimes(2)
  })

  it('does not offer to reopen a closed session whose date has already passed', async () => {
    listStaffingRequirements.mockResolvedValue([{
      ...closedRequirement,
      startsAt: '2020-09-04T14:00:00.000Z',
      endsAt: '2020-09-04T18:00:00.000Z',
    }])

    renderPage()
    await screen.findByRole('table')

    expect(screen.queryByRole('button', { name: /^reopen COMS3011/i })).not.toBeInTheDocument()
  })

  it('reopens a closed requirement and offers no close action for it', async () => {
    listStaffingRequirements.mockResolvedValue([closedRequirement])
    setStaffingRequirementStatus.mockResolvedValue(openRequirement)

    renderPage()
    await screen.findByRole('table')

    expect(screen.queryByRole('button', { name: /^close COMS3011/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^reopen COMS3011/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /reopen requirement/i }))

    await waitFor(() => {
      expect(setStaffingRequirementStatus).toHaveBeenCalledWith(
        { requirementId: 13, status: 'OPEN' },
        getAccessTokenSilently,
      )
    })
  })

  it('sends no request when a status change is cancelled', async () => {
    renderPage()
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: /^close COMS3011/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^cancel$/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(setStaffingRequirementStatus).not.toHaveBeenCalled()
  })

  it('shows the server message when someone else already changed the status', async () => {
    setStaffingRequirementStatus.mockRejectedValue(
      errorWithCode(
        'STAFFING_REQUIREMENT_CONFLICT',
        'This staffing requirement is already closed.',
      ),
    )

    renderPage()
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: /^close COMS3011/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /close requirement/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/already closed/i)
  })

  it.each([
    ['a course', { courseId: '3' }, { courseId: 3 }],
    ['a status', { status: 'CLOSED' }, { status: 'CLOSED' }],
    ['both', { courseId: '4', status: 'OPEN' }, { courseId: 4, status: 'OPEN' }],
  ])('asks the server to filter by %s', async (_label, chosen, expected) => {
    renderPage()
    await screen.findByRole('table')

    if (chosen.courseId) {
      fireEvent.change(screen.getByLabelText(/filter by course/i), {
        target: { value: chosen.courseId },
      })
    }
    if (chosen.status) {
      fireEvent.change(screen.getByLabelText(/filter by status/i), {
        target: { value: chosen.status },
      })
    }
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }))

    await waitFor(() => {
      expect(listStaffingRequirements).toHaveBeenLastCalledWith(expected, getAccessTokenSilently)
    })
  })

  it('explains when filters match nothing, keeping the filters on screen', async () => {
    renderPage()
    await screen.findByRole('table')

    listStaffingRequirements.mockResolvedValueOnce([])
    fireEvent.change(screen.getByLabelText(/filter by status/i), { target: { value: 'CANCELLED' } })
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }))

    expect(await screen.findByText(/no staffing requirements match these filters/i)).toBeVisible()
    expect(screen.queryByRole('heading', { name: /no staffing requirements yet/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /clear filters/i })).toBeVisible()
  })

  it('clears the filters and reloads the full list', async () => {
    renderPage()
    await screen.findByRole('table')

    fireEvent.change(screen.getByLabelText(/filter by status/i), { target: { value: 'CLOSED' } })
    fireEvent.click(screen.getByRole('button', { name: /apply filters/i }))
    await waitFor(() =>
      expect(listStaffingRequirements).toHaveBeenLastCalledWith(
        { status: 'CLOSED' },
        getAccessTokenSilently,
      ),
    )

    fireEvent.click(await screen.findByRole('button', { name: /clear filters/i }))

    await waitFor(() =>
      expect(listStaffingRequirements).toHaveBeenLastCalledWith({}, getAccessTokenSilently),
    )
    expect(screen.getByLabelText(/filter by status/i)).toHaveValue('')
  })

  it('reaches the form fields and the table by keyboard alone', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('table')

    const courseSelect = screen.getByLabelText(/^course$/i)
    courseSelect.focus()
    expect(courseSelect).toHaveFocus()

    await user.tab()
    expect(screen.getByLabelText(/^starts$/i)).toHaveFocus()
    await user.tab()
    expect(screen.getByLabelText(/^ends$/i)).toHaveFocus()
    await user.tab()
    expect(screen.getByLabelText(/tutors needed/i)).toHaveFocus()
    await user.tab()
    expect(screen.getByLabelText(/notes/i)).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: /^add requirement$/i })).toHaveFocus()

    // The table scrolls sideways at narrow widths, so it must be focusable too.
    expect(
      screen.getByLabelText(/staffing requirement table/i),
    ).toHaveAttribute('tabindex', '0')
  })
})
