import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HomeAllocations } from './HomeAllocations'
import { toIsoDate } from '../../features/organiserHome'

const weekStart = new Date(2026, 8, 21)

function allocation(id, tutorName, day, courseId = 1, extra = {}) {
  return {
    id,
    tutorId: id,
    tutorName,
    tutorEmail: `${tutorName.split(' ')[0].toLowerCase()}@students.wits.ac.za`,
    courseId,
    courseCode: courseId === 1 ? 'COMS1018A' : 'COMS2002A',
    courseName: courseId === 1 ? 'Basic Computer Organisation' : 'Database Fundamentals',
    startsAt: new Date(2026, 8, day, 14, 15).toISOString(),
    endsAt: new Date(2026, 8, day, 17).toISOString(),
    allocatedHours: 2.75,
    status: 'CONFIRMED',
    ...extra,
  }
}

function renderTimetable(allocations, props = {}) {
  const handlers = { onEdit: vi.fn(), onWeekChange: vi.fn(), onRefresh: vi.fn() }
  render(
    <HomeAllocations
      status="success"
      allocations={allocations}
      error=""
      isMutating={false}
      weekStart={weekStart}
      today={new Date(2026, 8, 23, 9)}
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

describe('HomeAllocations', () => {
  it('lays the week out as a timetable, with tutors on the same session in one block', () => {
    renderTimetable([
      allocation(1, 'Thabo Nkosi', 22),
      allocation(2, 'Lerato Dlamini', 22),
      allocation(3, 'Aisha Patel', 23, 2),
    ])

    expect(screen.getByText('21–27 September 2026 · 3 allocations · 8.25 h')).toBeInTheDocument()
    const days = within(screen.getByRole('list', { name: /allocations for 21–27 september/i }))
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
    expect(days).toEqual([
      expect.stringContaining('Monday 21 September'),
      expect.stringContaining('Tuesday 22 September'),
      expect.stringContaining('Wednesday 23 September, today'),
      expect.stringContaining('Thursday 24 September'),
      expect.stringContaining('Friday 25 September'),
    ])

    const tuesday = screen.getByRole('heading', { name: 'Tuesday 22 September' }).closest('li')
    expect(within(tuesday).getAllByText('COMS1018A')).toHaveLength(1)
    expect(within(tuesday).getByText('14:15 – 17:00')).toBeInTheDocument()
    expect(within(tuesday).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'LDLerato Dlamini',
      'TNThabo Nkosi',
    ])
    expect(screen.getByRole('heading', { name: 'Wednesday 23 September, today' }).closest('li')).toHaveAttribute('aria-current', 'date')
    expect(within(screen.getByRole('heading', { name: 'Monday 21 September' }).closest('li')).getByText('No sessions')).toBeInTheDocument()
  })

  it('shows a weekend day only when a session falls on it', () => {
    renderTimetable([allocation(1, 'Thabo Nkosi', 26)])

    expect(screen.getByRole('heading', { name: 'Saturday 26 September' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sunday 27 September' })).not.toBeInTheDocument()
  })

  it('opens a tutor’s allocation from their chip, and says when it is only proposed', () => {
    const proposed = allocation(4, 'Pieter van Wyk', 24, 1, { status: 'PROPOSED' })
    const { onEdit } = renderTimetable([proposed])

    const chip = screen.getByRole('button', {
      name: 'Pieter van Wyk (proposed), COMS1018A, Thursday 24 September, 14:15 – 17:00: edit or remove',
    })
    expect(chip).toHaveTextContent('Proposed')
    fireEvent.click(chip)
    expect(onEdit).toHaveBeenCalledWith(proposed, chip)
  })

  it('keeps the chips still while a change is being saved', () => {
    renderTimetable([allocation(1, 'Thabo Nkosi', 22)], { isMutating: true })

    expect(screen.getByRole('button', { name: /^thabo nkosi/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
  })

  it('moves Home to the nearest earlier or later week that has allocations', () => {
    // Days past 30 run on into October: 36 is 6 October.
    const { onWeekChange } = renderTimetable([
      allocation(1, 'Thabo Nkosi', 15),
      allocation(2, 'Aisha Patel', 22),
      allocation(3, 'Lerato Dlamini', 36),
      allocation(4, 'Zanele Khumalo', 38),
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Previous week: 1 allocation' }))
    expect(toIsoDate(onWeekChange.mock.calls[0][0])).toBe('2026-09-14')

    fireEvent.click(screen.getByRole('button', { name: 'Week of 5 October: 2 allocations' }))
    expect(toIsoDate(onWeekChange.mock.calls[1][0])).toBe('2026-10-05')
  })

  it('says when the week shown is empty but other weeks are not', () => {
    renderTimetable([allocation(1, 'Thabo Nkosi', 29)])

    expect(screen.getByText('No allocations in this week.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /allocations for/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next week: 1 allocation' })).toBeInTheDocument()
  })

  it('explains when there are no allocations at all', () => {
    renderTimetable([])

    expect(screen.getByRole('heading', { name: 'No active allocations' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /week/i })).not.toBeInTheDocument()
  })
})
