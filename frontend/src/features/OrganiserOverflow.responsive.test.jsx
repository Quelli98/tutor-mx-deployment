import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OrganiserOverflow from './OrganiserOverflow'

const listOrganiserOverflowWork = vi.fn()
const createOrganiserOverflowWork = vi.fn()
const updateOrganiserOverflowWork = vi.fn()
const closeOrganiserOverflowWork = vi.fn()
const listCourses = vi.fn()
const listStaffingRequirements = vi.fn()
const getAccessTokenSilently = vi.fn()

vi.mock('../api/organiserOverflow', () => ({
  listOrganiserOverflowWork: (...args) => listOrganiserOverflowWork(...args),
  createOrganiserOverflowWork: (...args) => createOrganiserOverflowWork(...args),
  updateOrganiserOverflowWork: (...args) => updateOrganiserOverflowWork(...args),
  closeOrganiserOverflowWork: (...args) => closeOrganiserOverflowWork(...args),
}))

vi.mock('../api/organiser', () => ({
  listCourses: (...args) => listCourses(...args),
  listStaffingRequirements: (...args) => listStaffingRequirements(...args),
}))

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently }),
}))

const openWork = {
  id: 4,
  courseId: 3,
  courseCode: 'COMS3011',
  courseName: 'Software Design Project',
  startsAt: '2030-09-04T14:00:00.000Z',
  endsAt: '2030-09-04T18:00:00.000Z',
  hours: 4,
  windowHours: 4,
  status: 'OPEN',
  closesAt: null,
  sourceRequirementId: 12,
  pendingClaims: 0,
  acceptedClaims: 0,
  createdAt: '2026-09-20T09:00:00.000Z',
  updatedAt: '2026-09-23T09:00:00.000Z',
}

const requirement = {
  id: 12,
  courseId: 3,
  courseCode: 'COMS3011',
  courseName: 'Software Design Project',
  startsAt: '2030-09-04T14:00:00.000Z',
  endsAt: '2030-09-04T18:00:00.000Z',
  tutorsNeeded: 2,
  windowHours: 4,
  requiredHours: 8,
  assignedHours: 5,
  shortageHours: 3,
  shortageTutors: 1,
  fillState: 'partially-filled',
  status: 'OPEN',
  notes: null,
  createdById: 8,
  createdAt: '2026-09-21T09:00:00.000Z',
  updatedAt: '2026-09-21T09:00:00.000Z',
}

// jsdom has no layout engine, so these checks assert the agreed structure at
// each width: the primary action stays rendered, and both data tables live
// inside their own keyboard-reachable scroll containers (.table-scroll with
// overflow-x), so a narrow screen scrolls the region instead of the page.
describe('OrganiserOverflow across common screen widths', () => {
  beforeEach(() => {
    listOrganiserOverflowWork.mockReset().mockResolvedValue([openWork])
    createOrganiserOverflowWork.mockReset()
    updateOrganiserOverflowWork.mockReset()
    closeOrganiserOverflowWork.mockReset()
    listCourses
      .mockReset()
      .mockResolvedValue([
        { id: 3, code: 'COMS3011', name: 'Software Design Project' },
      ])
    listStaffingRequirements.mockReset().mockResolvedValue([requirement])
    getAccessTokenSilently.mockReset()
  })

  it.each([360, 768, 1280])(
    'keeps the primary action and the scroll regions available at %ipx',
    async (width) => {
      window.innerWidth = width
      window.dispatchEvent(new Event('resize'))

      const { container } = render(
        <MemoryRouter>
          <OrganiserOverflow />
        </MemoryRouter>,
      )

      expect(
        await screen.findByRole('button', { name: /^post overflow work$/i }),
      ).toBeVisible()
      expect(
        screen.getByRole('heading', { name: /^post overflow work$/i }),
      ).toBeVisible()

      expect(
        await screen.findByRole('table', {
          name: /student volunteer opportunities/i,
        }),
      ).toBeVisible()
      expect(
        screen.getByRole('table', { name: /still unfilled/i }),
      ).toBeVisible()

      const scrollRegions = container.querySelectorAll('.table-scroll')
      expect(scrollRegions).toHaveLength(2)
      scrollRegions.forEach((region) => {
        expect(region).toHaveAttribute('tabindex', '0')
        expect(region).toHaveAttribute('aria-label')
      })
    },
  )
})
