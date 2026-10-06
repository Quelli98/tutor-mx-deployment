import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { StudentHero } from './StudentHero'
import { StudentSchedule } from './StudentSchedule'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T14:00:00'))
})
afterEach(() => { vi.useRealTimers() })

const empty = { openCount: 0, pendingCount: 0, upcomingCount: 0, nextSession: null, approvedHours: 0 }

describe('StudentHero', () => {
  const text = () => document.querySelector('.student-hero-text').textContent

  it('welcomes the student by first name with the day and their week, figures picked out', () => {
    render(<StudentHero name="Thandi Mokoena" workReady requestsReady
      summary={{ ...empty, openCount: 3, nextSession: { startsAt: '2026-10-07T09:00:00' } }} />)

    expect(screen.getByRole('heading', { name: 'Welcome back, Thandi!' })).toBeInTheDocument()
    expect(screen.getByText('Good afternoon · Tuesday 6 October')).toBeInTheDocument()
    expect(text()).toBe('3 sessions are looking for volunteers. Your next volunteer session is on Wed 7 Oct at 09:00.')
    expect(screen.getByText('3', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('Wed 7 Oct at 09:00', { selector: 'strong' })).toBeInTheDocument()
  })

  it('never greets someone by their email address', () => {
    render(<StudentHero name="woyac78803@cwsgear.com" workReady requestsReady={false} summary={empty} />)
    expect(screen.getByRole('heading', { name: 'Welcome back!' })).toBeInTheDocument()
    expect(screen.queryByText(/cwsgear/)).not.toBeInTheDocument()
  })

  it('mentions waiting requests when nothing is booked, and copes without data', () => {
    const { rerender } = render(<StudentHero name={null} workReady requestsReady summary={{ ...empty, openCount: 1, pendingCount: 2 }} />)
    expect(screen.getByRole('heading', { name: 'Welcome back!' })).toBeInTheDocument()
    expect(text()).toBe('1 session is looking for volunteers. 2 requests are waiting for an organiser.')

    rerender(<StudentHero name="Thandi" workReady={false} requestsReady={false} summary={empty} />)
    expect(text()).toBe('Find open tutoring work, volunteer and follow each request outcome.')

    rerender(<StudentHero name="Thandi" workReady requestsReady={false} summary={empty} />)
    expect(text()).toBe('No sessions need volunteers right now.')
  })

  it('takes the student to the open work or their timetable', () => {
    render(
      <>
        <StudentHero name="Thandi" workReady requestsReady summary={empty} />
        <h2 id="available-work-heading" tabIndex={-1}>Available volunteer work</h2>
      </>,
    )
    const heading = screen.getByRole('heading', { name: 'Available volunteer work' })
    heading.scrollIntoView = vi.fn()

    fireEvent.click(screen.getByRole('button', { name: 'Browse open work' }))

    expect(heading.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(heading).toHaveFocus()
    expect(screen.getByRole('link', { name: 'My timetable' })).toHaveAttribute('href', '/student/timetable')
  })
})

describe('StudentSchedule', () => {
  const slots = {
    status: 'success',
    data: [{
      id: 9, type: 'BUSY', startsAt: '2026-09-22T16:00:00', endsAt: '2026-09-22T17:00:00',
      recurrence: 'WEEKLY', label: 'Physics tutorial', recurrenceUntil: null, category: 'CLASS', exceptions: [],
    }],
  }
  const requests = [{
    id: 4, status: 'ACCEPTED', courseCode: 'COMS3011A', hours: 2,
    startsAt: '2026-10-08T09:00:00', endsAt: '2026-10-08T11:00:00',
  }]

  it("shows the month with today and planned days, and what is coming up", () => {
    render(<StudentSchedule slots={slots} requests={requests} />)

    const calendar = screen.getByRole('table', { name: 'October 2026 calendar' })
    expect(within(calendar).getByText('6').closest('.mini-calendar-day')).toHaveClass('today', 'has-plans')
    expect(within(calendar).getByText('8').closest('.mini-calendar-day')).toHaveClass('volunteering')
    expect(within(calendar).getByText('9').closest('.mini-calendar-day')).not.toHaveClass('has-plans')

    const today = screen.getByText('Today', { selector: '.student-agenda-group' }).nextElementSibling
    expect(today).toHaveTextContent('Physics tutorial')
    const week = screen.getByText('This week', { selector: '.student-agenda-group' }).nextElementSibling
    expect(within(week).getAllByRole('listitem').map((item) => item.querySelector('strong').textContent))
      .toEqual(['COMS3011A volunteer session'])
    expect(screen.getByRole('link', { name: 'Open timetable' })).toHaveAttribute('href', '/student/timetable')
  })

  it('moves between months', () => {
    render(<StudentSchedule slots={slots} requests={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByRole('table', { name: 'November 2026 calendar' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByRole('table', { name: 'September 2026 calendar' })).toBeInTheDocument()
  })

  it('still shows volunteer sessions when the timetable fails, and says when nothing is planned', () => {
    const { rerender } = render(<StudentSchedule slots={{ status: 'error', data: [] }} requests={requests} />)
    expect(screen.getByText(/timetable could not be loaded/)).toBeInTheDocument()
    expect(screen.getByText('COMS3011A volunteer session')).toBeInTheDocument()

    rerender(<StudentSchedule slots={{ status: 'success', data: [] }} requests={[]} />)
    expect(screen.getByText('Nothing planned for the next 7 days.')).toBeInTheDocument()

    rerender(<StudentSchedule slots={{ status: 'loading', data: [] }} requests={[]} />)
    expect(screen.getByText('Loading your schedule…')).toBeInTheDocument()
  })
})
