import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from '../auth/ProtectedRoute'
import { AccountSettings } from '../features/AccountSettings'
import TutorDashboard from '../features/TutorDashboard'
import TutorForms from '../features/TutorForms'
import { ROLE_ROUTE_MAP } from './roleMap'
import { StudentOverflow } from '../features/StudentOverflow'
import CourseManagement from '../features/CourseManagement'
import TutorManagement from '../features/TutorManagement'
import OrganiserDashboard from '../features/OrganiserDashboard'
import OrganiserApprovals from '../features/OrganiserApprovals'
import StaffingRequirements from '../features/StaffingRequirements'
import BulkAllocation from '../features/BulkAllocation'
import OrganiserReports from '../features/OrganiserReports'
import OrganiserOverflow from '../features/OrganiserOverflow'
import { SkipToContent } from '../components/shared/SkipToContent'
import { NotificationBell } from '../components/shared/NotificationBell'
import { CommandPalette } from '../components/shared/CommandPalette'
import { CsamMark } from '../components/shared/CsamMark'
import { OrganiserShell } from '../components/organiser/OrganiserShell'

function RoleNavigation({ currentRole, onSignOut }) {
  const roleRoute = ROLE_ROUTE_MAP[currentRole]
  if (!roleRoute) return null

  return (
    <nav
      className="role-navigation"
      aria-label="CSAM Tutor Hub primary navigation"
    >
      <div className="role-navigation-inner">
        <span className="role-navigation-brand">
          <CsamMark className="brand-mark" />
          <span>CSAM Tutor Hub</span>
        </span>
        <NavLink
          to={roleRoute.path}
          end
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

        <div className="role-navigation-actions">
          <CommandPalette />
          <NotificationBell />
        </div>

        <button
          type="button"
          className="dashboard-sign-out-button"
          onClick={onSignOut}
        >
          Sign out
        </button>
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

export function RoleRouter({ currentRole, onSignOut, user = null }) {
  const entryPath = ROLE_ROUTE_MAP[currentRole]?.path

  const routes = (
    <Routes>
      <Route path="/" element={<Navigate to={entryPath || '/access-denied'} replace />} />
      <Route path="/dashboard" element={<Navigate to={entryPath || '/access-denied'} replace />} />
      <Route
        path="/organiser"
        element={protect(currentRole, ['ORGANISER'], <OrganiserDashboard />)}
      />
      <Route
        path="/organiser/courses"
        element={protect(currentRole, ['ORGANISER'], <CourseManagement />)}
      />
      <Route
        path="/organiser/tutors"
        element={protect(currentRole, ['ORGANISER'], <TutorManagement />)}
      />
      <Route
        path="/organiser/staffing"
        element={protect(currentRole, ['ORGANISER'], <StaffingRequirements />)}
      />
      <Route
        path="/organiser/staffing/bulk"
        element={protect(currentRole, ['ORGANISER'], <BulkAllocation />)}
      />
      <Route
        path="/organiser/reports"
        element={protect(currentRole, ['ORGANISER'], <OrganiserReports />)}
      />
      <Route
        path="/organiser/approvals"
        element={protect(currentRole, ['ORGANISER'], <OrganiserApprovals />)}
      />
      <Route
        path="/organiser/overflow"
        element={protect(currentRole, ['ORGANISER'], <OrganiserOverflow />)}
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
  )

  // The organiser works inside a sidebar layout; tutors and students keep the top navigation.
  if (currentRole === 'ORGANISER') {
    return (
      <>
        <SkipToContent />
        <OrganiserShell user={user} onSignOut={onSignOut}>
          {routes}
        </OrganiserShell>
      </>
    )
  }

  return (
    <>
      <SkipToContent />
      <RoleNavigation currentRole={currentRole} onSignOut={onSignOut} />
      {routes}
    </>
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
