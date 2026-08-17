import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from '../auth/ProtectedRoute'
import { AccountSettings } from '../features/AccountSettings'
import TutorDashboard from '../features/TutorDashboard'
import TutorForms from '../features/TutorForms'
import { ROLE_ROUTE_MAP } from './roleMap'
import { StudentOverflow } from '../features/StudentOverflow'
import { SkipToContent } from '../components/shared/SkipToContent'

function RoleNavigation({ currentRole }) {
  const roleRoute = ROLE_ROUTE_MAP[currentRole]
  if (!roleRoute) return null

  return (
    <nav
      className="role-navigation"
      aria-label="Tutor Mx primary navigation"
    >
      <div className="role-navigation-inner">
        <NavLink
          to={roleRoute.path}
          className={({ isActive }) =>
            `role-navigation-link${isActive ? ' active' : ''}`
          }
        >
          {roleRoute.label}
        </NavLink>

        {currentRole === 'TUTOR' && (
          <NavLink
            to="/tutor/forms"
            className={({ isActive }) =>
              `role-navigation-link${isActive ? ' active' : ''}`
            }
          >
            Tutor forms
          </NavLink>
        )}

        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `role-navigation-link${isActive ? ' active' : ''}`
          }
        >
          Account settings
        </NavLink>
      </div>
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
      <SkipToContent />
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
          element={protect(currentRole, ['TUTOR'], <TutorDashboard />)}
        />
        <Route
          path="/tutor/forms"
          element={protect(currentRole, ['TUTOR'], <TutorForms />)}
        />
        <Route
          path="/student"
          element={protect(currentRole, ['STUDENT'], <StudentOverflow />)}
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
    <main id="main-content" className="dashboard-shell">
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
    <main id="main-content" className="dashboard-shell" role="alert">
      <section className="role-card danger-zone">
        <h1>Access denied</h1>
        <p>Your account does not have permission to open this page.</p>
      </section>
    </main>
  )
}
