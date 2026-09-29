import { render, screen, within } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import MyTimetable from './MyTimetable'
import WorkLogForm from './WorkLogForm'
import ExcuseStatusSection from './ExcuseStatusSection'
const dashboard = vi.fn()
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ getAccessTokenSilently: 'token' }) }))
vi.mock('../api/availability', () => ({ listOwnTimeSlots: async () => [] }))
vi.mock('../api/tutorDashboard', () => ({ fetchTutorDashboard: (...args) => dashboard(...args) }))
vi.mock('../api/excuse', () => ({ fetchExcuseStatus: vi.fn() }))
const base = { id: 1, courseCode: 'COMS3005A', courseName: 'Lecture', startsAt: '2026-09-29T08:00:00Z', endsAt: '2026-09-29T09:00:00Z', status: 'CONFIRMED', allocatedHours: 1 }
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-29T12:00Z')); window.sessionStorage.clear() })
afterEach(() => { vi.useRealTimers() })
describe('sick timetable presentation', () => {
  it.each([
    ['PENDING', 'SCHEDULED', 'Excuse pending'],
    ['APPROVED', 'SKIPPED', 'Skipped · Sick'],
    ['REJECTED', 'SCHEDULED', null],
  ])('%s retains the session with accessible state', async (status, occurrenceStatus, label) => {
    dashboard.mockResolvedValue({ allocations: [{ ...base, occurrenceStatus, excusePending: status === 'PENDING' }] })
    render(<MyTimetable />)
    const calendar = await screen.findByRole('region', { name: 'My timetable' })
    const card = within(calendar).getByRole('article')
    expect(card).toHaveTextContent('COMS3005A')
    if (label) expect(card).toHaveTextContent(label)
    else expect(card).not.toHaveTextContent('Sick')
    expect(card).toHaveStyle({ background: occurrenceStatus === 'SKIPPED' ? '#fef3c7' : '#dcfce7' })
  })
  it('hides approved advance sickness from the active timetable', async () => {
    dashboard.mockResolvedValue({ allocations: [{ ...base, occurrenceStatus: 'EXCUSED' }] })
    render(<MyTimetable />)
    const calendar = await screen.findByRole('region', { name: 'My timetable' })
    expect(within(calendar).queryByRole('article')).not.toBeInTheDocument()
    expect(screen.queryByText(/COMS3005A/)).not.toBeInTheDocument()
  })
  it('disables sick work logs while a replacement remains eligible', () => {
    render(<WorkLogForm allocations={[{ ...base, occurrenceStatus: 'SKIPPED', workLogEligible: false }, { ...base, id: 2, courseCode: 'Replacement', workLogEligible: true }]} tokenOrGetter="token" />)
    expect(screen.getByRole('option', { name: /Skipped · Sick/ })).toBeDisabled()
    expect(screen.getByRole('option', { name: /Replacement/ })).toBeEnabled()
  })
  it('restores excuse history from the server on a new device', () => {
    render(<ExcuseStatusSection allocations={[{ ...base, occurrenceStatus: 'EXCUSED', excuse: { id: 3, status: 'APPROVED' } }]} tokenOrGetter="token" />)
    expect(screen.getByText(/Excused · Sick/)).toBeInTheDocument()
    expect(screen.getByText(/kept here in history/)).toBeInTheDocument()
  })
})
