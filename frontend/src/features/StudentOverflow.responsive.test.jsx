import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { StudentOverflow } from './StudentOverflow'

const studentAccessTokenGetter = vi.hoisted(() =>
  vi.fn().mockResolvedValue('test-token'),
)
vi.mock('../api/client', () => ({
  useApiClient: () => vi.fn(),
  useApiToken: () => studentAccessTokenGetter,
}))

describe('StudentOverflow at the agreed 360px phone width', () => {
  it('keeps the primary action and supporting sections available', async () => {
    window.innerWidth = 360
    window.dispatchEvent(new Event('resize'))

    const { container } = render(
      <MemoryRouter>
        <StudentOverflow
          loadWorkItems={vi.fn().mockResolvedValue([
            {
              id: 4,
              courseCode: 'DEMO101',
              courseName: 'Demo Course',
              startsAt: '2030-09-06T10:00:00.000Z',
              endsAt: '2030-09-06T12:00:00.000Z',
              hours: 2,
              status: 'OPEN',
              closesAt: null,
            },
          ])}
          claimWork={vi.fn()}
          loadRequests={vi.fn().mockResolvedValue([])}
          loadHolidays={vi.fn().mockResolvedValue({
            source: 'fallback',
            holidays: [],
            retrievedAt: null,
          })}
        />
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('button', { name: /^volunteer$/i }),
    ).toBeVisible()
    expect(
      screen.getByRole('heading', { name: /my volunteer requests/i }),
    ).toBeVisible()
    expect(
      screen.getByRole('heading', { name: /upcoming public holidays/i }),
    ).toBeVisible()
    expect(screen.getByRole('list', { name: 'Available volunteer work by day' })).toBeVisible()
    expect(container.querySelector('.public-holidays-section')).toBeInTheDocument()
  })
})
