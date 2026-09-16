import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WeeklySchedule from './WeeklySchedule'
import { localMonday, scheduleForWeek, weekRangeLabel } from './scheduleWeek'

const monday = new Date('2026-09-14T00:00')
const slot = { id: 1, type: 'BUSY', label: 'Lecture', startsAt: new Date('2026-09-17T08:00').toISOString(), endsAt: new Date('2026-09-17T09:45').toISOString(), recurrence: 'WEEKLY', recurrenceUntil: null }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-16T12:00'))
})
afterEach(() => vi.useRealTimers())

describe('weekly schedule', () => {
  it('maps local weekdays and times without shifting from the stored instant', () => {
    render(<WeeklySchedule slots={[slot]} />)
    const block = screen.getByText('Lecture').closest('article')
    expect(within(block).getByText('Thursday')).toBeVisible()
    expect(within(block).getByText('08:00–09:45')).toBeVisible()
    expect(block.parentElement).toHaveStyle({ gridColumn: '5' })
    expect(screen.getByText('14–20 September 2026')).toBeVisible()
    expect(screen.getByText(/free space means available/i)).toBeVisible()
  })

  it('navigates bounded weekly occurrences and restores the current week', () => {
    render(<WeeklySchedule slots={[{ ...slot, recurrenceUntil: slot.startsAt }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(screen.queryByText('Lecture')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(screen.getByText('Lecture')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(screen.queryByText('Lecture')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'This week' }))
    expect(screen.getByText('Lecture')).toBeVisible()
  })

  it.each(['ONCE', null])('shows %s only in its own date and week', (recurrence) => {
    render(<WeeklySchedule slots={[{ ...slot, recurrence }]} />)
    expect(screen.getByText('Lecture')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(screen.queryByText('Lecture')).not.toBeInTheDocument()
    expect(screen.getByText('No unavailable times this week.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(screen.queryByText('Lecture')).not.toBeInTheDocument()
  })

  it('shows null labels as Unavailable, never Available, and ignores AVAILABLE rows', () => {
    render(<WeeklySchedule slots={[{ ...slot, label: null }, { ...slot, id: 2, type: 'AVAILABLE', label: 'Not a busy block' }]} />)
    expect(screen.getByText('Unavailable')).toBeVisible()
    expect(screen.queryByText('Not a busy block')).not.toBeInTheDocument()
  })

  it('shows an empty schedule and a keyboard-accessible local scroll container', () => {
    render(<WeeklySchedule slots={[]} />)
    expect(screen.getByText('No unavailable times added')).toBeVisible()
    expect(document.querySelector('.calendar-scroll')).toHaveAttribute('tabindex', '0')
  })

  it('splits overnight occurrences on day boundaries and keeps overlapping blocks in separate lanes', () => {
    const nights = { ...slot, startsAt: new Date('2026-09-13T23:00').toISOString(), endsAt: new Date('2026-09-14T01:00').toISOString() }
    const days = scheduleForWeek([nights, { ...nights, id: 2 }], monday)
    expect(days[0].blocks).toHaveLength(2)
    expect(days[0].blocks[0]).toMatchObject({ startMinute: 0, endMinute: 60, lane: 1 })
    expect(days[0].blocks[1].lane).toBe(2)
    expect(days[6].blocks[0]).toMatchObject({ startMinute: 1380, endMinute: 1440 })
    render(<WeeklySchedule slots={[nights]} />)
    expect(screen.getByText('23:00–24:00')).toBeVisible()
    expect(screen.getByText('00:00–01:00')).toBeVisible()
  })

  it('reuses a calendar lane for touching times', () => {
    const days = scheduleForWeek([slot, { ...slot, id: 2, startsAt: slot.endsAt, endsAt: new Date('2026-09-17T11:00').toISOString() }], monday)
    expect(days[3].lanes).toBe(1)
    expect(days[3].blocks.map((block) => block.lane)).toEqual([1, 1])
  })

  it('projects long-running weekly schedules to the requested week without drifting local hours', () => {
    const old = { ...slot, startsAt: new Date('2025-01-02T08:00').toISOString(), endsAt: new Date('2025-01-02T09:45').toISOString() }
    const days = scheduleForWeek([old], monday)
    expect(days[3].blocks).toHaveLength(1)
    expect(days[3].blocks[0].startsAt.getHours()).toBe(8)
    expect(days[3].blocks[0].startsAt.getDate()).toBe(17)
  })

  it('preserves wall-clock time across a daylight-saving boundary', () => {
    const march = { ...slot, startsAt: new Date('2026-03-02T08:00').toISOString(), endsAt: new Date('2026-03-02T09:45').toISOString() }
    const days = scheduleForWeek([march], new Date('2026-03-09T00:00'))
    expect(days[0].blocks[0].startMinute).toBe(480)
    expect(days[0].blocks[0].endMinute).toBe(585)
  })

  it('formats inclusive month/year-crossing weeks and maps Sunday back to Monday', () => {
    expect(weekRangeLabel(new Date('2026-09-28T00:00'))).toBe('28 September 2026 – 4 October 2026')
    expect(weekRangeLabel(new Date('2026-12-28T00:00'))).toBe('28 December 2026 – 3 January 2027')
    expect(localMonday(new Date('2026-09-20T23:00'))).toEqual(monday)
  })
})
