import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OrganiserDashboard from './OrganiserDashboard'

const listCourses = vi.fn()
const listAllocationCandidates = vi.fn()
const listAllocations = vi.fn()
const createAllocation = vi.fn()
const updateAllocation = vi.fn()
const removeAllocation = vi.fn()
const getAccessTokenSilently = vi.fn()

vi.mock('../api/organiser', () => ({
  listCourses: (...args) => listCourses(...args),
  listAllocationCandidates: (...args) => listAllocationCandidates(...args),
  listAllocations: (...args) => listAllocations(...args),
  createAllocation: (...args) => createAllocation(...args),
  updateAllocation: (...args) => updateAllocation(...args),
  removeAllocation: (...args) => removeAllocation(...args),
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
}
const allocation = {
  id: 11,
  tutorId: 7,
  tutorName: 'Boundary Tutor',
  tutorEmail: 'boundary@tutormx.example',
  courseId: 3,
  courseCode: 'COMS3011',
  courseName: 'Software Design Project',
  startsAt: '2030-09-04T14:00:00.000Z',
  endsAt: '2030-09-04T16:00:00.000Z',
  allocatedHours: 2,
  status: 'CONFIRMED',
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
  })

  it('keeps the board visible while courses load and explains an empty course list', async () => {
    let resolveCourses
    listCourses.mockReturnValue(
      new Promise((resolve) => {
        resolveCourses = resolve
      }),
    )

    render(<OrganiserDashboard />)

    expect(screen.getByRole('heading', { name: /allocation board/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /loading courses/i })).toBeInTheDocument()

    resolveCourses([])
    expect(await screen.findByRole('heading', { name: /no courses yet/i })).toBeInTheDocument()
  })

  it('checks candidates on the same page and shows all three written rule results', async () => {
    listCourses.mockResolvedValue(courses)
    listAllocationCandidates.mockResolvedValue([eligibleCandidate, ineligibleCandidate])

    render(<OrganiserDashboard />)
    await screen.findByRole('option', { name: /COMS3011/i })
    fillBoard()
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))

    const blockedCard = await screen.findByRole('heading', { name: 'Blocked Tutor' })
    const blockedArticle = blockedCard.closest('article')
    expect(within(blockedArticle).getByText(/mark eligibility: fail/i)).toBeInTheDocument()
    expect(within(blockedArticle).getByText(/timetable clash: fail/i)).toBeInTheDocument()
    expect(within(blockedArticle).getByText(/weekly hours: fail/i)).toBeInTheDocument()
    expect(within(blockedArticle).getByText(/1 hours remain; 2 hours are required/i)).toBeInTheDocument()

    const boundaryCard = screen.getByRole('heading', { name: 'Boundary Tutor' }).closest('article')
    expect(within(boundaryCard).getByText(/mark eligibility: pass/i)).toBeInTheDocument()
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

    render(<OrganiserDashboard />)
    await screen.findByRole('option', { name: /COMS3011/i })
    fillBoard()
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))

    expect(await screen.findByText(/set a weekly hour limit before allocating 2 hours/i)).toBeInTheDocument()
    expect(screen.queryByText(/0 hours remain/i)).not.toBeInTheDocument()
  })

  it('creates an allocation only after an eligible tutor is selected and refreshes the board', async () => {
    listCourses.mockResolvedValue(courses)
    listAllocationCandidates.mockResolvedValue([eligibleCandidate, ineligibleCandidate])

    render(<OrganiserDashboard />)
    await screen.findByRole('option', { name: /COMS3011/i })
    fillBoard()
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))

    const saveButton = await screen.findByRole('button', { name: /save allocation/i })
    expect(saveButton).toBeDisabled()
    expect(screen.getByRole('button', { name: /select Blocked Tutor/i })).toBeDisabled()

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

    render(<OrganiserDashboard />)
    await screen.findByRole('option', { name: /COMS3011/i })
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))

    expect(screen.getByLabelText(/^course$/i)).toHaveAccessibleDescription(/select a course/i)
    expect(screen.getByLabelText(/session starts/i)).toHaveAccessibleDescription(/valid start/i)
    expect(screen.getByLabelText(/session ends/i)).toHaveAccessibleDescription(/valid end/i)
    expect(listAllocationCandidates).not.toHaveBeenCalled()
  })

  it('provides a logical keyboard focus order from refresh into the labelled course selector', async () => {
    const user = userEvent.setup()
    listCourses.mockResolvedValue(courses)

    render(<OrganiserDashboard />)
    const courseSelect = await screen.findByLabelText(/^course$/i)
    await waitFor(() => expect(courseSelect).not.toBeDisabled())
    await user.tab()
    expect(screen.getByRole('button', { name: /^refresh$/i })).toHaveFocus()
    await user.tab()
    expect(courseSelect).toHaveFocus()
  })

  it('explains candidate errors and allows a retry', async () => {
    listCourses.mockResolvedValue(courses)
    listAllocationCandidates
      .mockRejectedValueOnce(Object.assign(new Error('private detail'), { code: 'REQUEST_FAILED' }))
      .mockResolvedValueOnce([])

    render(<OrganiserDashboard />)
    await screen.findByRole('option', { name: /COMS3011/i })
    fillBoard()
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))

    expect(await screen.findByRole('heading', { name: /candidates unavailable/i })).toBeInTheDocument()
    expect(screen.queryByText(/private detail/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    await waitFor(() => expect(listAllocationCandidates).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('heading', { name: /no candidates found/i })).toBeInTheDocument()
  })

  it('edits an allocation with the current row excluded from server checks', async () => {
    listCourses.mockResolvedValue(courses)
    listAllocations.mockResolvedValue([allocation])
    listAllocationCandidates.mockResolvedValue([eligibleCandidate])

    render(<OrganiserDashboard />)
    fireEvent.click(await screen.findByRole('button', { name: /edit allocation/i }))
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

  it('removes an allocation after confirmation and refreshes the list', async () => {
    listCourses.mockResolvedValue(courses)
    listAllocations.mockResolvedValueOnce([allocation]).mockResolvedValueOnce([])

    render(<OrganiserDashboard />)
    fireEvent.click(await screen.findByRole('button', { name: /^remove$/i }))
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

    render(<OrganiserDashboard />)
    await screen.findByRole('option', { name: /COMS3011/i })
    fillBoard()
    fireEvent.click(screen.getByRole('button', { name: /check candidates/i }))
    fireEvent.click(await screen.findByRole('button', { name: /select Boundary Tutor/i }))
    fireEvent.click(screen.getByRole('button', { name: /save allocation/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer meets the required mark/i)
    expect(listAllocationCandidates).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: /select Boundary Tutor/i })).toBeDisabled()
  })
})
