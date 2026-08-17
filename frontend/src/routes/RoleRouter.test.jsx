import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { RoleRouter } from './RoleRouter'

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    isAuthenticated: true,
    isLoading: false,
    getAccessTokenSilently: vi.fn(),
  }),
}))

vi.mock('../api/studentOverflow', () => ({
  getStudentOverflowWork: vi.fn().mockResolvedValue([]),
}))

vi.mock('../api/tutorDashboard', () => ({
  fetchTutorDashboard: () =>
    Promise.resolve({ allocations: [], weeklyLimit: 10, usedHours: 0, remainingHours: 10 }),
}))

function renderRole(currentRole, path = '/') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/*" element={<RoleRouter currentRole={currentRole} />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RoleRouter', () => {
  it('opens the ORGANISER entry route after sign in', () => {
    renderRole('ORGANISER')
    expect(screen.getByRole('heading', { name: 'Organiser workspace' })).toBeInTheDocument()
  })

  it('opens the STUDENT entry route after sign in', async () => {
    renderRole('STUDENT')
    expect(
      await screen.findByRole('heading', { name: /available volunteer work/i }),
    ).toBeInTheDocument()
  })

  it('opens the TUTOR entry route after sign in', async () => {
    renderRole('TUTOR')
    expect(await screen.findByRole('heading', { name: /your tutor dashboard/i })).toBeInTheDocument()
  })

  it('shows only navigation for the signed-in role', () => {
    renderRole('TUTOR', '/tutor')

    expect(screen.getByRole('link', { name: /tutor workspace/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /tutor forms/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /organiser workspace/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /student workspace/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /account settings/i })).toBeInTheDocument()
  })

  it('keeps tutor forms behind the Tutor role guard', async () => {
    renderRole('TUTOR', '/tutor/forms')
    expect(
      await screen.findByRole('heading', { name: /availability, work log and excuses/i }),
    ).toBeInTheDocument()
  })

  it('routes a user away from another role area', () => {
    renderRole('STUDENT', '/organiser')
    expect(screen.getByRole('heading', { name: /access denied/i })).toBeInTheDocument()
  })

  it('denies access for an unknown or unsupported profile role', () => {
    renderRole('SUPERADMIN', '/dashboard')
    expect(screen.getByRole('heading', { name: /access denied/i })).toBeInTheDocument()
  })

  it('shows student navigation for a student', () => {
    renderRole('STUDENT')
    expect(screen.getByRole('link', { name: /student workspace/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /account settings/i })).toBeInTheDocument()
  })

  it('shows tutor navigation for a tutor', () => {
    renderRole('TUTOR')
    expect(screen.getByRole('link', { name: /tutor workspace/i })).toBeInTheDocument()
  })

  it('shows organiser navigation for an organiser', () => {
    renderRole('ORGANISER')
    expect(screen.getByRole('link', { name: /organiser workspace/i })).toBeInTheDocument()
  })

  it('provides a skip link to the shared main-content target', () => {
    renderRole('ORGANISER')

    expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveAttribute(
      'href',
      '#main-content',
    )
    expect(document.querySelector('#main-content')).toBeInTheDocument()
  })
})
