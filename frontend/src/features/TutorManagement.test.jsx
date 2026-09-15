import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TutorManagement from './TutorManagement'

const listTutors = vi.fn()
const getAccessTokenSilently = vi.fn()

vi.mock('../api/organiser', () => ({
  listTutors: (...args) => listTutors(...args),
}))

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently }),
}))

vi.mock('./TutorAllocationDetails', () => ({
  default: ({ tutor }) => <section>Allocation details for {tutor.fullName}</section>,
}))

const tutorWithHours = {
  id: 7,
  email: 'sam@tutormx.example',
  fullName: 'Sam Tutor',
  role: 'TUTOR',
  weeklyHours: 10,
  usedHours: 2,
  workedHours: 1,
  remainingHours: 8,
  weekStart: '2030-09-02',
  weekEnd: '2030-09-08',
  capacityStatus: 'available',
}

const tutorWithoutHours = {
  id: 8,
  email: 'ash@tutormx.example',
  fullName: 'Ash Tutor',
  role: 'TUTOR',
  weeklyHours: null,
  usedHours: 0,
  workedHours: 0,
  remainingHours: null,
  weekStart: '2030-09-02',
  weekEnd: '2030-09-08',
  capacityStatus: 'not-set',
}

const tutors = [tutorWithHours, tutorWithoutHours]

function renderPage() {
  render(
    <MemoryRouter>
      <TutorManagement />
    </MemoryRouter>,
  )
}

describe('TutorManagement', () => {
  beforeEach(() => {
    listTutors.mockReset()
    getAccessTokenSilently.mockReset()
  })

  it('lists tutors and shows an unset weekly limit as Not set', async () => {
    listTutors.mockResolvedValue(tutors)

    renderPage()

    await screen.findByText('Sam Tutor')
    expect(screen.getByText('sam@tutormx.example')).toBeInTheDocument()
    expect(screen.getByText('Ash Tutor')).toBeInTheDocument()
    expect(screen.getAllByText('Not set').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/available for more work/i)).toBeInTheDocument()
    expect(screen.getByText(/weekly limit not set/i)).toBeInTheDocument()
  })

  it('never asks the organiser for an Auth0 subject', async () => {
    listTutors.mockResolvedValue(tutors)

    renderPage()
    await screen.findByText('Sam Tutor')

    expect(screen.queryByLabelText(/auth0 subject/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/auth0/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/user id/i)).not.toBeInTheDocument()
    expect(screen.getByText(/search for a tutor by name or email below/i)).toBeInTheDocument()
  })

  it('filters registered tutors by name or email', async () => {
    listTutors.mockResolvedValue(tutors)

    renderPage()
    await screen.findByText('Sam Tutor')

    const search = screen.getByLabelText(/search tutors/i)
    fireEvent.change(search, { target: { value: 'ash@' } })

    expect(screen.getByText('Ash Tutor')).toBeInTheDocument()
    expect(screen.queryByText('Sam Tutor')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'nobody' } })
    expect(screen.getByText(/no tutors found/i)).toBeInTheDocument()
  })

  it('opens the selected tutor marks and schedule controls', async () => {
    listTutors.mockResolvedValue(tutors)

    renderPage()
    await screen.findByText('Sam Tutor')
    fireEvent.click(
      screen.getByRole('button', { name: /manage marks and view schedule for Sam Tutor/i }),
    )

    expect(screen.getByText(/allocation details for Sam Tutor/i)).toBeInTheDocument()
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
