import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { RoleRouter } from './RoleRouter'

const getAccessTokenSilently = vi.fn()

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    isAuthenticated: true,
    isLoading: false,
    getAccessTokenSilently,
  }),
}))

vi.mock('../api/studentOverflow', () => ({
  getStudentOverflowWork: vi.fn().mockResolvedValue([]),
}))

vi.mock('../api/studentVolunteer', () => ({
  getVolunteerRequests: vi.fn().mockResolvedValue([]),
  volunteerForWork: vi.fn(),
}))

vi.mock('../api/publicHolidays', () => ({
  getPublicHolidays: vi.fn().mockResolvedValue({
    source: 'fallback',
    holidays: [],
    retrievedAt: null,
  }),
}))

vi.mock('../api/organiser', () => ({
  listCourses: vi.fn().mockResolvedValue([]),
  createCourse: vi.fn(),
  updateCourse: vi.fn(),
  deleteCourse: vi.fn(),
  listTutors: vi.fn().mockResolvedValue([]),
  createTutor: vi.fn(),
  updateTutor: vi.fn(),
  listAllocations: vi.fn().mockResolvedValue([]),
  listAllocationCandidates: vi.fn().mockResolvedValue([]),
  listOrganiserApprovals: vi
    .fn()
    .mockResolvedValue({ timesheets: [], volunteerClaims: [], excuses: [] }),
  decideTimesheet: vi.fn(),
  decideVolunteerClaim: vi.fn(),
  decideExcuse: vi.fn(),
  listTimesheetDisputes: vi.fn().mockResolvedValue([]),
  resolveTimesheetDispute: vi.fn(),
  listStaffingRequirements: vi.fn().mockResolvedValue([]),
  getWorkloadReport: vi.fn().mockResolvedValue({
    period: { weekStart: '2026-09-14T00:00:00.000Z', weekEnd: '2026-09-21T00:00:00.000Z', weeks: 1 },
    courses: [],
    tutors: [],
  }),
}))

vi.mock('../api/tutorDashboard', () => ({
  fetchTutorDashboard: () =>
    Promise.resolve({ allocations: [], weeklyLimit: 10, usedHours: 0, remainingHours: 10 }),
}))

function renderRole(currentRole, path = '/', onSignOut = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/*" element={<RoleRouter currentRole={currentRole} onSignOut={onSignOut} />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RoleRouter', () => {
  it('opens the ORGANISER entry route after sign in', () => {
    renderRole('ORGANISER')
    expect(screen.getByRole('heading', { name: 'Organiser workspace' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /quick actions/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /allocate a tutor/i })).toBeInTheDocument()
  })

  it('opens the STUDENT entry route after sign in', async () => {
    renderRole('STUDENT')
    expect(
      await screen.findByRole('heading', { name: /available volunteer work/i }),
    ).toBeInTheDocument()
  })

  it('opens the TUTOR entry route after sign in', async () => {
    renderRole('TUTOR')
    expect(await screen.findByRole('heading', { name: /tutor dashboard/i })).toBeInTheDocument()
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
      await screen.findByRole('heading', { name: /forms and submissions/i }),
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
    const navigation = screen.getByRole('navigation', { name: /primary navigation/i })
    expect(within(navigation).getByRole('link', { name: /^home$/i })).toHaveAttribute('href', '/organiser')
    expect(screen.getByRole('link', { name: /account settings/i })).toBeInTheDocument()
  })


  it('shows sign out for students and tutors', () => {
    const tutorSignOut = vi.fn()
    const { unmount } = render(
      <MemoryRouter initialEntries={['/tutor']}>
        <Routes>
          <Route path="/*" element={<RoleRouter currentRole="TUTOR" onSignOut={tutorSignOut} />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    expect(tutorSignOut).toHaveBeenCalledTimes(1)
    unmount()

    renderRole('STUDENT', '/student')
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('signs an organiser out from the organiser workspace', () => {
    const organiserSignOut = vi.fn()
    render(
      <MemoryRouter initialEntries={['/organiser']}>
        <Routes>
          <Route
            path="/*"
            element={<RoleRouter currentRole="ORGANISER" onSignOut={organiserSignOut} />}
          />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    expect(organiserSignOut).toHaveBeenCalledTimes(1)
  })

  it('shows the organiser management links only to an organiser', () => {
    renderRole('ORGANISER')

    const navigation = screen.getByRole('navigation', { name: /primary navigation/i })
    expect(within(navigation).getByRole('link', { name: /^courses$/i })).toBeInTheDocument()
    expect(within(navigation).getByRole('link', { name: /^tutors$/i })).toBeInTheDocument()
    expect(within(navigation).getByRole('link', { name: /^reports$/i })).toBeInTheDocument()
    // Approvals, staffing and overflow are part of Home, each with its own full page behind it.
    expect(screen.getByRole('link', { name: /see all approvals/i })).toHaveAttribute('href', '/organiser/approvals')
    expect(screen.getByRole('link', { name: /see all staffing requirements/i })).toHaveAttribute('href', '/organiser/staffing')
    expect(screen.getByRole('link', { name: /post overflow work/i })).toHaveAttribute('href', '/organiser/overflow#overflow-form-heading')
    expect(screen.getByRole('link', { name: /start bulk allocation/i })).toHaveAttribute('href', '/organiser/staffing/bulk')
  })

  it('hides the organiser management links from a tutor', () => {
    renderRole('TUTOR', '/tutor')

    expect(screen.queryByRole('link', { name: /^courses$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^tutors$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^approvals$/i })).not.toBeInTheDocument()
  })

  it('hides the organiser management links from a student', () => {
    renderRole('STUDENT', '/student')

    expect(screen.queryByRole('link', { name: /^courses$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^tutors$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^approvals$/i })).not.toBeInTheDocument()
  })

  it('opens course management for an organiser', () => {
    renderRole('ORGANISER', '/organiser/courses')

    expect(screen.getByRole('heading', { name: 'Course management' })).toBeInTheDocument()
  })

  it('opens tutor management for an organiser', () => {
    renderRole('ORGANISER', '/organiser/tutors')

    expect(screen.getByRole('heading', { name: 'Tutor management' })).toBeInTheDocument()
  })

  it('opens the approval queues for an organiser', async () => {
    renderRole('ORGANISER', '/organiser/approvals')

    expect(await screen.findByRole('heading', { name: 'Approvals' })).toBeInTheDocument()
  })

  it('opens the reports screen for an organiser', async () => {
    renderRole('ORGANISER', '/organiser/reports')

    expect(await screen.findByRole('heading', { name: 'Reports' })).toBeInTheDocument()
  })

  it('keeps reports away from a tutor', () => {
    renderRole('TUTOR', '/organiser/reports')

    expect(screen.getByRole('heading', { name: /access denied/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Reports' })).not.toBeInTheDocument()
  })

  it('puts Reports in the organiser sidebar', () => {
    renderRole('ORGANISER', '/organiser')

    const navigation = screen.getByRole('navigation', { name: /primary navigation/i })
    expect(within(navigation).getByRole('link', { name: 'Reports' })).toHaveAttribute(
      'href',
      '/organiser/reports',
    )
  })

  it('keeps Home highlighted on the pages that open from Home', async () => {
    renderRole('ORGANISER', '/organiser/approvals')

    expect(await screen.findByRole('heading', { name: 'Approvals' })).toBeInTheDocument()
    const navigation = screen.getByRole('navigation', { name: /primary navigation/i })
    expect(within(navigation).getByRole('link', { name: /^home$/i })).toHaveClass('active')
    expect(within(navigation).getByRole('link', { name: /^courses$/i })).not.toHaveClass('active')
  })

  it('opens and closes the organiser menu on narrow screens', () => {
    renderRole('ORGANISER')

    const menuButton = screen.getByRole('button', { name: /^menu$/i })
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    expect(menuButton).toHaveAttribute('aria-controls', 'organiser-sidebar')
    fireEvent.click(menuButton)
    expect(screen.getByRole('button', { name: /close menu/i })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('button', { name: /^menu$/i })).toHaveAttribute('aria-expanded', 'false')
  })

  it('greets the organiser by the name on their profile', () => {
    render(
      <MemoryRouter initialEntries={['/organiser/courses']}>
        <Routes>
          <Route
            path="/*"
            element={(
              <RoleRouter
                currentRole="ORGANISER"
                onSignOut={vi.fn()}
                user={{ data: { profile: { fullName: 'Naledi Mokoena', role: 'ORGANISER' } } }}
              />
            )}
          />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Welcome back')).toBeInTheDocument()
    expect(screen.getByText('Naledi Mokoena')).toBeInTheDocument()
  })

  it('keeps the tutor and student top navigation unchanged', () => {
    renderRole('TUTOR', '/tutor')

    expect(screen.queryByRole('link', { name: /start bulk allocation/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /tutor workspace/i })).toBeInTheDocument()
  })

  it('keeps course management away from a tutor', () => {
    renderRole('TUTOR', '/organiser/courses')

    expect(screen.getByRole('heading', { name: /access denied/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Course management' })).not.toBeInTheDocument()
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
