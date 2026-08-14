import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute'
import { describe, it, expect, vi } from 'vitest'

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    isAuthenticated: true,
    isLoading: false,
  }),
}))

describe('ProtectedRoute', () => {
  it('blocks access when the user role is not allowed', () => {
    render(
      <MemoryRouter initialEntries={['/student']}>
        <Routes>
          <Route
            path="/student"
            element={<ProtectedRoute allowedRoles={['ORGANISER']} currentRole="STUDENT">Child</ProtectedRoute>}
          />
          <Route path="/access-denied" element={<div>Access denied</div>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Access denied')).toBeInTheDocument()
  })

  it('renders content when the role is allowed', () => {
    render(
      <MemoryRouter initialEntries={['/organiser']}>
        <Routes>
          <Route
            path="/organiser"
            element={<ProtectedRoute allowedRoles={['ORGANISER']} currentRole="ORGANISER">Allowed</ProtectedRoute>}
          />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Allowed')).toBeInTheDocument()
  })
})
