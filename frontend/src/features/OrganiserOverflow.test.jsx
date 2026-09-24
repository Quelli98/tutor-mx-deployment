import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OrganiserOverflow from './OrganiserOverflow'

const listOrganiserOverflowWork = vi.fn()
const createOrganiserOverflowWork = vi.fn()
const updateOrganiserOverflowWork = vi.fn()
const closeOrganiserOverflowWork = vi.fn()
const listCourses = vi.fn()
const listStaffingRequirements = vi.fn()
const getAccessTokenSilently = vi.fn()

vi.mock('../api/organiserOverflow', () => ({
  listOrganiserOverflowWork: (...args) => listOrganiserOverflowWork(...args),
  createOrganiserOverflowWork: (...args) => createOrganiserOverflowWork(...args),
  updateOrganiserOverflowWork: (...args) => updateOrganiserOverflowWork(...args),
  closeOrganiserOverflowWork: (...args) => closeOrganiserOverflowWork(...args),
}))

vi.mock('../api/organiser', () => ({
  listCourses: (...args) => listCourses(...args),
  listStaffingRequirements: (...args) => listStaffingRequirements(...args),
}))

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently }),
}))

const courses = [{ id: 3, code: 'COMS3011', name: 'Software Design Project' }]

const openWork = {
  id: 4,
  courseId: 3,
  courseCode: 'COMS3011',
  courseName: 'Software Design Project',
  startsAt: '2030-09-04T14:00:00.000Z',
  endsAt: '2030-09-04T18:00:00.000Z',
  hours: 4,
  windowHours: 4,
  status: 'OPEN',
  closesAt: null,
  sourceRequirementId: 12,
  pendingClaims: 0,
  acceptedClaims: 0,
  createdAt: '2026-09-20T09:00:00.000Z',
  updatedAt: '2026-09-23T09:00:00.000Z',
}

const filledWork = {
  ...openWork,
  id: 5,
  status: 'FILLED',
  sourceRequirementId: null,
}

const requirement = {
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
  notes: null,
  createdById: 8,
  createdAt: '2026-09-21T09:00:00.000Z',
  updatedAt: '2026-09-21T09:00:00.000Z',
}

function errorWithCode(code, message = 'raw server detail') {
  const error = new Error(message)
  error.code = code
  return error
}

function renderPage() {
  render(
    <MemoryRouter>
      <OrganiserOverflow />
    </MemoryRouter>,
  )
}

const listTable = () =>
  screen.findByRole('table', { name: /student volunteer opportunities/i })
const unmetTable = () => screen.findByRole('table', { name: /still unfilled/i })

function fillForm() {
  fireEvent.change(screen.getByLabelText(/^course$/i), { target: { value: '3' } })
  fireEvent.change(screen.getByLabelText(/^starts$/i), {
    target: { value: '2030-09-04T14:00' },
  })
  fireEvent.change(screen.getByLabelText(/^ends$/i), {
    target: { value: '2030-09-04T18:00' },
  })
  fireEvent.change(screen.getByLabelText(/^hours$/i), { target: { value: '4' } })
}

describe('OrganiserOverflow', () => {
  beforeEach(() => {
    listOrganiserOverflowWork.mockReset().mockResolvedValue([openWork])
    createOrganiserOverflowWork.mockReset().mockResolvedValue(openWork)
    updateOrganiserOverflowWork.mockReset().mockResolvedValue(openWork)
    closeOrganiserOverflowWork
      .mockReset()
      .mockResolvedValue({ ...openWork, status: 'CLOSED' })
    listCourses.mockReset().mockResolvedValue(courses)
    listStaffingRequirements.mockReset().mockResolvedValue([requirement])
    getAccessTokenSilently.mockReset()
  })

  it('shows a loading state while the lists are in flight', () => {
    listOrganiserOverflowWork.mockReturnValue(new Promise(() => {}))

    renderPage()

    expect(screen.getByRole('heading', { name: /loading overflow work/i })).toBeVisible()
    expect(screen.getByRole('heading', { name: /^overflow work$/i })).toBeVisible()
  })

  it('lists the source, claims and status of every item, open and closed', async () => {
    listOrganiserOverflowWork.mockResolvedValue([
      openWork,
      { ...filledWork, pendingClaims: 1, acceptedClaims: 1 },
    ])

    renderPage()

    const table = await listTable()
    expect(within(table).getByText('Requirement #12')).toBeVisible()
    expect(within(table).getByText('Posted manually')).toBeVisible()
    expect(within(table).getByText('No claims')).toBeVisible()
    expect(within(table).getByText('1 waiting, 1 accepted')).toBeVisible()
    expect(within(table).getByText('Open')).toBeVisible()
    expect(within(table).getByText('Filled')).toBeVisible()
    // The window is shown as readable local times rather than raw ISO text.
    expect(within(table).queryByText(/2030-09-04T14:00:00.000Z/)).not.toBeInTheDocument()
    expect(listOrganiserOverflowWork).toHaveBeenCalledWith(getAccessTokenSilently)
  })

  it('offers only the requirements the server still reports as short', async () => {
    listStaffingRequirements.mockResolvedValue([
      requirement,
      {
        ...requirement,
        id: 13,
        courseCode: 'COMS3009',
        shortageHours: 0,
        shortageTutors: 0,
        assignedHours: 8,
        fillState: 'fully-filled',
      },
    ])

    renderPage()

    const table = await unmetTable()
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(within(table).getByText('3 tutor hours short')).toBeVisible()
    expect(within(table).queryByText('COMS3009')).not.toBeInTheDocument()
    expect(listStaffingRequirements).toHaveBeenCalledWith(
      { status: 'OPEN' },
      getAccessTokenSilently,
    )
  })

  it('prefills the form from an unmet requirement and posts the conversion with its link', async () => {
    renderPage()
    await listTable()

    fireEvent.click(
      screen.getByRole('button', { name: /^send COMS3011 on .* to overflow$/i }),
    )

    expect(screen.getByLabelText(/^course$/i)).toHaveValue('3')
    expect(screen.getByLabelText(/^hours$/i)).toHaveValue(3)
    expect(screen.getByText(/stay fixed to staffing requirement #12/i)).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /^post overflow work$/i }))

    await waitFor(() => {
      expect(createOrganiserOverflowWork).toHaveBeenCalledWith(
        {
          courseId: 3,
          // The requirement's window round-trips through the local
          // datetime-local input, so the same instant is what gets posted.
          startsAt: '2030-09-04T14:00:00.000Z',
          endsAt: '2030-09-04T18:00:00.000Z',
          hours: 3,
          closesAt: null,
          sourceRequirementId: 12,
        },
        getAccessTokenSilently,
      )
    })
    expect(
      await screen.findByText(/was sent to overflow and is now visible to students/i),
    ).toBeVisible()
    expect(listOrganiserOverflowWork).toHaveBeenCalledTimes(2)
  })

  it('posts hand-written work with no source requirement', async () => {
    renderPage()
    await listTable()

    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /^post overflow work$/i }))

    await waitFor(() => {
      expect(createOrganiserOverflowWork).toHaveBeenCalledWith(
        {
          courseId: 3,
          startsAt: new Date('2030-09-04T14:00').toISOString(),
          endsAt: new Date('2030-09-04T18:00').toISOString(),
          hours: 4,
          closesAt: null,
          sourceRequirementId: null,
        },
        getAccessTokenSilently,
      )
    })
    expect(
      await screen.findByText(/was posted and is now visible to students/i),
    ).toBeVisible()
  })

  it('refuses hours longer than the session before any request', async () => {
    renderPage()
    await listTable()

    fillForm()
    fireEvent.change(screen.getByLabelText(/^hours$/i), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: /^post overflow work$/i }))

    expect(
      screen.getByText(/no more than the session length of 4 hours/i),
    ).toBeVisible()
    expect(createOrganiserOverflowWork).not.toHaveBeenCalled()
  })

  it('refuses a window longer than the session before any request', async () => {
    renderPage()
    await listTable()

    fillForm()
    fireEvent.change(screen.getByLabelText(/^ends$/i), {
      target: { value: '2030-09-05T18:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^post overflow work$/i }))

    expect(screen.getByText(/cannot be longer than 8 hours/i)).toBeVisible()
    expect(createOrganiserOverflowWork).not.toHaveBeenCalled()
  })

  it('refuses a claim deadline after the work starts', async () => {
    renderPage()
    await listTable()

    fillForm()
    fireEvent.change(screen.getByLabelText(/claim deadline/i), {
      target: { value: '2030-09-04T15:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^post overflow work$/i }))

    expect(screen.getByText(/at or before the work starts/i)).toBeVisible()
    expect(createOrganiserOverflowWork).not.toHaveBeenCalled()
  })

  it('edits an open item with the version it was shown', async () => {
    renderPage()
    await listTable()

    fireEvent.click(screen.getByRole('button', { name: /^edit COMS3011 on .*$/i }))
    expect(screen.getByRole('heading', { name: /edit COMS3011 overflow work/i })).toBeVisible()

    fireEvent.change(screen.getByLabelText(/^hours$/i), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /^save changes$/i }))

    await waitFor(() => {
      expect(updateOrganiserOverflowWork).toHaveBeenCalledWith(
        {
          overflowWorkId: 4,
          courseId: 3,
          // The row's window round-trips through the local datetime-local
          // input, so the instant the row was shown is the instant sent back.
          startsAt: '2030-09-04T14:00:00.000Z',
          endsAt: '2030-09-04T18:00:00.000Z',
          hours: 2,
          closesAt: null,
          expectedUpdatedAt: '2026-09-23T09:00:00.000Z',
        },
        getAccessTokenSilently,
      )
    })
    expect(await screen.findByText(/overflow work was updated/i)).toBeVisible()
    expect(listOrganiserOverflowWork).toHaveBeenCalledTimes(2)
  })

  it('keeps editing and closing off work that is filled or already claimed', async () => {
    listOrganiserOverflowWork.mockResolvedValue([
      filledWork,
      { ...openWork, id: 6, courseCode: 'COMS3009', pendingClaims: 1 },
    ])

    renderPage()
    await listTable()

    expect(
      screen.getByRole('button', { name: /^edit COMS3011 on .*$/i }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /^edit COMS3009 on .*$/i }),
    ).toBeDisabled()
    // Filled work can still be closed, but not while a claim is waiting.
    expect(screen.getByRole('button', { name: /^close COMS3011 on .*$/i })).toBeEnabled()
    expect(
      screen.getByRole('button', { name: /^close COMS3009 on .*$/i }),
    ).toBeDisabled()
  })

  it('closes open work after confirmation and shows the closed row', async () => {
    renderPage()
    await listTable()

    fireEvent.click(screen.getByRole('button', { name: /^close COMS3011 on .*$/i }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Software Design Project/)).toBeVisible()

    listOrganiserOverflowWork.mockResolvedValue([{ ...openWork, status: 'CLOSED' }])
    fireEvent.click(
      within(dialog).getByRole('button', { name: /^close overflow work$/i }),
    )

    await waitFor(() => {
      expect(closeOrganiserOverflowWork).toHaveBeenCalledWith(
        { overflowWorkId: 4, expectedUpdatedAt: '2026-09-23T09:00:00.000Z' },
        getAccessTokenSilently,
      )
    })
    expect(await screen.findByText(/overflow work is now closed/i)).toBeVisible()
    expect(await screen.findByText('Closed')).toBeVisible()
  })

  it('shows the server wording for a stale edit and reloads every row', async () => {
    renderPage()
    await listTable()

    updateOrganiserOverflowWork.mockRejectedValue(
      errorWithCode(
        'OVERFLOW_WORK_STALE',
        'This overflow work changed in another session. Reload it and try again.',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: /^edit COMS3011 on .*$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^save changes$/i }))

    expect(
      await screen.findByText(/changed in another session\. Reload it and try again\./i),
    ).toBeVisible()
    expect(listOrganiserOverflowWork).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: /^post overflow work$/i })).toBeVisible()
  })

  it('shows the server wording for a close that is overtaken and reloads', async () => {
    renderPage()
    await listTable()

    closeOrganiserOverflowWork.mockRejectedValue(
      errorWithCode(
        'OVERFLOW_WORK_STALE',
        'This overflow work changed in another session. Reload it and try again.',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: /^close COMS3011 on .*$/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: /^close overflow work$/i }),
    )

    expect(
      await screen.findByText(/changed in another session\. Reload it and try again\./i),
    ).toBeVisible()
    expect(listOrganiserOverflowWork).toHaveBeenCalledTimes(2)
  })

  it('shows an error state with a retry when loading fails', async () => {
    listOrganiserOverflowWork.mockRejectedValue(new Error('offline'))

    renderPage()

    expect(
      await screen.findByRole('heading', { name: /overflow work unavailable/i }),
    ).toBeVisible()
    expect(screen.queryByText(/offline/)).not.toBeInTheDocument()

    listOrganiserOverflowWork.mockResolvedValue([openWork])
    fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }))

    expect(await listTable()).toBeVisible()
  })

  it('shows an empty state when there is no overflow work yet', async () => {
    listOrganiserOverflowWork.mockResolvedValue([])

    renderPage()

    expect(
      await screen.findByRole('heading', { name: /no overflow work yet/i }),
    ).toBeVisible()
  })

  it('moves focus to the form heading when an open item is edited', async () => {
    const user = userEvent.setup()

    renderPage()
    await listTable()

    await user.click(
      screen.getByRole('button', { name: /^edit COMS3011 on .*$/i }),
    )

    expect(
      screen.getByRole('heading', { name: /edit COMS3011 overflow work/i }),
    ).toHaveFocus()
  })

  it('moves focus to the form heading when a requirement is sent to overflow', async () => {
    const user = userEvent.setup()

    renderPage()
    await unmetTable()

    await user.click(
      screen.getByRole('button', { name: /^send COMS3011 on .* to overflow$/i }),
    )

    expect(
      screen.getByRole('heading', { name: /send requirement #12 to overflow/i }),
    ).toHaveFocus()
  })

  it('returns focus to the form heading when an edit is cancelled', async () => {
    const user = userEvent.setup()

    renderPage()
    await listTable()

    await user.click(
      screen.getByRole('button', { name: /^edit COMS3011 on .*$/i }),
    )
    await user.click(screen.getByRole('button', { name: /^cancel edit$/i }))

    // The Cancel edit button unmounts with the mode it cancels, so focus
    // returns to the heading of the mode that is left.
    expect(
      screen.getByRole('heading', { name: /^post overflow work$/i }),
    ).toHaveFocus()
  })

  it('moves focus to the first invalid field when the form is submitted empty', async () => {
    const user = userEvent.setup()

    renderPage()
    await listTable()

    await user.click(
      screen.getByRole('button', { name: /^post overflow work$/i }),
    )

    expect(screen.getByLabelText(/^course$/i)).toHaveFocus()
    expect(screen.getByLabelText(/^course$/i)).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByText('Select a course.')).toBeVisible()
    expect(createOrganiserOverflowWork).not.toHaveBeenCalled()
  })

  it('supports the close flow with the keyboard and moves focus to the outcome', async () => {
    const user = userEvent.setup()

    renderPage()
    await listTable()

    const closeButton = screen.getByRole('button', {
      name: /^close COMS3011 on .*$/i,
    })
    closeButton.focus()
    await user.keyboard('{Enter}')

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()

    await user.tab()
    expect(
      within(dialog).getByRole('button', { name: /^close overflow work$/i }),
    ).toHaveFocus()

    listOrganiserOverflowWork.mockResolvedValue([{ ...openWork, status: 'CLOSED' }])
    await user.keyboard('{Enter}')

    const successMessage = await screen.findByText(/overflow work is now closed/i)
    expect(closeOrganiserOverflowWork).toHaveBeenCalledTimes(1)

    // The closed row loses its Close action, so focus lands on the outcome
    // message instead of the page body.
    await waitFor(() => {
      expect(successMessage).toHaveFocus()
    })
  })

  it('moves focus to the error when a failed close leaves no button behind', async () => {
    const user = userEvent.setup()

    listOrganiserOverflowWork
      .mockResolvedValueOnce([openWork])
      .mockResolvedValue([{ ...openWork, status: 'CLOSED' }])

    renderPage()
    await listTable()

    closeOrganiserOverflowWork.mockRejectedValue(
      errorWithCode(
        'OVERFLOW_WORK_STALE',
        'This overflow work changed in another session. Reload it and try again.',
      ),
    )

    await user.click(
      screen.getByRole('button', { name: /^close COMS3011 on .*$/i }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', { name: /^close overflow work$/i }),
    )

    const errorMessage = await screen.findByText(
      /changed in another session\. Reload it and try again\./i,
    )

    // The reloaded row is closed, so the button that opened the dialog is
    // gone and the refusal takes focus instead.
    await waitFor(() => {
      expect(errorMessage).toHaveFocus()
    })
  })

  it('keeps focus on the Close button when a refused close leaves the row in place', async () => {
    const user = userEvent.setup()

    closeOrganiserOverflowWork.mockRejectedValue(new Error('offline'))

    renderPage()
    await listTable()

    const closeButton = screen.getByRole('button', {
      name: /^close COMS3011 on .*$/i,
    })
    await user.click(closeButton)
    const dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', { name: /^close overflow work$/i }),
    )

    expect(await screen.findByText(/could not be closed safely/i)).toBeVisible()

    await waitFor(() => {
      expect(closeButton).toHaveFocus()
    })
  })
})
