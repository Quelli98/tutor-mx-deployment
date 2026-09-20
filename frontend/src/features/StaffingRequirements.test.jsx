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
    // Both the number the organiser entered and the total derived by the server.
    expect(within(table).getAllByText('2')).toHaveLength(2)
    expect(within(table).getAllByText('8')).toHaveLength(2)
    expect(within(table).getAllByText(/4 hours x 2 tutors/)).toHaveLength(2)
    expect(within(table).getByText('Open')).toBeVisible()
    expect(within(table).getByText('Closed')).toBeVisible()
    // The window is shown as readable local times rather than raw ISO text.
    expect(within(table).queryByText(/2030-09-04T14:00:00.000Z/)).not.toBeInTheDocument()
    expect(listStaffingRequirements).toHaveBeenCalledWith({}, getAccessTokenSilently)
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
