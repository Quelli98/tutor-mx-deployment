import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TutorManagement from './TutorManagement'

const listTutors = vi.fn()
const createTutor = vi.fn()
const updateTutor = vi.fn()
const getAccessTokenSilently = vi.fn()

vi.mock('../api/organiser', () => ({
  listTutors: (...args) => listTutors(...args),
  createTutor: (...args) => createTutor(...args),
  updateTutor: (...args) => updateTutor(...args),
}))

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently }),
}))

vi.mock('./TutorAllocationDetails', () => ({
  default: ({ tutor }) => <section>Allocation details for {tutor.fullName}</section>,
}))

const tutorWithHours = {
  id: 7,
  auth0Id: 'auth0|tutor-7',
  email: 'sam@tutormx.example',
  fullName: 'Sam Tutor',
  role: 'TUTOR',
  weeklyHours: 10,
}

const tutorWithoutHours = {
  id: 8,
  auth0Id: 'auth0|tutor-8',
  email: 'ash@tutormx.example',
  fullName: 'Ash Tutor',
  role: 'TUTOR',
  weeklyHours: null,
}

const tutors = [tutorWithHours, tutorWithoutHours]

function renderPage() {
  render(
    <MemoryRouter>
      <TutorManagement />
    </MemoryRouter>,
  )
}

function errorWithCode(code) {
  const error = new Error('raw server detail')
  error.code = code
  return error
}

function fillCreateForm({ auth0Id, email, fullName, weeklyHours }) {
  fireEvent.change(screen.getByLabelText(/auth0 subject/i), { target: { value: auth0Id } })
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } })
  fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: fullName } })
  fireEvent.change(screen.getByLabelText(/weekly hours/i), {
    target: { value: weeklyHours ?? '' },
  })
}

describe('TutorManagement', () => {
  beforeEach(() => {
    listTutors.mockReset()
    createTutor.mockReset()
    updateTutor.mockReset()
    getAccessTokenSilently.mockReset()
  })

  it('lists tutors and shows an unset weekly-hour limit as Not set', async () => {
    listTutors.mockResolvedValue(tutors)

    renderPage()

    const table = await screen.findByRole('table')
    expect(within(table).getByText('Sam Tutor')).toBeInTheDocument()
    expect(within(table).getByText('sam@tutormx.example')).toBeInTheDocument()
    expect(within(table).getByText('10')).toBeInTheDocument()
    expect(within(table).getByText('Ash Tutor')).toBeInTheDocument()
    expect(within(table).getByText('Not set')).toBeInTheDocument()
  })

  it('opens the selected tutor marks and busy-time controls', async () => {
    listTutors.mockResolvedValue(tutors)

    renderPage()
    await screen.findByRole('table')
    fireEvent.click(
      screen.getByRole('button', { name: /manage marks and busy times for Sam Tutor/i }),
    )

    expect(screen.getByText(/allocation details for Sam Tutor/i)).toBeInTheDocument()
  })

  it('explains where the Auth0 subject comes from, alongside any field error', async () => {
    listTutors.mockResolvedValue(tutors)

    renderPage()
    await screen.findByRole('table')

    const auth0Field = screen.getByLabelText(/auth0 subject/i)
    expect(auth0Field).toHaveAccessibleDescription(/must sign up on tutor mx first/i)
    expect(auth0Field).toHaveAccessibleDescription(/copy their exact user id from auth0/i)

    fireEvent.click(screen.getByRole('button', { name: /^add tutor$/i }))

    expect(auth0Field).toHaveAccessibleDescription(/enter the auth0 subject for this tutor/i)
    expect(auth0Field).toHaveAccessibleDescription(/copy their exact user id from auth0/i)
    expect(createTutor).not.toHaveBeenCalled()
  })

  it('sends a valid create payload and reloads the list', async () => {
    listTutors.mockResolvedValue(tutors)
    createTutor.mockResolvedValue({ ...tutorWithHours, id: 9 })

    renderPage()
    await screen.findByRole('table')

    fillCreateForm({
      auth0Id: '  auth0|tutor-9  ',
      email: '  new@tutormx.example  ',
      fullName: '  New Tutor  ',
      weeklyHours: '7.5',
    })
    fireEvent.click(screen.getByRole('button', { name: /^add tutor$/i }))

    await waitFor(() => {
      expect(createTutor).toHaveBeenCalledWith(
        {
          auth0Id: 'auth0|tutor-9',
          email: 'new@tutormx.example',
          fullName: 'New Tutor',
          weeklyHours: 7.5,
        },
        getAccessTokenSilently,
      )
    })
    await waitFor(() => {
      expect(listTutors).toHaveBeenCalledTimes(2)
    })
    expect(await screen.findByText(/New Tutor was added/i)).toBeInTheDocument()
  })

  it('omits weeklyHours entirely when the field is left blank', async () => {
    listTutors.mockResolvedValue(tutors)
    createTutor.mockResolvedValue({ ...tutorWithoutHours, id: 9 })

    renderPage()
    await screen.findByRole('table')

    fillCreateForm({
      auth0Id: 'auth0|tutor-9',
      email: 'new@tutormx.example',
      fullName: 'New Tutor',
      weeklyHours: '',
    })
    fireEvent.click(screen.getByRole('button', { name: /^add tutor$/i }))

    await waitFor(() => {
      expect(createTutor).toHaveBeenCalledWith(
        {
          auth0Id: 'auth0|tutor-9',
          email: 'new@tutormx.example',
          fullName: 'New Tutor',
        },
        getAccessTokenSilently,
      )
    })
    expect(createTutor.mock.calls[0][0]).not.toHaveProperty('weeklyHours')
  })

  it('blocks an invalid email and sends no request', async () => {
    listTutors.mockResolvedValue(tutors)

    renderPage()
    await screen.findByRole('table')

    fillCreateForm({
      auth0Id: 'auth0|tutor-9',
      email: 'not-an-email',
      fullName: 'New Tutor',
      weeklyHours: '',
    })
    fireEvent.click(screen.getByRole('button', { name: /^add tutor$/i }))

    expect(screen.getByLabelText(/email/i)).toHaveAccessibleDescription(
      /enter a valid email address/i,
    )
    expect(createTutor).not.toHaveBeenCalled()
    expect(listTutors).toHaveBeenCalledTimes(1)
  })

  it.each(['0', '200'])('blocks weekly hours of %s and sends no request', async (value) => {
    listTutors.mockResolvedValue(tutors)

    renderPage()
    await screen.findByRole('table')

    fillCreateForm({
      auth0Id: 'auth0|tutor-9',
      email: 'new@tutormx.example',
      fullName: 'New Tutor',
      weeklyHours: value,
    })
    fireEvent.click(screen.getByRole('button', { name: /^add tutor$/i }))

    expect(screen.getByLabelText(/weekly hours/i)).toHaveAccessibleDescription(
      /above 0 and no more than 168/i,
    )
    expect(createTutor).not.toHaveBeenCalled()
  })

  it('sends only the changed field when editing', async () => {
    listTutors.mockResolvedValue(tutors)
    updateTutor.mockResolvedValue({ ...tutorWithHours, fullName: 'Samantha Tutor' })

    renderPage()
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: /edit Sam Tutor/i }))

    expect(screen.getByLabelText(/email/i)).toHaveValue('sam@tutormx.example')
    expect(screen.getByLabelText(/full name/i)).toHaveValue('Sam Tutor')
    expect(screen.getByLabelText(/weekly hours/i)).toHaveValue(10)

    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: 'Samantha Tutor' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(updateTutor).toHaveBeenCalledWith(
        { tutorId: 7, fullName: 'Samantha Tutor' },
        getAccessTokenSilently,
      )
    })
    expect(updateTutor.mock.calls[0][0]).not.toHaveProperty('email')
    expect(updateTutor.mock.calls[0][0]).not.toHaveProperty('weeklyHours')
  })

  it('disables the edit submit until something changes', async () => {
    listTutors.mockResolvedValue(tutors)

    renderPage()
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: /edit Sam Tutor/i }))

    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: 'Samantha Tutor' },
    })

    expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled()
  })

  it('explains that an edited tutor no longer exists', async () => {
    listTutors.mockResolvedValue(tutors)
    updateTutor.mockRejectedValue(errorWithCode('TUTOR_NOT_FOUND'))

    renderPage()
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: /edit Sam Tutor/i }))
    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: 'Samantha Tutor' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    expect(
      await screen.findByText(/that tutor no longer exists\. refresh and try again\./i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/raw server detail/i)).not.toBeInTheDocument()
    expect(listTutors).toHaveBeenCalledTimes(1)
  })

  it('shows a friendly message for a conflicting tutor', async () => {
    listTutors.mockResolvedValue(tutors)
    createTutor.mockRejectedValue(errorWithCode('TUTOR_CONFLICT'))

    renderPage()
    await screen.findByRole('table')

    fillCreateForm({
      auth0Id: 'auth0|tutor-7',
      email: 'sam@tutormx.example',
      fullName: 'Sam Tutor',
      weeklyHours: '',
    })
    fireEvent.click(screen.getByRole('button', { name: /^add tutor$/i }))

    expect(
      await screen.findByText(/a tutor with those details already exists/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/raw server detail/i)).not.toBeInTheDocument()
  })
})
