import SwapWorkspace from '../features/SwapWorkspace'
import ScenarioPlanning from '../features/ScenarioPlanning'
import ProposalLab from '../features/ProposalLab'
import MutualAvailability from '../features/MutualAvailability'
import TargetGate from '../features/TargetGate'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ProtectedRoute } from '../auth/ProtectedRoute'
import { AccountSettings } from '../features/AccountSettings'
import TutorDashboard from '../features/TutorDashboard'
import TutorForms from '../features/TutorForms'
import MyTimetable from '../features/MyTimetable'
import AcademicTermManagement from '../features/AcademicTermManagement'
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
import CommandCentre from '../features/CommandCentre'
import MasterOrganiserApplications from '../features/MasterOrganiserApplications'
import { SkipToContent } from '../components/shared/SkipToContent'
import { NotificationBell } from '../components/shared/NotificationBell'
import { CommandPalette } from '../components/shared/CommandPalette'
import { CsamMark } from '../components/shared/CsamMark'
import { OrganiserShell } from '../components/organiser/OrganiserShell'
import { RoleWorkspaceShell } from '../components/shared/RoleWorkspaceShell'

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
          <>
            <NavLink
              to="/tutor/timetable"
              className={({ isActive }) =>
                `role-navigation-link${isActive ? ' active' : ''}`
              }
            >
              My timetable
            </NavLink>
            <NavLink
              to="/tutor/forms"
              className={({ isActive }) =>
                `role-navigation-link${isActive ? ' active' : ''}`
              }
            >
              Tutor forms
            </NavLink>
          </>
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
  const location = useLocation()
  const bookingId = Number(new URLSearchParams(location.search).get('booking'))
  const swapId = Number(new URLSearchParams(location.search).get('swap'))
  const entryPath = ROLE_ROUTE_MAP[currentRole]?.path
  const isMasterOrganiser = Boolean(user?.data?.capabilities?.masterOrganiser)

  const routes = (
    <Routes>
      <Route path="/" element={<Navigate to={entryPath || '/access-denied'} replace />} />
      <Route path="/dashboard" element={<Navigate to={entryPath || '/access-denied'} replace />} />
      <Route
        path="/organiser"
        element={protect(currentRole, ['ORGANISER'], <OrganiserDashboard />)}
      />
      <Route
        path="/organiser/command-centre"
        element={protect(currentRole, ['ORGANISER'], <CommandCentre />)}
      />
      <Route
        path="/organiser/courses"
        element={protect(currentRole, ['ORGANISER'], <CourseManagement />)}
      />
      {/* The same screen, opened on one course: the path the search results
          and the command centre already publish for a course. */}
      <Route
        path="/organiser/courses/:courseId"
        element={protect(currentRole, ['ORGANISER'], <CourseManagement />)}
      />
      <Route
        path="/organiser/tutors"
        element={protect(currentRole, ['ORGANISER'], <TutorManagement />)}
      />
      {/* The same screen, opened on one tutor: the path the search results
          and the command centre already publish for a person. */}
      <Route
        path="/organiser/tutors/:tutorId"
        element={protect(currentRole, ['ORGANISER'], <TutorManagement />)}
      />
      <Route
        path="/organiser/terms"
        element={protect(currentRole, ['ORGANISER'], <AcademicTermManagement />)}
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
        path="/organiser/organiser-applications"
        element={isMasterOrganiser
          ? protect(currentRole, ['ORGANISER'], <MasterOrganiserApplications />)
          : <Navigate to="/access-denied" replace />}
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
        path="/tutor/timetable"
        element={protect(currentRole, ['TUTOR'], <MyTimetable bookingId={bookingId} />)}
      />
      <Route path="/tutor/swaps" element={protect(currentRole, ['TUTOR'], <SwapWorkspace swapId={swapId} />)} />
      <Route path="/organiser/swaps" element={protect(currentRole, ['ORGANISER'], <SwapWorkspace role="ORGANISER" swapId={swapId} />)} />
      <Route path="/organiser/scenarios" element={protect(currentRole, ['ORGANISER'], <ScenarioPlanning />)} />
      <Route path="/organiser/proposals" element={protect(currentRole, ['ORGANISER'], <ProposalLab />)} />
      <Route path="/student/availability" element={protect(currentRole, ['STUDENT'], <MutualAvailability />)} />
      <Route path="/student/timetable" element={protect(currentRole, ['STUDENT'], <MyTimetable role="STUDENT" bookingId={bookingId} />)} />
      <Route
        path="/student"
        element={protect(currentRole, ['STUDENT'], <StudentOverflow studentName={user?.data?.profile?.fullName ?? null} />)}
      />
      <Route
        path="/settings"
        element={protect(currentRole, ['ORGANISER', 'TUTOR', 'STUDENT'], <AccountSettings />)}
      />

      <Route path="/tutor/courses/:targetId" element={protect(currentRole, ['TUTOR'], <TargetGate targetType="course" />)} />
      <Route path="/student/courses/:targetId" element={protect(currentRole, ['STUDENT'], <TargetGate targetType="course" />)} />
      <Route path="/organiser/timesheets/:targetId" element={protect(currentRole, ['ORGANISER'], <TargetGate targetType="timesheet" />)} />
      <Route path="/tutor/forms/timesheets/:targetId" element={protect(currentRole, ['TUTOR'], <TargetGate targetType="timesheet" />)} />
      <Route path="/student/volunteer/:targetId" element={protect(currentRole, ['STUDENT'], <TargetGate targetType="volunteer" />)} />
      <Route path="/access-denied" element={<AccessDeniedPage />} />
      <Route path="*" element={<Navigate to={entryPath || '/access-denied'} replace />} />
    </Routes>
  )

  // The organiser works inside a sidebar layout; tutors and students keep the top navigation.
  if (currentRole === 'ORGANISER') {
    return (
      <>
        <SkipToContent />
        <OrganiserShell user={user} onSignOut={onSignOut} isMasterOrganiser={isMasterOrganiser}>
          {routes}
        </OrganiserShell>
      </>
    )
  }

  if (currentRole === 'TUTOR' || currentRole === 'STUDENT') {
    return (
      <>
        <SkipToContent />
        <RoleWorkspaceShell role={currentRole} user={user} onSignOut={onSignOut}>
          {routes}
        </RoleWorkspaceShell>
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
