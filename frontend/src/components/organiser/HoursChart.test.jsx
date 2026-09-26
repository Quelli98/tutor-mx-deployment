import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HoursChart } from './HoursChart'

const getWorkloadReport = vi.fn()
const getAccessTokenSilently = vi.fn()

vi.mock('../../api/organiser', () => ({
  getWorkloadReport: (...args) => getWorkloadReport(...args),
}))

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently }),
}))

const monday = new Date(2026, 8, 21)

function reportFor({ weekStart }) {
  const day = Number(weekStart.slice(-2))
  return Promise.resolve({
    period: { weekStart, weeks: 1 },
    courses: [
      { courseId: 1, allocatedHours: day, approvedWorkedHours: day - 1 },
      { courseId: 2, allocatedHours: 10.25, approvedWorkedHours: 10 },
    ],
    tutors: [],
  })
}

describe('HoursChart', () => {
  beforeEach(() => {
    getWorkloadReport.mockReset().mockImplementation(reportFor)
    getAccessTokenSilently.mockReset()
  })

  it('asks the server for one week at a time, ending with the chosen week', async () => {
    render(<HoursChart weekStart={monday} />)

    expect(await screen.findByRole('img', { name: /hours allocated and approved for the 8 weeks to 21 sep/i })).toBeInTheDocument()
    expect(getWorkloadReport).toHaveBeenCalledTimes(8)
    expect(getWorkloadReport).toHaveBeenCalledWith({ weekStart: '2026-08-03', weeks: 1 }, getAccessTokenSilently)
    expect(getWorkloadReport).toHaveBeenLastCalledWith({ weekStart: '2026-09-21', weeks: 1 }, getAccessTokenSilently)

    // The same figures, as a table for screen readers: 21 + 10.25 allocated, 20 + 10 approved.
    const lastRow = screen.getByRole('rowheader', { name: '21 Sept' }).closest('tr')
    expect(lastRow).toHaveTextContent('31.25 h')
    expect(lastRow).toHaveTextContent('30 h')
  })

  it('only fetches the weeks it has not seen when the period grows', async () => {
    render(<HoursChart weekStart={monday} />)
    await screen.findByRole('img', { name: /8 weeks/i })

    fireEvent.click(screen.getByRole('button', { name: '12 weeks' }))
    expect(await screen.findByRole('img', { name: /12 weeks/i })).toBeInTheDocument()
    expect(getWorkloadReport).toHaveBeenCalledTimes(12)
    expect(screen.getByRole('button', { name: '12 weeks' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: '4 weeks' }))
    expect(await screen.findByRole('img', { name: /4 weeks/i })).toBeInTheDocument()
    expect(getWorkloadReport).toHaveBeenCalledTimes(12)
  })

  it('offers a retry when the hours cannot be loaded', async () => {
    getWorkloadReport.mockRejectedValueOnce(new Error('internal detail'))
    render(<HoursChart weekStart={monday} />)

    expect(await screen.findByRole('heading', { name: /hours unavailable/i })).toBeInTheDocument()
    expect(screen.queryByText(/internal detail/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(screen.getByRole('img', { name: /8 weeks/i })).toBeInTheDocument())
  })
})
