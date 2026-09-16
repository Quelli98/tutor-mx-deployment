import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    expect(screen.getByText(/weekly capacity not set/i)).toBeInTheDocument()
  })

  it('shows workload metric cards and a clear inclusive week without UTC jargon', async () => {
    listTutors.mockResolvedValue([{ ...tutorWithHours, weeklyHours: 15, usedHours: 0, remainingHours: 15, workedHours: 0, weekStart: '2026-09-14T00:00:00.000Z', weekEnd: '2026-09-21T00:00:00.000Z' }])
    renderPage()
    await screen.findByText('Sam Tutor')
    expect(screen.getAllByText('This week').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('14–20 September 2026')).toBeVisible()
    for (const label of ['Weekly capacity', 'Allocated', 'Remaining', 'Worked this week', 'Status']) {
      expect(screen.getByText(label)).toBeVisible()
    }
    expect(screen.getAllByText('15 h')).toHaveLength(2)
    expect(screen.getAllByText('0 h')).toHaveLength(2)
    expect(screen.queryByText(/UTC Monday week/)).not.toBeInTheDocument()
  })

  it.each([null, '', 'sam@tutormx.example'])('does not repeat email when fullName is %s', async (fullName) => {
    listTutors.mockResolvedValue([{ ...tutorWithHours, fullName }])
    renderPage()
    expect(await screen.findByRole('heading', { name: tutorWithHours.email })).toBeVisible()
    expect(screen.getAllByText(tutorWithHours.email)).toHaveLength(1)
    fireEvent.change(screen.getByLabelText(/search tutors/i), { target: { value: 'sam@' } })
    expect(screen.getByRole('heading', { name: tutorWithHours.email })).toBeVisible()
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

  it('renders Previous week, This week, and Next week navigation buttons', async () => {
    listTutors.mockResolvedValue(tutors)
    renderPage()
    await screen.findByText('Sam Tutor')

    expect(screen.getByRole('button', { name: /previous week/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^this week$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next week/i })).toBeInTheDocument()
  })

  it('requests the following week after clicking Next week', async () => {
    listTutors.mockResolvedValue(tutors)
    renderPage()
    await screen.findByText('Sam Tutor')

    const initialCallCount = listTutors.mock.calls.length
    const currentMonday = new Date()
    currentMonday.setHours(0, 0, 0, 0)
    currentMonday.setDate(currentMonday.getDate() - ((currentMonday.getDay() + 6) % 7))
    const nextMonday = new Date(currentMonday)
    nextMonday.setDate(nextMonday.getDate() + 7)
    const expectedIso = `${nextMonday.getFullYear()}-${String(nextMonday.getMonth() + 1).padStart(2, '0')}-${String(nextMonday.getDate()).padStart(2, '0')}`

    fireEvent.click(screen.getByRole('button', { name: /next week/i }))

    await waitFor(() => {
      expect(listTutors.mock.calls.length).toBeGreaterThan(initialCallCount)
    })
    const lastCall = listTutors.mock.calls[listTutors.mock.calls.length - 1]
    expect(lastCall[1]).toBe(expectedIso)
  })

  it('requests the prior week after clicking Previous week', async () => {
    listTutors.mockResolvedValue(tutors)
    renderPage()
    await screen.findByText('Sam Tutor')

    const initialCallCount = listTutors.mock.calls.length
    const currentMonday = new Date()
    currentMonday.setHours(0, 0, 0, 0)
    currentMonday.setDate(currentMonday.getDate() - ((currentMonday.getDay() + 6) % 7))
    const prevMonday = new Date(currentMonday)
    prevMonday.setDate(prevMonday.getDate() - 7)
    const expectedIso = `${prevMonday.getFullYear()}-${String(prevMonday.getMonth() + 1).padStart(2, '0')}-${String(prevMonday.getDate()).padStart(2, '0')}`

    fireEvent.click(screen.getByRole('button', { name: /previous week/i }))

    await waitFor(() => {
      expect(listTutors.mock.calls.length).toBeGreaterThan(initialCallCount)
    })
    const lastCall = listTutors.mock.calls[listTutors.mock.calls.length - 1]
    expect(lastCall[1]).toBe(expectedIso)
  })

  it('resets to the current week when clicking This week from another week', async () => {
    listTutors.mockResolvedValue(tutors)
    renderPage()
    await screen.findByText('Sam Tutor')

    const currentMonday = new Date()
    currentMonday.setHours(0, 0, 0, 0)
    currentMonday.setDate(currentMonday.getDate() - ((currentMonday.getDay() + 6) % 7))
    const currentIso = `${currentMonday.getFullYear()}-${String(currentMonday.getMonth() + 1).padStart(2, '0')}-${String(currentMonday.getDate()).padStart(2, '0')}`

    fireEvent.click(screen.getByRole('button', { name: /next week/i }))
    await waitFor(() => {
      const lastCall = listTutors.mock.calls[listTutors.mock.calls.length - 1]
      expect(lastCall[1]).not.toBe(currentIso)
    })

    fireEvent.click(screen.getByRole('button', { name: /^this week$/i }))
    await waitFor(() => {
      const lastCall = listTutors.mock.calls[listTutors.mock.calls.length - 1]
      expect(lastCall[1]).toBe(currentIso)
    })
  })
})
