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
  it.each([
    ['ORGANISER', 'Organiser'],
    ['TUTOR', 'Tutor'],
    ['STUDENT', 'Student'],
  ])('opens the %s entry route after sign in', (role, label) => {
    renderRole(role)
    expect(screen.getByRole('heading', { name: `${label} workspace` })).toBeInTheDocument()
  })

  it('shows only navigation for the signed-in role', () => {
    renderRole('TUTOR', '/tutor')

    expect(screen.getByRole('link', { name: /tutor workspace/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /organiser workspace/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /student workspace/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /account settings/i })).toBeInTheDocument()
  })

  it('routes a user away from another role area', () => {
    renderRole('STUDENT', '/organiser')
    expect(screen.getByRole('heading', { name: /access denied/i })).toBeInTheDocument()
  })

  it('denies access for an unknown or unsupported profile role', () => {
    renderRole('SUPERADMIN', '/dashboard')
    expect(screen.getByRole('heading', { name: /access denied/i })).toBeInTheDocument()
  })
})
