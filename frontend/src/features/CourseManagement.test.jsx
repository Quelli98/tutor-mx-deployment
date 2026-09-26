import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CourseManagement from './CourseManagement'

const listCourses = vi.fn()
const createCourse = vi.fn()
const updateCourse = vi.fn()
const deleteCourse = vi.fn()
const getAccessTokenSilently = vi.fn()

vi.mock('../api/organiser', () => ({
  listCourses: (...args) => listCourses(...args),
  createCourse: (...args) => createCourse(...args),
  updateCourse: (...args) => updateCourse(...args),
  deleteCourse: (...args) => deleteCourse(...args),
}))

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently }),
}))

const courses = [
  { id: 1, code: 'DEMO101', name: 'Demo Course', hourlyRate: null, budget: null },
  { id: 2, code: 'COMS3011', name: 'Software Design Project', hourlyRate: 30, budget: 5000 },
]

function renderPage(entry = '/organiser/courses') {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/organiser/courses" element={<CourseManagement />} />
        <Route path="/organiser/courses/:courseId" element={<CourseManagement />} />
      </Routes>
    </MemoryRouter>,
  )
}

function errorWithCode(code) {
  const error = new Error('raw server detail')
  error.code = code
  return error
}

describe('CourseManagement', () => {
  beforeEach(() => {
    listCourses.mockReset()
    createCourse.mockReset()
    updateCourse.mockReset()
    deleteCourse.mockReset()
    getAccessTokenSilently.mockReset()
  })

  it('shows a loading state while the course list is in flight', () => {
    listCourses.mockReturnValue(new Promise(() => {}))

    renderPage()

    expect(screen.getByRole('heading', { name: /loading courses/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /course management/i })).toBeInTheDocument()
  })

  it('renders the returned courses as cards', async () => {
    listCourses.mockResolvedValue(courses)

    renderPage()

    const table = await screen.findByRole('list', { name: /courses currently set up/i })
    expect(within(table).getByText('DEMO101')).toBeInTheDocument()
    expect(within(table).getByText('Demo Course')).toBeInTheDocument()
    expect(within(table).getByText('COMS3011')).toBeInTheDocument()
    expect(within(table).getByText('Software Design Project')).toBeInTheDocument()
    expect(listCourses).toHaveBeenCalledWith(getAccessTokenSilently)
  })

  it('shows an empty state when no courses are set up', async () => {
    listCourses.mockResolvedValue([])

    renderPage()

    expect(await screen.findByRole('heading', { name: /no courses yet/i })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /courses currently set up/i })).not.toBeInTheDocument()
  })

  it('shows a safe generic message and retries the load', async () => {
    listCourses.mockRejectedValueOnce(errorWithCode('REQUEST_FAILED'))

    renderPage()

    expect(await screen.findByRole('heading', { name: /courses unavailable/i })).toBeInTheDocument()
    expect(screen.getByText(/courses could not be loaded safely/i)).toBeInTheDocument()
    expect(screen.queryByText(/raw server detail/i)).not.toBeInTheDocument()

    listCourses.mockResolvedValueOnce(courses)
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    await waitFor(() => {
      expect(listCourses).toHaveBeenCalledTimes(2)
    })
    expect(await screen.findByRole('list', { name: /courses currently set up/i })).toBeInTheDocument()
  })

  it('explains a missing organiser profile', async () => {
    listCourses.mockRejectedValue(errorWithCode('PROFILE_NOT_FOUND'))

    renderPage()

    expect(
      await screen.findByText(/could not find your organiser profile/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/raw server detail/i)).not.toBeInTheDocument()
  })

  it('explains a role mismatch', async () => {
    listCourses.mockRejectedValue(errorWithCode('ROLE_MISMATCH'))

    renderPage()

    expect(
      await screen.findByText(/does not have organiser access/i),
    ).toBeInTheDocument()
  })
})

describe('CourseManagement create, edit and delete', () => {
  beforeEach(() => {
    listCourses.mockReset()
    createCourse.mockReset()
    updateCourse.mockReset()
    deleteCourse.mockReset()
    getAccessTokenSilently.mockReset()
  })

  it('sends a trimmed create payload and refreshes the list', async () => {
    listCourses.mockResolvedValue(courses)
    createCourse.mockResolvedValue({ id: 3, code: 'NEW100', name: 'New Course' })

    renderPage()
    await screen.findByRole('list', { name: /courses currently set up/i })

    fireEvent.change(screen.getByLabelText(/course code/i), { target: { value: '  NEW100  ' } })
    fireEvent.change(screen.getByLabelText(/course name/i), { target: { value: '  New Course  ' } })
    fireEvent.click(screen.getByRole('button', { name: /^add course$/i }))

    await waitFor(() => {
      expect(createCourse).toHaveBeenCalledWith(
        // Blank money fields are sent as null, which the server reads as "not
        // set", rather than being left out.
        { code: 'NEW100', name: 'New Course', hourlyRate: null, budget: null },
        getAccessTokenSilently,
      )
    })
    await waitFor(() => {
      expect(listCourses).toHaveBeenCalledTimes(2)
    })
    expect(await screen.findByText(/NEW100 was added/i)).toBeInTheDocument()
  })

  it('blocks an empty course code and sends no request', async () => {
    listCourses.mockResolvedValue(courses)

    renderPage()
    await screen.findByRole('list', { name: /courses currently set up/i })

    fireEvent.change(screen.getByLabelText(/course code/i), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText(/course name/i), { target: { value: 'New Course' } })
    fireEvent.click(screen.getByRole('button', { name: /^add course$/i }))

    expect(screen.getByLabelText(/course code/i)).toHaveAccessibleDescription(
      /enter a course code/i,
    )
    expect(createCourse).not.toHaveBeenCalled()
    expect(listCourses).toHaveBeenCalledTimes(1)
  })

  it('blocks an over-length course name and sends no request', async () => {
    listCourses.mockResolvedValue(courses)

    renderPage()
    await screen.findByRole('list', { name: /courses currently set up/i })

    fireEvent.change(screen.getByLabelText(/course code/i), { target: { value: 'NEW100' } })
    fireEvent.change(screen.getByLabelText(/course name/i), { target: { value: 'x'.repeat(121) } })
    fireEvent.click(screen.getByRole('button', { name: /^add course$/i }))

    expect(screen.getByLabelText(/course name/i)).toHaveAccessibleDescription(
      /120 characters or fewer/i,
    )
    expect(createCourse).not.toHaveBeenCalled()
  })

  it('pre-fills both fields when editing and updates with both of them', async () => {
    listCourses.mockResolvedValue(courses)
    updateCourse.mockResolvedValue({ id: 1, code: 'DEMO101', name: 'Renamed Course' })

    renderPage()
    await screen.findByRole('list', { name: /courses currently set up/i })

    fireEvent.click(screen.getByRole('button', { name: /edit DEMO101/i }))

    expect(screen.getByLabelText(/course code/i)).toHaveValue('DEMO101')
    expect(screen.getByLabelText(/course name/i)).toHaveValue('Demo Course')

    fireEvent.change(screen.getByLabelText(/course name/i), {
      target: { value: 'Renamed Course' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(updateCourse).toHaveBeenCalledWith(
        { courseId: 1, code: 'DEMO101', name: 'Renamed Course', hourlyRate: null, budget: null },
        getAccessTokenSilently,
      )
    })
    await waitFor(() => {
      expect(listCourses).toHaveBeenCalledTimes(2)
    })
  })

  it('deletes a course after confirmation and reloads the list', async () => {
    listCourses.mockResolvedValue(courses)
    deleteCourse.mockResolvedValue(undefined)

    renderPage()
    await screen.findByRole('list', { name: /courses currently set up/i })

    fireEvent.click(screen.getByRole('button', { name: /delete DEMO101/i }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/DEMO101 - Demo Course/i)).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: /^delete course$/i }))

    await waitFor(() => {
      expect(deleteCourse).toHaveBeenCalledWith({ courseId: 1 }, getAccessTokenSilently)
    })
    await waitFor(() => {
      expect(listCourses).toHaveBeenCalledTimes(2)
    })
    expect(await screen.findByText(/DEMO101 was deleted/i)).toBeInTheDocument()
  })

  it('sends no request when the delete is cancelled', async () => {
    listCourses.mockResolvedValue(courses)

    renderPage()
    await screen.findByRole('list', { name: /courses currently set up/i })

    fireEvent.click(screen.getByRole('button', { name: /delete DEMO101/i }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(deleteCourse).not.toHaveBeenCalled()
    expect(listCourses).toHaveBeenCalledTimes(1)
  })

  it('shows the pending state in the dialog while the delete is in flight', async () => {
    listCourses.mockResolvedValue(courses)

    let resolveDelete
    deleteCourse.mockReturnValue(
      new Promise((resolve) => {
        resolveDelete = resolve
      }),
    )

    renderPage()
    await screen.findByRole('list', { name: /courses currently set up/i })

    fireEvent.click(screen.getByRole('button', { name: /delete DEMO101/i }))
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: /^delete course$/i,
      }),
    )

    const pendingDialog = await screen.findByRole('dialog')
    const confirmButton = await within(pendingDialog).findByRole('button', {
      name: /confirming/i,
    })
    expect(confirmButton).toBeDisabled()
    expect(within(pendingDialog).getByRole('button', { name: /cancel/i })).toBeDisabled()

    resolveDelete()

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(deleteCourse).toHaveBeenCalledTimes(1)
  })

  it('shows a friendly message for a duplicate course code', async () => {
    listCourses.mockResolvedValue(courses)
    createCourse.mockRejectedValue(errorWithCode('COURSE_CODE_CONFLICT'))

    renderPage()
    await screen.findByRole('list', { name: /courses currently set up/i })

    fireEvent.change(screen.getByLabelText(/course code/i), { target: { value: 'DEMO101' } })
    fireEvent.change(screen.getByLabelText(/course name/i), { target: { value: 'Duplicate' } })
    fireEvent.click(screen.getByRole('button', { name: /^add course$/i }))

    expect(
      await screen.findByText(/that course code is already in use/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/raw server detail/i)).not.toBeInTheDocument()
  })

  it('shows the safe conflict explanation when a delete is blocked', async () => {
    listCourses.mockResolvedValue(courses)
    const conflict = new Error('raw server detail')
    conflict.code = 'COURSE_DELETE_CONFLICT'
    conflict.message =
      'This course still has confirmed allocations and logged work that must remain auditable, so it cannot be deleted. Cancel or reassign that work first.'
    deleteCourse.mockRejectedValueOnce(conflict)

    renderPage()
    await screen.findByRole('list', { name: /courses currently set up/i })

    fireEvent.click(screen.getByRole('button', { name: /delete DEMO101/i }))
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: /^delete course$/i,
      }),
    )

    expect(await screen.findByText(/must remain auditable/i)).toBeInTheDocument()
    // The dialog closes and no success is claimed for a blocked delete.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(screen.queryByText(/was deleted/i)).not.toBeInTheDocument()
    expect(deleteCourse).toHaveBeenCalledTimes(1)
  })

  it('ignores repeated confirm clicks and deletes only once', async () => {
    listCourses.mockResolvedValue(courses)

    let resolveDelete
    deleteCourse.mockReturnValue(
      new Promise((resolve) => {
        resolveDelete = resolve
      }),
    )

    renderPage()
    await screen.findByRole('list', { name: /courses currently set up/i })

    fireEvent.click(screen.getByRole('button', { name: /delete DEMO101/i }))
    const dialog = await screen.findByRole('dialog')
    const confirmButton = within(dialog).getByRole('button', { name: /^delete course$/i })

    // Rapidly click the confirm button several times while the request is in flight.
    fireEvent.click(confirmButton)
    fireEvent.click(confirmButton)
    fireEvent.click(confirmButton)

    expect(deleteCourse).toHaveBeenCalledTimes(1)

    resolveDelete(undefined)
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})

describe('CourseManagement money fields', () => {
  beforeEach(() => {
    listCourses.mockReset().mockResolvedValue(courses)
    createCourse.mockReset().mockResolvedValue({ id: 3, code: 'NEW100', name: 'New Course' })
    updateCourse.mockReset().mockResolvedValue({ id: 2, code: 'COMS3011', name: 'Software Design Project' })
    deleteCourse.mockReset()
    getAccessTokenSilently.mockReset()
  })

  it('shows the rate and budget, and says when they are not set', async () => {
    renderPage()
    const cards = within(await screen.findByRole('list', { name: /courses currently set up/i })).getAllByRole('listitem')
    const figure = (card, label) => within(card).getByText(label).nextElementSibling

    expect(figure(cards[0], 'Hourly rate')).toHaveTextContent('Not set')
    expect(figure(cards[1], 'Hourly rate')).toHaveTextContent('R30.00')
    expect(figure(cards[1], 'Budget')).toHaveTextContent('R5000.00')
  })

  it('sends the rate and budget entered on a new course', async () => {
    renderPage()
    await screen.findByRole('list', { name: /courses currently set up/i })

    fireEvent.change(screen.getByLabelText(/course code/i), { target: { value: 'NEW100' } })
    fireEvent.change(screen.getByLabelText(/course name/i), { target: { value: 'New Course' } })
    fireEvent.change(screen.getByLabelText(/hourly rate/i), { target: { value: '42.50' } })
    fireEvent.change(screen.getByLabelText(/budget/i), { target: { value: '1200' } })
    fireEvent.click(screen.getByRole('button', { name: /^add course$/i }))

    await waitFor(() =>
      expect(createCourse).toHaveBeenCalledWith(
        { code: 'NEW100', name: 'New Course', hourlyRate: 42.5, budget: 1200 },
        getAccessTokenSilently,
      ),
    )
  })

  it('pre-fills the stored money when editing and clears it when emptied', async () => {
    renderPage()
    await screen.findByRole('list', { name: /courses currently set up/i })

    fireEvent.click(screen.getByRole('button', { name: /edit COMS3011/i }))
    expect(screen.getByLabelText(/hourly rate/i)).toHaveValue(30)
    expect(screen.getByLabelText(/budget/i)).toHaveValue(5000)

    fireEvent.change(screen.getByLabelText(/budget/i), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(updateCourse).toHaveBeenCalledWith(
        {
          courseId: 2,
          code: 'COMS3011',
          name: 'Software Design Project',
          hourlyRate: 30,
          // An emptied field clears the stored budget rather than leaving it.
          budget: null,
        },
        getAccessTokenSilently,
      ),
    )
  })

  it('shows what the server refused rather than deciding the rule itself', async () => {
    createCourse.mockRejectedValue(
      Object.assign(new Error('Enter a valid course code and name, an hourly rate above 0, and a budget of 0 or more.'), {
        code: 'VALIDATION_ERROR',
      }),
    )

    renderPage()
    await screen.findByRole('list', { name: /courses currently set up/i })

    fireEvent.change(screen.getByLabelText(/course code/i), { target: { value: 'NEW100' } })
    fireEvent.change(screen.getByLabelText(/course name/i), { target: { value: 'New Course' } })
    fireEvent.change(screen.getByLabelText(/hourly rate/i), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /^add course$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/hourly rate above 0/i)
    // The screen did not block it first with a rule of its own.
    expect(createCourse).toHaveBeenCalled()
  })
})

describe('CourseManagement deep links from the command centre', () => {
  beforeEach(() => {
    listCourses.mockReset().mockResolvedValue(courses)
    updateCourse.mockReset()
    getAccessTokenSilently.mockReset()
  })

  it('opens the course a link named once that course has been read', async () => {
    renderPage('/organiser/courses/2')
    await screen.findByRole('list', { name: /courses currently set up/i })

    expect(
      await screen.findByRole('heading', { name: 'Edit COMS3011' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/course code/i)).toHaveValue('COMS3011')
    expect(screen.getByLabelText(/budget/i)).toHaveValue(5000)
  })

  it('stays on a new course when the link names a course that is not there', async () => {
    renderPage('/organiser/courses/999')
    await screen.findByRole('list', { name: /courses currently set up/i })

    expect(screen.getByRole('heading', { name: 'Add a course' })).toBeInTheDocument()
    expect(screen.getByLabelText(/course code/i)).toHaveValue('')
  })

  it('leaves the form cancelled once the organiser closes the linked course', async () => {
    renderPage('/organiser/courses/2')
    await screen.findByRole('heading', { name: 'Edit COMS3011' })

    fireEvent.click(screen.getByRole('button', { name: /cancel edit/i }))

    expect(screen.getByRole('heading', { name: 'Add a course' })).toBeInTheDocument()
  })
})
