import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TutorForms from './TutorForms'

const tokenGetter = vi.fn()

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently: tokenGetter }),
}))
vi.mock('../api/tutorDashboard', () => ({
  fetchTutorDashboard: () =>
    Promise.resolve({
      allocations: [
        {
          id: 1,
          courseCode: 'DEMO101',
          courseName: 'Demo Course',
          startsAt: '2030-09-04T14:00:00.000Z',
          endsAt: '2030-09-04T16:00:00.000Z',
          allocatedHours: 2,
          status: 'CONFIRMED',
        },
      ],
      weeklyLimit: 10,
      usedHours: 2,
      remainingHours: 8,
    }),
}))
vi.mock('../api/availability', () => ({
  submitTimeSlot: vi.fn(),
  listOwnTimeSlots: () => Promise.resolve([]),
  deleteOwnTimeSlot: vi.fn(),
  updateOwnTimeSlot: vi.fn(),
}))
vi.mock('../api/workLog', () => ({ submitWorkLog: vi.fn() }))
vi.mock('../api/excuse', () => ({ submitExcuse: vi.fn() }))

describe('TutorForms at the agreed 360px phone width', () => {
  it('keeps all required actions in the responsive form grid', async () => {
    window.innerWidth = 360
    window.dispatchEvent(new Event('resize'))
    const { container } = render(<TutorForms />)

    expect(await screen.findByRole('button', { name: /add schedule entry/i })).toBeVisible()
    expect(screen.getByRole('button', { name: /add to draft/i })).toBeVisible()
    expect(screen.getByRole('button', { name: /submit excuse/i })).toBeVisible()
    expect(container.querySelector('.tutor-form-grid')).toBeInTheDocument()
    expect(screen.getByLabelText(/from.*date and time/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/until.*date and time/i)).toBeInTheDocument()
  })
})
