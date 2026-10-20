import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OccurrenceExceptions from './OccurrenceExceptions'
import { upcomingOccurrences } from '../components/shared/scheduleWeek'

const skipOccurrence = vi.fn()
const moveOccurrence = vi.fn()
const restoreOccurrence = vi.fn()
vi.mock('../api/availability', () => ({
  skipOccurrence: (...args) => skipOccurrence(...args),
  moveOccurrence: (...args) => moveOccurrence(...args),
  restoreOccurrence: (...args) => restoreOccurrence(...args),
}))

// Tuesdays 10:00-11:30 SAST from 3 February 2026.
const lecture = {
  id: 4,
  type: 'BUSY',
  startsAt: '2026-02-03T08:00:00.000Z',
  endsAt: '2026-02-03T09:30:00.000Z',
  recurrence: 'WEEKLY',
  label: 'COMS2002 lecture',
  recurrenceUntil: null,
  exceptions: [],
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-02-11T12:00:00.000Z'))
  skipOccurrence.mockReset()
  moveOccurrence.mockReset()
  restoreOccurrence.mockReset()
})
afterEach(() => { vi.useRealTimers() })

describe('upcomingOccurrences', () => {
  it('lists unfinished occurrences by their Johannesburg date', () => {
    const dates = upcomingOccurrences(lecture, new Date('2026-02-11T12:00:00.000Z'), 3).map((item) => item.date)
    expect(dates).toEqual(['2026-02-17', '2026-02-24', '2026-03-03'])
  })

  it('keeps today while the class is still running', () => {
    const during = upcomingOccurrences(lecture, new Date('2026-02-10T09:00:00.000Z'), 1)
    expect(during[0].date).toBe('2026-02-10')
  })

  it('stops at the repeat-until date and skips the off-week of a fortnightly entry', () => {
    expect(upcomingOccurrences({ ...lecture, recurrenceUntil: '2026-02-24T08:00:00.000Z' }, new Date('2026-02-11T12:00:00.000Z')))
      .toHaveLength(2)
    expect(upcomingOccurrences({ ...lecture, recurrence: 'FORTNIGHTLY' }, new Date('2026-02-11T12:00:00.000Z'), 2)
      .map((item) => item.date)).toEqual(['2026-02-17', '2026-03-03'])
    expect(upcomingOccurrences({ ...lecture, recurrence: null })).toEqual([])
  })
})

describe('Change one week', () => {
  it('skips a chosen week and hands the updated entry back', async () => {
    const updated = { ...lecture, exceptions: [{ occurrenceDate: '2026-02-17', exceptionType: 'CANCELLED', newStartsAt: null, newEndsAt: null }] }
    skipOccurrence.mockResolvedValue(updated)
    const onUpdated = vi.fn()
    render(<OccurrenceExceptions slot={lecture} tokenOrGetter="token" onUpdated={onUpdated} />)

    fireEvent.click(screen.getByRole('button', { name: 'Change one week' }))
    fireEvent.change(screen.getByLabelText('Week to change'), { target: { value: '2026-02-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Skip this week' }))

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated))
    expect(skipOccurrence).toHaveBeenCalledWith(4, '2026-02-17', 'token')
    expect(screen.getByRole('status')).toHaveTextContent('Skipped')
  })

  it('moves a week to a new time, prefilled with its usual time', async () => {
    moveOccurrence.mockResolvedValue(lecture)
    render(<OccurrenceExceptions slot={lecture} tokenOrGetter="token" onUpdated={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Change one week' }))
    fireEvent.change(screen.getByLabelText('Week to change'), { target: { value: '2026-02-17' } })
    fireEvent.click(screen.getByLabelText(/Move it to another time/))
    const newStart = screen.getByLabelText('New start')
    expect(newStart.value).not.toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Move this week' }))

    await waitFor(() => expect(moveOccurrence).toHaveBeenCalledTimes(1))
    const [id, date, times] = moveOccurrence.mock.calls[0]
    expect([id, date]).toEqual([4, '2026-02-17'])
    expect(new Date(times.newEndsAt) - new Date(times.newStartsAt)).toBe(90 * 60_000)
  })

  it('asks for a week before saving and shows a server refusal', async () => {
    skipOccurrence.mockRejectedValue(new Error('This entry does not happen on that date.'))
    render(<OccurrenceExceptions slot={lecture} tokenOrGetter="token" onUpdated={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Change one week' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip this week' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose the week to change.')
    expect(skipOccurrence).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Week to change'), { target: { value: '2026-02-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Skip this week' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This entry does not happen on that date.')
  })

  it('lists changed weeks and restores one', async () => {
    const changed = {
      ...lecture,
      exceptions: [
        { occurrenceDate: '2026-02-17', exceptionType: 'CANCELLED', newStartsAt: null, newEndsAt: null },
        { occurrenceDate: '2026-02-24', exceptionType: 'MOVED', newStartsAt: '2026-02-25T10:00:00.000Z', newEndsAt: '2026-02-25T11:30:00.000Z' },
      ],
    }
    restoreOccurrence.mockResolvedValue(lecture)
    const onUpdated = vi.fn()
    render(<OccurrenceExceptions slot={changed} tokenOrGetter="token" onUpdated={onUpdated} />)

    const list = screen.getByRole('list', { name: 'Changed weeks for COMS2002 lecture' })
    expect(list).toHaveTextContent('Skipped on')
    expect(list).toHaveTextContent('Moved from')
    fireEvent.click(screen.getAllByRole('button', { name: /^Restore/ })[0])

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(lecture))
    expect(restoreOccurrence).toHaveBeenCalledWith(4, '2026-02-17', 'token')
  })
})
