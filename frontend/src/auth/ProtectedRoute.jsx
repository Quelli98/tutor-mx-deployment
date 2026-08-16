import { Navigate, useLocation } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'

export function ProtectedRoute({ allowedRoles, currentRole, children }) {
  const { isAuthenticated, isLoading } = useAuth0()
  const location = useLocation()

  if (isLoading) {
    return <p>Checking your access...</p>
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace state={{ from: location }} />
  }

  if (!currentRole || !allowedRoles.includes(currentRole)) {
    return <Navigate to="/access-denied" replace state={{ from: location }} />
  }

  return children
}
