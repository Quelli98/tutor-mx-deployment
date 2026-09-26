import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HomeHero } from './HomeHero'
import { OrganiserNameContext } from './organiserProfile'

const weekStart = new Date(2026, 8, 21)
const requirement = (id, day, shortageTutors) => ({
  id,
  status: 'OPEN',
  startsAt: new Date(2026, 8, day, 14).toISOString(),
  shortageTutors,
})

function renderHero({ name = 'Naledi Mokoena', hour = 9, requirements, approvals }) {
  render(
    <OrganiserNameContext.Provider value={name}>
      <HomeHero
        weekStart={weekStart}
        now={new Date(2026, 8, 22, hour)}
        week={{ requirements }}
        approvals={approvals}
      />
    </OrganiserNameContext.Provider>,
  )
}

describe('HomeHero', () => {
  it('greets the organiser by first name for the time of day', () => {
    renderHero({
      hour: 15,
      requirements: { status: 'loading', data: null },
      approvals: { status: 'loading', totalPending: 0 },
    })

    expect(screen.getByRole('heading', { name: 'Good afternoon, Naledi' })).toBeInTheDocument()
    expect(screen.getByText('Tuesday 22 September')).toBeInTheDocument()
    expect(screen.getByText('Here is how your tutoring week is shaping up.')).toBeInTheDocument()
  })

  it('sums up the week in one sentence', () => {
    renderHero({
      requirements: {
        status: 'success',
        data: [requirement(1, 22, 2), requirement(2, 23, 0), requirement(3, 24, 1), requirement(4, 30, 3)],
      },
      approvals: { status: 'success', totalPending: 1 },
    })

    expect(screen.getByRole('heading', { name: 'Good morning, Naledi' })).toBeInTheDocument()
    expect(
      screen.getByText('This week 2 sessions still need tutors, and 1 request is waiting for you.'),
    ).toBeInTheDocument()
  })

  it('says when nothing needs doing, and works without a name', () => {
    renderHero({
      name: null,
      hour: 19,
      requirements: { status: 'success', data: [requirement(1, 22, 0)] },
      approvals: { status: 'success', totalPending: 0 },
    })

    expect(screen.getByRole('heading', { name: 'Good evening' })).toBeInTheDocument()
    expect(
      screen.getByText('This week every session has its tutors, and nothing is waiting for your approval.'),
    ).toBeInTheDocument()
  })
})
