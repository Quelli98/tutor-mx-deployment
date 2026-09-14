import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TutorAllocationDetails from './TutorAllocationDetails'

const listCourses = vi.fn()
const listTutorMarks = vi.fn()
const listTutorTimeSlots = vi.fn()
const saveTutorMark = vi.fn()
const createTutorTimeSlot = vi.fn()
const deleteTutorMark = vi.fn()
const deleteTutorTimeSlot = vi.fn()
const getAccessTokenSilently = vi.fn()

vi.mock('../api/organiser', () => ({
  listCourses: (...args) => listCourses(...args),
  listTutorMarks: (...args) => listTutorMarks(...args),
  listTutorTimeSlots: (...args) => listTutorTimeSlots(...args),
  saveTutorMark: (...args) => saveTutorMark(...args),
  createTutorTimeSlot: (...args) => createTutorTimeSlot(...args),
  deleteTutorMark: (...args) => deleteTutorMark(...args),
  deleteTutorTimeSlot: (...args) => deleteTutorTimeSlot(...args),
}))

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently }),
}))

const tutor = { id: 7, fullName: 'Sam Tutor' }
const courses = [
  { id: 3, code: 'COMS3011', name: 'Software Design Project' },
  { id: 4, code: 'COMS3006', name: 'Computer Graphics' },
]

describe('TutorAllocationDetails', () => {
  beforeEach(() => {
    listCourses.mockReset().mockResolvedValue(courses)
    listTutorMarks.mockReset().mockResolvedValue([])
    listTutorTimeSlots.mockReset().mockResolvedValue([])
    saveTutorMark.mockReset()
    createTutorTimeSlot.mockReset()
    deleteTutorMark.mockReset().mockResolvedValue(undefined)
    deleteTutorTimeSlot.mockReset().mockResolvedValue(undefined)
    getAccessTokenSilently.mockReset()
  })

  it('loads marks and busy times for the selected tutor', async () => {
    listTutorMarks.mockResolvedValue([
      {
        id: 11,
        courseId: 3,
        courseCode: 'COMS3011',
        courseName: 'Software Design Project',
        mark: 72,
        activeAllocationCount: 1,
      },
    ])
    listTutorTimeSlots.mockResolvedValue([
      {
        id: 9,
        type: 'BUSY',
        startsAt: '2030-09-04T14:00:00.000Z',
        endsAt: '2030-09-04T16:00:00.000Z',
        recurrence: 'WEEKLY',
      },
    ])

    render(<TutorAllocationDetails tutor={tutor} />)

    const markList = await screen.findByRole('list', { name: /course marks for Sam Tutor/i })
    expect(within(markList).getByText('COMS3011')).toBeInTheDocument()
    expect(within(markList).getByText('72%')).toBeInTheDocument()
    const timeList = screen.getByRole('list', { name: /time slots for Sam Tutor/i })
    expect(within(timeList).getByText('Busy')).toBeInTheDocument()
    expect(within(timeList).getByText(/repeats weekly/i)).toBeInTheDocument()
    expect(listTutorMarks).toHaveBeenCalledWith(7, getAccessTokenSilently)
    expect(listTutorTimeSlots).toHaveBeenCalledWith(7, getAccessTokenSilently)
  })

  it('saves a valid mark and replaces the same course without a stale row', async () => {
    listTutorMarks.mockResolvedValue([
      {
        id: 11,
        courseId: 3,
        courseCode: 'COMS3011',
        courseName: 'Software Design Project',
        mark: 60,
        activeAllocationCount: 0,
      },
    ])
    saveTutorMark.mockResolvedValue({
      id: 11,
      courseId: 3,
      courseCode: 'COMS3011',
      courseName: 'Software Design Project',
      mark: 75,
      activeAllocationCount: 0,
    })

    render(<TutorAllocationDetails tutor={tutor} />)
    await screen.findByText('60%')
    fireEvent.change(screen.getByLabelText(/^course$/i), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText(/^mark \(%\)$/i), { target: { value: '75' } })
    fireEvent.click(screen.getByRole('button', { name: /^save mark$/i }))

    await waitFor(() => {
      expect(saveTutorMark).toHaveBeenCalledWith(
        { tutorId: 7, courseId: 3, mark: 75 },
        getAccessTokenSilently,
      )
    })
    expect(await screen.findByText('75%')).toBeInTheDocument()
    expect(screen.queryByText('60%')).not.toBeInTheDocument()
  })

  it('blocks an invalid mark with field-level messages', async () => {
    render(<TutorAllocationDetails tutor={tutor} />)
    await screen.findByRole('option', { name: /COMS3011/i })
    fireEvent.change(screen.getByLabelText(/^course$/i), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText(/^mark \(%\)$/i), { target: { value: '120' } })
    fireEvent.click(screen.getByRole('button', { name: /^save mark$/i }))

    expect(screen.getByLabelText(/^mark \(%\)$/i)).toHaveAccessibleDescription(/mark from 0 to 100/i)
    expect(saveTutorMark).not.toHaveBeenCalled()
  })

  it('saves a weekly busy time and rejects an inverted time range', async () => {
    createTutorTimeSlot.mockResolvedValue({
      id: 10,
      type: 'BUSY',
      startsAt: new Date('2030-09-04T14:00').toISOString(),
      endsAt: new Date('2030-09-04T16:00').toISOString(),
      recurrence: 'WEEKLY',
    })

    render(<TutorAllocationDetails tutor={tutor} />)
    await screen.findByRole('option', { name: /COMS3011/i })
    fireEvent.change(screen.getByLabelText(/busy from/i), {
      target: { value: '2030-09-04T16:00' },
    })
    fireEvent.change(screen.getByLabelText(/busy until/i), {
      target: { value: '2030-09-04T14:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add busy time/i }))

    expect(screen.getByLabelText(/busy until/i)).toHaveAccessibleDescription(/later than/i)
    expect(createTutorTimeSlot).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/busy from/i), {
      target: { value: '2030-09-04T14:00' },
    })
    fireEvent.change(screen.getByLabelText(/busy until/i), {
      target: { value: '2030-09-04T16:00' },
    })
    fireEvent.click(screen.getByLabelText(/repeat weekly/i))
    fireEvent.click(screen.getByRole('button', { name: /add busy time/i }))

    await waitFor(() => {
      expect(createTutorTimeSlot).toHaveBeenCalledWith(
        {
          tutorId: 7,
          type: 'BUSY',
          startsAt: new Date('2030-09-04T14:00').toISOString(),
          endsAt: new Date('2030-09-04T16:00').toISOString(),
          recurrence: 'WEEKLY',
        },
        getAccessTokenSilently,
      )
    })
    expect(await screen.findByText(/busy time was added for Sam Tutor/i)).toBeInTheDocument()
  })

  it('confirms and removes a mark while warning about active allocations', async () => {
    listTutorMarks.mockResolvedValue([{
      id: 11,
      courseId: 3,
      courseCode: 'COMS3011',
      courseName: 'Software Design Project',
      mark: 72,
      activeAllocationCount: 2,
    }])

    render(<TutorAllocationDetails tutor={tutor} />)
    fireEvent.click(await screen.findByRole('button', { name: /remove COMS3011 mark/i }))
    expect(screen.getByRole('dialog')).toHaveTextContent(/has 2 allocations/i)
    fireEvent.click(screen.getByRole('button', { name: /^remove mark$/i }))

    await waitFor(() => {
      expect(deleteTutorMark).toHaveBeenCalledWith(
        { tutorId: 7, courseId: 3 },
        getAccessTokenSilently,
      )
    })
    expect(await screen.findByText(/COMS3011 mark was removed/i)).toBeInTheDocument()
  })

  it('confirms and removes a busy time', async () => {
    listTutorTimeSlots.mockResolvedValue([{
      id: 9,
      type: 'BUSY',
      startsAt: '2030-09-04T14:00:00.000Z',
      endsAt: '2030-09-04T16:00:00.000Z',
      recurrence: null,
    }])

    render(<TutorAllocationDetails tutor={tutor} />)
    fireEvent.click(await screen.findByRole('button', { name: /remove busy time from/i }))
    fireEvent.click(screen.getByRole('button', { name: /^remove busy time$/i }))

    await waitFor(() => {
      expect(deleteTutorTimeSlot).toHaveBeenCalledWith(
        { tutorId: 7, timeSlotId: 9 },
        getAccessTokenSilently,
      )
    })
    expect(await screen.findByText(/busy time was removed/i)).toBeInTheDocument()
  })
})
