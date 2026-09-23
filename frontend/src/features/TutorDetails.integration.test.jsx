import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TutorAllocationDetails from './TutorAllocationDetails'

const { request, tokenGetter } = vi.hoisted(() => ({ request: vi.fn(), tokenGetter: vi.fn() }))
vi.mock('../api/client', () => ({ fetchWithBearerToken: (...args) => request(...args) }))
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ getAccessTokenSilently: tokenGetter }) }))

const tutor = { id: 7, fullName: 'Raquel', email: 'raquel@example.test' }
const mark = { id: 41, courseId: 3, courseCode: 'COMS3010A', courseName: 'Computer Science', mark: 90, activeAllocationCount: 0 }
const slot = {
  id: 12, type: 'BUSY', label: 'COMS3011 Lecture', recurrence: 'WEEKLY',
  startsAt: new Date('2026-09-17T08:00').toISOString(), endsAt: new Date('2026-09-17T09:45').toISOString(),
  recurrenceUntil: new Date('2026-10-15T08:00').toISOString(),
}

function respond(marks = [mark], timeSlots = [slot]) {
  request.mockImplementation(async (path) => {
    if (path === '/api/courses') return { data: { courses: [{ id: 3, code: 'COMS3010A', name: 'Computer Science', hourlyRate: null, budget: null }] } }
    if (path === '/api/tutors/7/marks') return { data: { marks } }
    if (path === '/api/tutors/7/time-slots') return { data: { timeSlots } }
    throw new Error(`Unexpected endpoint: ${path}`)
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-16T12:00'))
  request.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('Organiser detail API integration', () => {
  it.each([
    ['no schedule', []],
    ['weekly schedule', [slot]],
    ['null label', [{ ...slot, label: null }]],
    ['null recurrence end', [{ ...slot, recurrenceUntil: null }]],
    ['legacy absent optional fields', [{ ...slot, label: undefined, recurrenceUntil: undefined }]],
    ['existing long label', [{ ...slot, label: 'Long lecture description '.repeat(8) }]],
    ['once-off schedule', [{ ...slot, recurrence: 'ONCE', recurrenceUntil: null }]],
  ])('loads marks with %s through organiser endpoints', async (_name, slots) => {
    respond([mark], slots)
    render(<TutorAllocationDetails tutor={tutor} />)
    expect(await screen.findByText('90%')).toBeVisible()
    expect(await screen.findByRole('region', { name: 'Schedule for Raquel' })).toBeVisible()
    expect(request).toHaveBeenCalledWith('/api/tutors/7/marks', {}, tokenGetter)
    expect(request).toHaveBeenCalledWith('/api/tutors/7/time-slots', {}, tokenGetter)
    expect(request.mock.calls.some(([path]) => path === '/api/tutor/time-slots')).toBe(false)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    const calendar = screen.getByRole('region', { name: 'Schedule for Raquel' })
    if (!slots.length) expect(within(calendar).getByText('No unavailable times added')).toBeVisible()
    else expect(within(calendar).getByText('08:00–09:45')).toBeVisible()
    expect(within(calendar).queryByRole('button', { name: /edit|delete/i })).not.toBeInTheDocument()
    expect(screen.getByText('Schedule maintained by the Tutor')).toBeVisible()
  })

  it('shows a schedule without marks and keeps missing marks separate', async () => {
    respond([], [slot])
    render(<TutorAllocationDetails tutor={tutor} />)
    expect(await screen.findByRole('heading', { name: 'No mark recorded' })).toBeVisible()
    expect(await screen.findByText('COMS3011 Lecture')).toBeVisible()
  })

  it('shows multiple course marks', async () => {
    respond([mark, { ...mark, id: 42, courseId: 4, courseCode: 'COMS3006', mark: 78 }], [])
    render(<TutorAllocationDetails tutor={tutor} />)
    const marks = await screen.findByRole('list', { name: 'Course marks for Raquel' })
    expect(within(marks).getAllByRole('listitem')).toHaveLength(2)
    expect(within(marks).getByText('90%')).toBeVisible()
    expect(within(marks).getByText('78%')).toBeVisible()
  })

  it.each([{ label: 12 }, { recurrenceUntil: 'invalid' }, { startsAt: 'invalid' }])('never hides valid marks for malformed schedule data %j', async (invalid) => {
    respond([mark], [{ ...slot, ...invalid }])
    render(<TutorAllocationDetails tutor={tutor} />)
    expect(await screen.findByText('90%')).toBeVisible()
    expect(await screen.findByRole('heading', { name: 'Schedule unavailable' })).toBeVisible()
    expect(screen.queryByText('Tutor details unavailable')).not.toBeInTheDocument()
    respond()
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('COMS3011 Lecture')).toBeVisible()
    expect(screen.getByText('90%')).toBeVisible()
  })

  it('renders marks before a slow schedule request completes', async () => {
    respond()
    const base = request.getMockImplementation()
    let resolveSchedule
    request.mockImplementation((path, ...args) => path.endsWith('/time-slots')
      ? new Promise((resolve) => { resolveSchedule = resolve }) : base(path, ...args))
    render(<TutorAllocationDetails tutor={tutor} />)
    expect(await screen.findByText('90%')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Loading schedule' })).toBeVisible()
    await act(async () => resolveSchedule({ data: { timeSlots: [slot] } }))
    expect(screen.getByText('COMS3011 Lecture')).toBeVisible()
  })

  it.each(['/api/courses', '/api/tutors/7/marks'])('retains the schedule when %s fails', async (failedPath) => {
    respond()
    const base = request.getMockImplementation()
    request.mockImplementation((path, ...args) => path === failedPath ? Promise.reject(new Error('private details')) : base(path, ...args))
    render(<TutorAllocationDetails tutor={tutor} />)
    expect(await screen.findByText('COMS3011 Lecture')).toBeVisible()
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.queryByText('private details')).not.toBeInTheDocument()
    if (failedPath === '/api/courses') expect(screen.getByText('90%')).toBeVisible()
  })

  it('isolates tutors by internal ID even when a stale request finishes after selection changes', async () => {
    respond()
    const base = request.getMockImplementation()
    let resolveA
    request.mockImplementation((path, ...args) => {
      if (path === '/api/tutors/7/marks') return new Promise((resolve) => { resolveA = resolve })
      if (path === '/api/tutors/8/marks') return Promise.resolve({ data: { marks: [{ ...mark, id: 52, mark: 55 }] } })
      if (path === '/api/tutors/8/time-slots') return Promise.resolve({ data: { timeSlots: [] } })
      return base(path, ...args)
    })
    const { rerender } = render(<TutorAllocationDetails tutor={tutor} />)
    await screen.findByText('COMS3011 Lecture')
    rerender(<TutorAllocationDetails tutor={{ id: 8, fullName: 'Other Tutor', email: tutor.email }} />)
    expect(await screen.findByText('55%')).toBeVisible()
    await act(async () => resolveA({ data: { marks: [mark] } }))
    expect(screen.queryByText('90%')).not.toBeInTheDocument()
    expect(screen.queryByText('COMS3011 Lecture')).not.toBeInTheDocument()
    expect(request).toHaveBeenCalledWith('/api/tutors/8/marks', {}, tokenGetter)
    expect(request).toHaveBeenCalledWith('/api/tutors/8/time-slots', {}, tokenGetter)
  })
})
