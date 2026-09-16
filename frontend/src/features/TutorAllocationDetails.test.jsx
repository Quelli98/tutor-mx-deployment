import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TutorAllocationDetails from './TutorAllocationDetails'

const listCourses = vi.fn()
const listTutorMarks = vi.fn()
const saveTutorMark = vi.fn()
const deleteTutorMark = vi.fn()
const listTutorTimeSlots = vi.fn()
const getAccessTokenSilently = vi.fn()

vi.mock('../api/organiser', () => ({
  listCourses: (...args) => listCourses(...args),
  listTutorMarks: (...args) => listTutorMarks(...args),
  saveTutorMark: (...args) => saveTutorMark(...args),
  deleteTutorMark: (...args) => deleteTutorMark(...args),
  listTutorTimeSlots: (...args) => listTutorTimeSlots(...args),
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
    saveTutorMark.mockReset()
    deleteTutorMark.mockReset().mockResolvedValue(undefined)
    listTutorTimeSlots.mockReset().mockResolvedValue([])
    getAccessTokenSilently.mockReset()
  })

  it('loads marks for the selected tutor', async () => {
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

    render(<TutorAllocationDetails tutor={tutor} />)

    const markList = await screen.findByRole('list', { name: /course marks for Sam Tutor/i })
    expect(within(markList).getByText('COMS3011')).toBeInTheDocument()
    expect(within(markList).getByText('72%')).toBeInTheDocument()
    expect(listTutorMarks).toHaveBeenCalledWith(7, getAccessTokenSilently)
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
})
