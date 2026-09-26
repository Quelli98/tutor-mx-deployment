import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OrganiserDashboard from './OrganiserDashboard'
import { addDays, localMonday } from '../components/shared/scheduleWeek'
import { allocationReasonCodesFor, busySlotClashes } from '../../../src/services/allocation-queries'

const listCourses = vi.fn()
const listAllocationCandidates = vi.fn()
const listAllocations = vi.fn()
const createAllocation = vi.fn()
const updateAllocation = vi.fn()
const removeAllocation = vi.fn()
const listOrganiserApprovals = vi.fn()
const listTimesheetDisputes = vi.fn()
const listStaffingRequirements = vi.fn()
const listTutors = vi.fn()
const getWorkloadReport = vi.fn()
const getAccessTokenSilently = vi.fn()

vi.mock('../api/organiser', async (importOriginal) => ({
  ...(await importOriginal()),
  listCourses: (...args) => listCourses(...args),
  listAllocationCandidates: (...args) => listAllocationCandidates(...args),
  listAllocations: (...args) => listAllocations(...args),
  createAllocation: (...args) => createAllocation(...args),
  updateAllocation: (...args) => updateAllocation(...args),
  removeAllocation: (...args) => removeAllocation(...args),
  listOrganiserApprovals: (...args) => listOrganiserApprovals(...args),
  listTimesheetDisputes: (...args) => listTimesheetDisputes(...args),
  listStaffingRequirements: (...args) => listStaffingRequirements(...args),
  listTutors: (...args) => listTutors(...args),
  getWorkloadReport: (...args) => getWorkloadReport(...args),
}))

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently }),
}))

const courses = [{ id: 3, code: 'COMS3011', name: 'Software Design Project' }]
const eligibleCandidate = {
  tutorId: 7,
  fullName: 'Boundary Tutor',
  mark: 65,
  weeklyLimit: 10,
  usedHours: 4,
  remainingHours: 6,
  hasClash: false,
  isEligible: true,
  reasonCodes: [],
  clashDetails: [],
  markBand: 60,
  capacityShare: 0.4,
}
const ineligibleCandidate = {
  tutorId: 8,
  fullName: 'Blocked Tutor',
  mark: 60,
  weeklyLimit: 5,
  usedHours: 4,
  remainingHours: 1,
  hasClash: true,
  isEligible: false,
  reasonCodes: ['insufficient-mark', 'schedule-clash', 'hour-limit-exceeded'],
  clashDetails: [
    {
      kind: 'busy',
      label: 'COMS3011A Lecture',
      startsAt: '2030-09-03T14:00:00.000Z',
      endsAt: '2030-09-03T16:00:00.000Z',
      recurrence: 'WEEKLY',
    },
  ],
}
// Home opens on the current week, so the allocation is on this week's Wednesday afternoon.
const thisWednesday = addDays(localMonday(new Date()), 2)
const allocation = {
  id: 11,
  tutorId: 7,
  tutorName: 'Boundary Tutor',
  tutorEmail: 'boundary@tutormx.example',
  courseId: 3,
  courseCode: 'COMS3011',
  courseName: 'Software Design Project',
  startsAt: new Date(thisWednesday.valueOf() + 14 * 3_600_000).toISOString(),
  endsAt: new Date(thisWednesday.valueOf() + 16 * 3_600_000).toISOString(),
  allocatedHours: 2,
  status: 'CONFIRMED',
}

function quietHomeData() {
  listOrganiserApprovals.mockReset().mockResolvedValue({ timesheets: [], volunteerClaims: [], excuses: [] })
  listTimesheetDisputes.mockReset().mockResolvedValue([])
  listStaffingRequirements.mockReset().mockResolvedValue([])
  listTutors.mockReset().mockResolvedValue([])
  getWorkloadReport.mockReset().mockResolvedValue({
    period: { weekStart: '2030-09-02', weekEnd: '2030-09-09', weeks: 1 },
    courses: [],
    tutors: [],
  })
}

// The allocation board lives in a panel that opens from the "Allocate a tutor" tile on Home.
async function openBoard() {
  render(<OrganiserDashboard />, { wrapper: MemoryRouter })
  fireEvent.click(screen.getByRole('button', { name: /allocate a tutor/i }))
  await screen.findByRole('option', { name: /COMS3011/i })
}

function fillBoard() {
  fireEvent.change(screen.getByLabelText(/^course$/i), { target: { value: '3' } })
  fireEvent.change(screen.getByLabelText(/session starts/i), {
    target: { value: '2030-09-04T14:00' },
  })
  fireEvent.change(screen.getByLabelText(/session ends/i), {
    target: { value: '2030-09-04T16:00' },
  })
}

describe('OrganiserDashboard', () => {
  beforeEach(() => {
    listCourses.mockReset()
    listAllocationCandidates.mockReset()
    listAllocations.mockReset().mockResolvedValue([])
    createAllocation.mockReset().mockResolvedValue({ id: 11 })
    updateAllocation.mockReset().mockResolvedValue({ id: 11 })
    removeAllocation.mockReset().mockResolvedValue(undefined)
    getAccessTokenSilently.mockReset()
    quietHomeData()
  })

  it('keeps the board visible while courses load and explains an empty course list', async () => {
    let resolveCourses
    listCourses.mockReturnValue(
      new Promise((resolve) => {
        resolveCourses = resolve
      }),
    )

    render(<OrganiserDashboard />, { wrapper: MemoryRouter })
    fireEvent.click(screen.getByRole('button', { name: /allocate a tutor/i }))

    const panel = screen.getByRole('dialog', { name: /allocate a tutor/i })
    expect(within(panel).getByRole('heading', { name: /loading courses/i })).toBeInTheDocument()

    resolveCourses([])
    expect(await within(panel).findByRole('heading', { name: /no courses yet/i })).toBeInTheDocument()
  })

  it('opens the allocation board as a panel over Home and closes it again', async () => {
    listCourses.mockResolvedValue(courses)
    render(<OrganiserDashboard />, { wrapper: MemoryRouter })

    // Home first: the board is one click away rather than filling the page.
    expect(screen.getByRole('heading', { name: /quick actions/i })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const opener = screen.getByRole('button', { name: /allocate a tutor/i })
    fireEvent.click(opener)
    const panel = await screen.findByRole('dialog', { name: /allocate a tutor/i })
    expect(within(panel).getByRole('heading', { name: /^allocate a tutor$/i })).toHaveFocus()
    // The page behind the panel is hidden from assistive technology while it is open.
    expect(screen.queryByRole('heading', { name: /quick actions/i })).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: /quick actions/i })).toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('fills the board from an open staffing requirement', async () => {
    listCourses.mockResolvedValue(courses)
    const monday = new Date()
    monday.setHours(0, 0, 0, 0)
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
    const startsAt = new Date(monday.valueOf() + 24 * 3_600_000 + 14 * 3_600_000)
    const endsAt = new Date(startsAt.valueOf() + 2 * 3_600_000)
    listStaffingRequirements.mockResolvedValue([
      {
        id: 4,
        courseId: 3,
        courseCode: 'COMS3011',
        courseName: 'Software Design Project',
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        tutorsNeeded: 3,
        windowHours: 2,
        requiredHours: 6,
        assignedHours: 2,
        shortageHours: 4,
        shortageTutors: 2,
        fillState: 'partially-filled',
        status: 'OPEN',
        notes: null,
        createdById: 1,
        createdAt: '2030-01-01T00:00:00.000Z',
        updatedAt: '2030-01-01T00:00:00.000Z',
      },
    ])
    render(<OrganiserDashboard />, { wrapper: MemoryRouter })

    expect(await screen.findByText('2 short')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /allocate a tutor to COMS3011/i }))

    const panel = await screen.findByRole('dialog', { name: /allocate a tutor/i })
    await within(panel).findByRole('option', { name: /COMS3011/i })
    expect(within(panel).getByLabelText(/^course$/i)).toHaveValue('3')
    expect(within(panel).getByLabelText(/session starts/i)).not.toHaveValue('')
    expect(within(panel).getByLabelText(/required hours/i)).toHaveValue(2)
  })

  it('checks candidates on the same page and shows all three written rule results', async () => {
    listCourses.mockResolvedValue(courses)
    listAllocationCandidates.mockResolvedValue([eligibleCandidate, ineligibleCandidate])

    await openBoard()
    fillBoard()
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))

    const blockedCard = await screen.findByRole('heading', { name: 'Blocked Tutor' })
    const blockedArticle = blockedCard.closest('article')
    expect(within(blockedArticle).getByText(/mark: fail/i)).toBeInTheDocument()
    expect(within(blockedArticle).getByText(/availability: fail/i)).toBeInTheDocument()
    expect(within(blockedArticle).getByText(/capacity: fail/i)).toBeInTheDocument()
    expect(within(blockedArticle).getByText(/1 hours of capacity remain; 2 hours are required/i)).toBeInTheDocument()

    const boundaryCard = screen.getByRole('heading', { name: 'Boundary Tutor' }).closest('article')
    expect(within(boundaryCard).getByText(/mark: pass/i)).toBeInTheDocument()
    expect(within(boundaryCard).getByText(/65% meets the required 65%/i)).toBeInTheDocument()

    expect(listAllocationCandidates).toHaveBeenCalledWith(
      {
        courseId: 3,
        startsAt: new Date('2030-09-04T14:00').toISOString(),
        endsAt: new Date('2030-09-04T16:00').toISOString(),
        minimumMark: 65,
        requestedHours: 2,
      },
      getAccessTokenSilently,
    )
  })

  it('puts Monday 08:00–10:45 under Eligible tutors for the exact seven busy blocks', async () => {
    const busy = [
      ['14', '14:15', '17:00'], ['15', '14:15', '17:00'], ['16', '08:00', '09:45'],
      ['17', '08:00', '09:45'], ['17', '10:15', '12:00'], ['18', '10:15', '12:00'], ['18', '12:30', '13:15'],
    ]
    listCourses.mockResolvedValue(courses)
    listAllocationCandidates.mockImplementation(async (input) => {
      const hasClash = busy.some(([day, start, end]) => busySlotClashes(
        new Date(`2026-09-${day}T${start}`), new Date(`2026-09-${day}T${end}`), 'WEEKLY', new Date(input.startsAt), new Date(input.endsAt),
      ))
      const reasonCodes = allocationReasonCodesFor({ mark: 90, minimumMark: input.minimumMark, hasClash, remainingHours: 15, requestedHours: input.requestedHours })
      return [{ ...eligibleCandidate, mark: 90, weeklyLimit: 15, usedHours: 0, remainingHours: 15, hasClash, reasonCodes, isEligible: reasonCodes.length === 0 }]
    })
    await openBoard()
    fillBoard()
    fireEvent.change(screen.getByLabelText(/session starts/i), { target: { value: '2026-09-14T08:00' } })
    fireEvent.change(screen.getByLabelText(/session ends/i), { target: { value: '2026-09-14T10:45' } })
    fireEvent.change(screen.getByLabelText(/required hours/i), { target: { value: '2.75' } })
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))
    expect(await screen.findByRole('heading', { name: /^eligible tutors$/i })).toBeVisible()
    const card = screen.getByRole('heading', { name: 'Boundary Tutor' }).closest('article')
    for (const rule of ['Mark: Pass', 'Availability: Pass', 'Capacity: Pass']) expect(within(card).getByText(rule)).toBeVisible()
    expect(within(card).getByRole('button', { name: /select/i })).toBeEnabled()
    expect(screen.queryByRole('heading', { name: /^not eligible$/i })).not.toBeInTheDocument()
  })

  it.each([
    ['schedule-clash', 'Availability: Fail', { hasClash: true, clashDetails: [{ kind: 'busy', label: 'COMS3011 Lecture', startsAt: new Date('2026-09-17T08:00').toISOString(), endsAt: new Date('2026-09-17T09:45').toISOString(), recurrence: 'ONCE' }] }],
    ['hour-limit-exceeded', 'Capacity: Fail', { remainingHours: 1 }],
    ['insufficient-mark', 'Mark: Fail', { mark: 50 }],
  ])('shows %s separately and never offers a failed tutor selection', async (reason, text, overrides) => {
    listCourses.mockResolvedValue(courses)
    listAllocationCandidates.mockResolvedValue([{ ...eligibleCandidate, ...overrides, isEligible: false, reasonCodes: [reason] }])
    await openBoard()
    fillBoard()
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))
    expect(await screen.findByRole('heading', { name: /^not eligible$/i })).toBeVisible()
    expect(screen.getByText(text)).toBeVisible()
    expect(screen.queryByRole('button', { name: /select Boundary Tutor/i })).not.toBeInTheDocument()
    if (reason === 'schedule-clash') {
      expect(screen.getByText('Overlaps COMS3011 Lecture, Thursday 08:00–09:45.')).toBeVisible()
      expect(screen.getByText('Mark: Pass')).toBeVisible()
      expect(screen.getByText('Capacity: Pass')).toBeVisible()
    } else expect(screen.getByText('Availability: Pass')).toBeVisible()
  })

  it('explains missing course marks without blaming availability', async () => {
    listCourses.mockResolvedValue(courses)
    listAllocationCandidates.mockResolvedValue([])
    await openBoard()
    fillBoard()
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))
    expect(await screen.findByRole('heading', { name: 'No tutors have marks recorded for this course yet.' })).toBeVisible()
    expect(screen.getByText('Add a course mark in Tutor Management before checking allocation eligibility.')).toBeVisible()
    expect(screen.queryByText(/availability: fail/i)).not.toBeInTheDocument()
  })

  it('explains a missing hour limit instead of showing an unexplained zero', async () => {
    listCourses.mockResolvedValue(courses)
    listAllocationCandidates.mockResolvedValue([
      {
        ...ineligibleCandidate,
        weeklyLimit: 0,
        remainingHours: 0,
        reasonCodes: ['hour-limit-exceeded'],
      },
    ])

    await openBoard()
    fillBoard()
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))

    expect(await screen.findByText(/weekly work capacity not set; set it before allocating 2 hours/i)).toBeInTheDocument()
    expect(screen.queryByText(/0 hours remain/i)).not.toBeInTheDocument()
  })

  it('creates an allocation only after an eligible tutor is selected and refreshes the board', async () => {
    listCourses.mockResolvedValue(courses)
    listAllocationCandidates.mockResolvedValue([eligibleCandidate, ineligibleCandidate])

    await openBoard()
    fillBoard()
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))

    const saveButton = await screen.findByRole('button', { name: /save allocation/i })
    expect(saveButton).toBeDisabled()
    expect(screen.queryByRole('button', { name: /select Blocked Tutor/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /select Boundary Tutor/i }))
    expect(saveButton).toBeEnabled()
    fireEvent.click(saveButton)
    await waitFor(() => {
      expect(createAllocation).toHaveBeenCalledWith(
        {
          tutorId: 7,
          courseId: 3,
          startsAt: new Date('2030-09-04T14:00').toISOString(),
          endsAt: new Date('2030-09-04T16:00').toISOString(),
          minimumMark: 65,
          requestedHours: 2,
          status: 'CONFIRMED',
        },
        getAccessTokenSilently,
      )
    })
    expect(await screen.findByText(/was allocated and weekly hours were refreshed/i)).toBeInTheDocument()
    expect(listAllocations).toHaveBeenCalledTimes(2)
    expect(listAllocationCandidates).toHaveBeenCalledTimes(2)
  })

  it('shows field-level validation and sends no invalid request', async () => {
    listCourses.mockResolvedValue(courses)

    await openBoard()
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))

    expect(screen.getByLabelText(/^course$/i)).toHaveAccessibleDescription(/select a course/i)
    expect(screen.getByLabelText(/session starts/i)).toHaveAccessibleDescription(/valid start/i)
    expect(screen.getByLabelText(/session ends/i)).toHaveAccessibleDescription(/valid end/i)
    expect(listAllocationCandidates).not.toHaveBeenCalled()
  })

  it('provides a logical keyboard focus order from the panel heading into the labelled course selector', async () => {
    const user = userEvent.setup()
    listCourses.mockResolvedValue(courses)

    await openBoard()
    const courseSelect = screen.getByLabelText(/^course$/i)
    await waitFor(() => expect(courseSelect).not.toBeDisabled())
    // Opening the panel puts focus on its heading; then the close button, then the board.
    expect(screen.getByRole('heading', { name: /^allocate a tutor$/i })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: /close allocate a tutor/i })).toHaveFocus()
    await user.tab()
    expect(courseSelect).toHaveFocus()
  })

  it('explains candidate errors and allows a retry', async () => {
    listCourses.mockResolvedValue(courses)
    listAllocationCandidates
      .mockRejectedValueOnce(Object.assign(new Error('private detail'), { code: 'REQUEST_FAILED' }))
      .mockResolvedValueOnce([])

    await openBoard()
    fillBoard()
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))

    expect(await screen.findByRole('heading', { name: /candidates unavailable/i })).toBeInTheDocument()
    expect(screen.queryByText(/private detail/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    await waitFor(() => expect(listAllocationCandidates).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('heading', { name: /no tutors have marks recorded for this course yet/i })).toBeInTheDocument()
  })

  it('edits an allocation with the current row excluded from server checks', async () => {
    listCourses.mockResolvedValue(courses)
    listAllocations.mockResolvedValue([allocation])
    listAllocationCandidates.mockResolvedValue([eligibleCandidate])

    render(<OrganiserDashboard />, { wrapper: MemoryRouter })
    fireEvent.click(await screen.findByRole('button', { name: /^boundary tutor, COMS3011.*edit or remove$/i }))
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))

    await waitFor(() => {
      expect(listAllocationCandidates).toHaveBeenCalledWith(
        expect.objectContaining({ excludeAllocationId: 11, courseId: 3, requestedHours: 2 }),
        getAccessTokenSilently,
      )
    })
    const updateButton = await screen.findByRole('button', { name: /update allocation/i })
    expect(updateButton).toBeEnabled()
    fireEvent.click(updateButton)
    await waitFor(() => {
      expect(updateAllocation).toHaveBeenCalledWith(
        expect.objectContaining({ allocationId: 11, tutorId: 7, status: 'CONFIRMED' }),
        getAccessTokenSilently,
      )
    })
  })

  it('removes an allocation from its panel after confirmation and refreshes the list', async () => {
    listCourses.mockResolvedValue(courses)
    listAllocations.mockResolvedValueOnce([allocation]).mockResolvedValueOnce([])

    render(<OrganiserDashboard />, { wrapper: MemoryRouter })
    fireEvent.click(await screen.findByRole('button', { name: /^boundary tutor, COMS3011.*edit or remove$/i }))
    const panel = screen.getByRole('dialog', { name: /edit allocation/i })
    const current = within(panel).getByRole('region', { name: /this allocation/i })
    expect(current).toHaveTextContent('boundary@tutormx.example')
    expect(within(current).getByText(/^COMS3011 · .*, 14:00 – 16:00$/)).toBeInTheDocument()
    expect(within(current).getByText(/^2\sh · Confirmed$/)).toBeInTheDocument()

    // The panel closes, so the confirmation opens over Home rather than behind the panel.
    fireEvent.click(within(current).getByRole('button', { name: /remove allocation/i }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /edit allocation/i })).not.toBeInTheDocument())
    expect(screen.getByRole('dialog')).toHaveTextContent(/weekly hours will be released/i)
    fireEvent.click(screen.getByRole('button', { name: /remove allocation/i }))

    await waitFor(() => {
      expect(removeAllocation).toHaveBeenCalledWith(11, getAccessTokenSilently)
    })
    expect(await screen.findByText(/allocation was removed/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /no active allocations/i })).toBeInTheDocument()
  })

  it('shows a server-side rule refusal and refreshes candidate state', async () => {
    listCourses.mockResolvedValue(courses)
    listAllocationCandidates
      .mockResolvedValueOnce([eligibleCandidate])
      .mockResolvedValueOnce([{ ...eligibleCandidate, isEligible: false, reasonCodes: ['insufficient-mark'] }])
    createAllocation.mockRejectedValue(
      Object.assign(new Error('The tutor no longer meets the required mark.'), {
        code: 'insufficient-mark',
      }),
    )

    await openBoard()
    fillBoard()
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))
    fireEvent.click(await screen.findByRole('button', { name: /select Boundary Tutor/i }))
    fireEvent.click(screen.getByRole('button', { name: /save allocation/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer meets the required mark/i)
    expect(listAllocationCandidates).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: /select Boundary Tutor/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^not eligible$/i })).toBeInTheDocument()
  })

  it('passes the new allocation ID as excludeAllocationId when refreshing after create', async () => {
    listCourses.mockResolvedValue(courses)
    listAllocationCandidates.mockResolvedValue([eligibleCandidate])
    createAllocation.mockResolvedValue({ id: 99 })

    await openBoard()
    fillBoard()
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))
    fireEvent.click(await screen.findByRole('button', { name: /select Boundary Tutor/i }))
    fireEvent.click(screen.getByRole('button', { name: /save allocation/i }))

    await waitFor(() => {
      expect(createAllocation).toHaveBeenCalled()
    })
    await waitFor(() => {
      const refreshCall = listAllocationCandidates.mock.calls.find(
        (call) => call[0]?.excludeAllocationId === 99,
      )
      expect(refreshCall).toBeTruthy()
    })
  })

  it('passes the allocation ID as excludeAllocationId when refreshing after update', async () => {
    listCourses.mockResolvedValue(courses)
    listAllocations.mockResolvedValue([allocation])
    listAllocationCandidates.mockResolvedValue([eligibleCandidate])

    render(<OrganiserDashboard />, { wrapper: MemoryRouter })
    fireEvent.click(await screen.findByRole('button', { name: /^boundary tutor, COMS3011.*edit or remove$/i }))
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))
    fireEvent.click(await screen.findByRole('button', { name: /update allocation/i }))

    await waitFor(() => {
      expect(updateAllocation).toHaveBeenCalled()
    })
    await waitFor(() => {
      const refreshCall = listAllocationCandidates.mock.calls.find(
        (call) => call[0]?.excludeAllocationId === 11,
      )
      expect(refreshCall).toBeTruthy()
    })
  })

  it('shows "No tutors currently available" under Eligible tutors when all candidates are ineligible', async () => {
    listCourses.mockResolvedValue(courses)
    listAllocationCandidates.mockResolvedValue([ineligibleCandidate])

    await openBoard()
    fillBoard()
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))

    expect(await screen.findByRole('heading', { name: /^eligible tutors$/i })).toBeVisible()
    expect(screen.getByText(/no tutors currently available/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^not eligible$/i })).toBeVisible()
  })

  it('keeps the saved tutor eligible after refresh (no self-conflict)', async () => {
    listCourses.mockResolvedValue(courses)
    listAllocationCandidates
      .mockResolvedValueOnce([eligibleCandidate])
      .mockResolvedValueOnce([eligibleCandidate])
    createAllocation.mockResolvedValue({ id: 99 })

    await openBoard()
    fillBoard()
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))
    fireEvent.click(await screen.findByRole('button', { name: /select Boundary Tutor/i }))
    fireEvent.click(screen.getByRole('button', { name: /save allocation/i }))

    expect(await screen.findByText(/was allocated and weekly hours were refreshed/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^eligible tutors$/i })).toBeVisible()
    const selectButton = screen.getByRole('button', { name: /^selected$/i })
    expect(selectButton).toBeEnabled()
    expect(selectButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText(/availability: fail/i)).not.toBeInTheDocument()
  })

  it('shows "No tutors found" only when there are zero candidates total', async () => {
    listCourses.mockResolvedValue(courses)
    listAllocationCandidates.mockResolvedValue([])

    await openBoard()
    fillBoard()
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))

    expect(await screen.findByText(/no tutors have marks recorded for this course yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^eligible tutors$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^not eligible$/i })).not.toBeInTheDocument()
  })
})

describe('OrganiserDashboard candidate ranking', () => {
  beforeEach(() => {
    listCourses.mockReset().mockResolvedValue(courses)
    listAllocationCandidates.mockReset()
    listAllocations.mockReset().mockResolvedValue([])
    createAllocation.mockReset().mockResolvedValue({ id: 11 })
    updateAllocation.mockReset().mockResolvedValue({ id: 11 })
    removeAllocation.mockReset().mockResolvedValue(undefined)
    getAccessTokenSilently.mockReset()
    quietHomeData()
  })

  const ranked = [
    {
      ...eligibleCandidate,
      tutorId: 7,
      fullName: 'Freer Tutor',
      mark: 84,
      weeklyLimit: 10,
      usedHours: 2,
      remainingHours: 8,
      markBand: 80,
      capacityShare: 0.2,
    },
    {
      ...eligibleCandidate,
      tutorId: 9,
      fullName: 'Busier Tutor',
      mark: 88,
      weeklyLimit: 10,
      usedHours: 7,
      remainingHours: 3,
      markBand: 80,
      capacityShare: 0.7,
    },
  ]

  async function showCandidates(candidates) {
    listAllocationCandidates.mockResolvedValue(candidates)
    await openBoard()
    fillBoard()
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))
    return screen.findByRole('heading', { name: /^eligible tutors$/i })
  }

  it('states the ranking rule once, above the eligible tutors', async () => {
    await showCandidates(ranked)

    expect(
      screen.getByText(/ranked by mark band, then who is least busy that week/i),
    ).toBeVisible()
    // Said once, not repeated on every card.
    expect(screen.getAllByText(/ranked by mark band/i)).toHaveLength(1)
  })

  it('shows each eligible tutor the factors the ranking used', async () => {
    await showCandidates(ranked)

    const card = screen.getByRole('heading', { name: 'Freer Tutor' }).closest('article')
    const chips = within(card).getByRole('list', { name: /why Freer Tutor is ranked here/i })
    expect(within(chips).getByText('Mark 84%')).toBeVisible()
    expect(within(chips).getByText('2 of 10 hours used that week')).toBeVisible()
  })

  it('never shows a score or the raw capacity share', async () => {
    await showCandidates(ranked)

    // capacityShare is a ranking input only; 0.2 and 0.7 must never reach the page.
    expect(screen.queryByText(/0\.2|0\.7/)).not.toBeInTheDocument()
    expect(screen.queryByText(/score/i)).not.toBeInTheDocument()
  })

  it('keeps the order the server returned', async () => {
    await showCandidates(ranked)

    const names = screen
      .getAllByRole('article')
      .map((card) => within(card).getByRole('heading', { level: 3 }).textContent)
    expect(names).toEqual(['Freer Tutor', 'Busier Tutor'])
  })

  it('shows no ranking chips on an ineligible tutor', async () => {
    await showCandidates([ranked[0], ineligibleCandidate])

    const blocked = screen.getByRole('heading', { name: 'Blocked Tutor' }).closest('article')
    expect(within(blocked).queryByRole('list', { name: /is ranked here/i })).not.toBeInTheDocument()
    expect(within(blocked).getByText(/mark: fail/i)).toBeVisible()
  })
})

describe('OrganiserDashboard session-length check', () => {
  beforeEach(() => {
    listCourses.mockReset().mockResolvedValue(courses)
    listAllocationCandidates.mockReset().mockResolvedValue([])
    listAllocations.mockReset().mockResolvedValue([])
    createAllocation.mockReset().mockResolvedValue({ id: 11 })
    updateAllocation.mockReset().mockResolvedValue({ id: 11 })
    removeAllocation.mockReset().mockResolvedValue(undefined)
    getAccessTokenSilently.mockReset()
    quietHomeData()
  })

  async function boardWith(startsAt, endsAt, hours) {
    await openBoard()
    fireEvent.change(screen.getByLabelText(/^course$/i), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText(/session starts/i), { target: { value: startsAt } })
    fireEvent.change(screen.getByLabelText(/session ends/i), { target: { value: endsAt } })
    fireEvent.change(screen.getByLabelText(/required hours/i), { target: { value: hours } })
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))
  }

  it('stops hours longer than the session before any request is sent', async () => {
    await boardWith('2030-09-04T14:00', '2030-09-04T16:00', '20')

    expect(screen.getByLabelText(/required hours/i)).toHaveAccessibleDescription(
      'Enter hours above 0 and no more than the session length of 2 hours.',
    )
    expect(listAllocationCandidates).not.toHaveBeenCalled()
  })

  it('stops a session that spans days before any request is sent', async () => {
    // The shape the real fault took: the start a month behind the end, carrying
    // a plausible two hours. The hours rule cannot catch it, because two hours
    // does fit inside a month.
    await boardWith('2026-09-01T10:27', '2026-10-01T12:27', '2')

    expect(screen.getByLabelText(/session ends/i)).toHaveAccessibleDescription(
      'A session cannot be longer than 8 hours. This one is 722 hours. Check the start and end dates.',
    )
    expect(listAllocationCandidates).not.toHaveBeenCalled()
  })

  it('allows a session of exactly the maximum length', async () => {
    await boardWith('2030-09-04T09:00', '2030-09-04T17:00', '8')

    expect(listAllocationCandidates).toHaveBeenCalled()
  })

  it('still allows a session in the past, because editing history is allowed', async () => {
    await boardWith('2020-01-06T10:00', '2020-01-06T12:00', '2')

    expect(listAllocationCandidates).toHaveBeenCalled()
  })

  it('names a fractional session length properly', async () => {
    await boardWith('2030-09-04T14:00', '2030-09-04T15:30', '2')

    expect(screen.getByLabelText(/required hours/i)).toHaveAccessibleDescription(
      'Enter hours above 0 and no more than the session length of 1 hour 30 minutes.',
    )
    expect(listAllocationCandidates).not.toHaveBeenCalled()
  })

  it.each([
    ['exactly the session length', '2'],
    ['less than the session length', '0.5'],
  ])('allows %s', async (_label, hours) => {
    await boardWith('2030-09-04T14:00', '2030-09-04T16:00', hours)

    await waitFor(() => expect(listAllocationCandidates).toHaveBeenCalled())
    expect(listAllocationCandidates.mock.calls[0][0]).toMatchObject({
      requestedHours: Number(hours),
    })
  })
})
