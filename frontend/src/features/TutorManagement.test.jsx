import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TutorManagement from './TutorManagement'

const listTutors = vi.fn()
const updateTutor = vi.fn()
const getAccessTokenSilently = vi.fn()

vi.mock('../api/organiser', () => ({
  listTutors: (...args) => listTutors(...args),
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

describe('TutorManagement', () => {
  beforeEach(() => {
    listTutors.mockReset()
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

  it('never asks the organiser for an Auth0 subject', async () => {
    listTutors.mockResolvedValue(tutors)

    renderPage()
    await screen.findByRole('table')

    expect(screen.queryByLabelText(/auth0 subject/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/auth0/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/user id/i)).not.toBeInTheDocument()
    expect(screen.getByText(/search for a tutor by name or email below/i)).toBeInTheDocument()
  })

  it('filters registered tutors by name or email', async () => {
    listTutors.mockResolvedValue(tutors)

    renderPage()
    await screen.findByRole('table')

    const search = screen.getByLabelText(/search tutors/i)
    fireEvent.change(search, { target: { value: 'ash@' } })

    const table = screen.getByRole('table')
    expect(within(table).getByText('Ash Tutor')).toBeInTheDocument()
    expect(within(table).queryByText('Sam Tutor')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'nobody' } })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText(/no tutors found/i)).toBeInTheDocument()
  })

  it('opens the selected tutor marks and busy-time controls', async () => {
    listTutors.mockResolvedValue(tutors)

    renderPage()
    await screen.findByRole('table')
    fireEvent.click(
      screen.getByRole('button', { name: /manage marks and availability for Sam Tutor/i }),
    )

    expect(screen.getByText(/allocation details for Sam Tutor/i)).toBeInTheDocument()
  })

  it('edits an existing tutor using the database tutor id and reloads the list', async () => {
    listTutors.mockResolvedValue(tutors)
    updateTutor.mockResolvedValue({ ...tutorWithHours, weeklyHours: 12 })

    renderPage()
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: /edit Sam Tutor/i }))

    expect(screen.getByLabelText(/email/i)).toHaveValue('sam@tutormx.example')
    expect(screen.getByLabelText(/full name/i)).toHaveValue('Sam Tutor')
    expect(screen.getByLabelText(/weekly hours/i)).toHaveValue(10)
    expect(screen.queryByLabelText(/auth0 subject/i)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/weekly hours/i), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(updateTutor).toHaveBeenCalledWith(
        { tutorId: 7, weeklyHours: 12 },
        getAccessTokenSilently,
      )
    })
    await waitFor(() => {
      expect(listTutors).toHaveBeenCalledTimes(2)
    })
    expect(await screen.findByText(/Sam Tutor was updated/i)).toBeInTheDocument()
  })

  it('sends only the changed field when editing', async () => {
    listTutors.mockResolvedValue(tutors)
    updateTutor.mockResolvedValue({ ...tutorWithHours, fullName: 'Samantha Tutor' })

    renderPage()
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: /edit Sam Tutor/i }))
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
    expect(updateTutor.mock.calls[0][0]).not.toHaveProperty('auth0Id')
  })

  it('blocks an invalid email and sends no request', async () => {
    listTutors.mockResolvedValue(tutors)

    renderPage()
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: /edit Sam Tutor/i }))
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'not-an-email' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    expect(screen.getByLabelText(/email/i)).toHaveAccessibleDescription(
      /enter a valid email address/i,
    )
    expect(updateTutor).not.toHaveBeenCalled()
  })

  it.each(['0', '200'])('blocks weekly hours of %s and sends no request', async (value) => {
    listTutors.mockResolvedValue(tutors)

    renderPage()
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: /edit Sam Tutor/i }))
    fireEvent.change(screen.getByLabelText(/weekly hours/i), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    expect(screen.getByLabelText(/weekly hours/i)).toHaveAccessibleDescription(
      /above 0 and no more than 168/i,
    )
    expect(updateTutor).not.toHaveBeenCalled()
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

  it('shows a friendly conflict message when an edit collides with another profile', async () => {
    listTutors.mockResolvedValue(tutors)
    updateTutor.mockRejectedValue(errorWithCode('TUTOR_CONFLICT'))

    renderPage()
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: /edit Sam Tutor/i }))
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'ash@tutormx.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    expect(
      await screen.findByText(/a tutor with those details already exists/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/raw server detail/i)).not.toBeInTheDocument()
  })

  it('tells the organiser how a tutor becomes available when no tutors exist', async () => {
    listTutors.mockResolvedValue([])

    renderPage()

    expect(await screen.findByText(/no tutors available/i)).toBeInTheDocument()
    expect(
      screen.getByText(/tutor accounts will appear here after registration/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add tutor/i })).not.toBeInTheDocument()
  })
})
