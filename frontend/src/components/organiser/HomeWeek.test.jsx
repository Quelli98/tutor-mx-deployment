import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HomeWeek } from './HomeWeek'
import { addDays, localMonday } from '../shared/scheduleWeek'

const weekStart = localMonday(new Date())
const at = (days, hour) => new Date(addDays(weekStart, days).setHours(hour, 0, 0, 0)).toISOString()

const week = {
  requirements: {
    status: 'success',
    data: [
      { id: 1, status: 'OPEN', startsAt: at(1, 14), shortageTutors: 2 },
      { id: 2, status: 'OPEN', startsAt: at(3, 9), shortageTutors: 1 },
      { id: 3, status: 'OPEN', startsAt: at(9, 9), shortageTutors: 4 },
    ],
  },
  report: {
    status: 'success',
    data: {
      courses: [{ allocatedHours: 100.5 }, { allocatedHours: 45.5 }],
      tutors: [{ capacityHours: 120 }, { capacityHours: 60 }, { capacityHours: null }],
    },
  },
  yearReport: {
    status: 'success',
    data: { courses: [{ budget: 78000, spend: 48360 }, { budget: null, spend: 900 }] },
  },
  tutors: { status: 'success', data: [] },
}

function tile(label) {
  return screen.getByText(label).closest('li')
}

describe('HomeWeek', () => {
  it('shows the week’s four figures, worked out from the server’s own numbers', () => {
    render(<HomeWeek weekStart={weekStart} onWeekChange={vi.fn()} week={week} approvals={{ status: 'success', totalPending: 12 }} />)

    expect(screen.getByRole('heading', { name: 'This week' })).toBeInTheDocument()
    expect(within(tile('Open requirements')).getByText('2')).toBeInTheDocument()
    expect(within(tile('Open requirements')).getByText('3 tutors still needed')).toBeInTheDocument()
    expect(within(tile('Waiting for you')).getByText('12')).toBeInTheDocument()
    expect(within(tile('Hours allocated')).getByText('146 h')).toBeInTheDocument()
    expect(within(tile('Hours allocated')).getByText('Of 180 h tutor capacity')).toBeInTheDocument()
    expect(within(tile('Budget used')).getByText('62%')).toBeInTheDocument()
    expect(within(tile('Budget used')).getByText('R48360.00 of R78000.00 this year')).toBeInTheDocument()
  })

  it('says a figure is unavailable instead of showing a wrong number', () => {
    render(
      <HomeWeek
        weekStart={weekStart}
        onWeekChange={vi.fn()}
        week={{ ...week, report: { status: 'error', data: null }, yearReport: { status: 'success', data: { courses: [] } } }}
        approvals={{ status: 'loading', totalPending: 0 }}
      />,
    )

    expect(within(tile('Hours allocated')).getByText('Hours could not be loaded')).toBeInTheDocument()
    expect(within(tile('Budget used')).getByText('No course budgets or rates set')).toBeInTheDocument()
    expect(within(tile('Waiting for you')).getByText('Loading…')).toBeInTheDocument()
  })

  it('moves the week backwards and forwards, and back to this week', () => {
    const onWeekChange = vi.fn()
    const { rerender } = render(<HomeWeek weekStart={weekStart} onWeekChange={onWeekChange} week={week} approvals={{ status: 'success', totalPending: 0 }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(onWeekChange).toHaveBeenLastCalledWith(addDays(weekStart, -7))
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(onWeekChange).toHaveBeenLastCalledWith(addDays(weekStart, 7))
    expect(screen.queryByRole('button', { name: 'This week' })).not.toBeInTheDocument()

    rerender(<HomeWeek weekStart={addDays(weekStart, 7)} onWeekChange={onWeekChange} week={week} approvals={{ status: 'success', totalPending: 0 }} />)
    expect(screen.getByRole('heading', { name: 'Selected week' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'This week' }))
    expect(onWeekChange).toHaveBeenLastCalledWith(weekStart)
  })
})
