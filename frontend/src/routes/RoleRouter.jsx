import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from '../auth/ProtectedRoute'
import { AccountSettings } from '../features/AccountSettings'
import { ROLE_ROUTE_MAP } from './roleMap'

function RoleNavigation({ currentRole }) {
  const roleRoute = ROLE_ROUTE_MAP[currentRole]
  if (!roleRoute) return null

  return (
    <nav className="role-navigation" aria-label="Tutor Mx navigation">
      <NavLink to={roleRoute.path}>{roleRoute.label}</NavLink>
      <NavLink to="/settings">Account settings</NavLink>
    </nav>
  )
}

function protect(currentRole, allowedRoles, children) {
  return (
    <ProtectedRoute allowedRoles={allowedRoles} currentRole={currentRole}>
      {children}
    </ProtectedRoute>
  )
}

export function RoleRouter({ currentRole }) {
  const entryPath = ROLE_ROUTE_MAP[currentRole]?.path

  return (
    <>
      <RoleNavigation currentRole={currentRole} />
      <Routes>
        <Route path="/" element={<Navigate to={entryPath || '/access-denied'} replace />} />
        <Route path="/dashboard" element={<Navigate to={entryPath || '/access-denied'} replace />} />
        <Route
          path="/organiser"
          element={protect(currentRole, ['ORGANISER'], <RolePage role="Organiser" />)}
        />
        <Route
          path="/tutor"
          element={protect(currentRole, ['TUTOR'], <RolePage role="Tutor" />)}
        />
        <Route
          path="/student"
          element={protect(currentRole, ['STUDENT'], <RolePage role="Student" />)}
        />
        <Route
          path="/settings"
          element={protect(currentRole, ['ORGANISER', 'TUTOR', 'STUDENT'], <AccountSettings />)}
        />
        <Route path="/access-denied" element={<AccessDeniedPage />} />
        <Route path="*" element={<Navigate to={entryPath || '/access-denied'} replace />} />
      </Routes>
    </>
  )
}

function RolePage({ role }) {
  return (
    <main className="dashboard-shell">
      <div className="dashboard-header">
        <div>
          <p className="eyebrow">Tutor Mx</p>
          <h1>{role} workspace</h1>
        </div>
      </div>
      <section className="role-card">
        <h2>Secure role entry</h2>
        <p>Only users with the matching {role.toLowerCase()} role can open this workspace.</p>
      </section>
    </main>
  )
}

function AccessDeniedPage() {
  return (
    <main className="dashboard-shell" role="alert">
      <section className="role-card danger-zone">
        <h1>Access denied</h1>
        <p>Your account does not have permission to open this page.</p>
      </section>
    </main>
  )
}
