import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BulkAllocation from './BulkAllocation'

const listStaffingRequirements = vi.fn()
const previewBulkAllocations = vi.fn()
const commitBulkAllocations = vi.fn()
const getAccessTokenSilently = vi.fn()

vi.mock('../api/organiser', () => ({
  listStaffingRequirements: (...args) => listStaffingRequirements(...args),
  previewBulkAllocations: (...args) => previewBulkAllocations(...args),
  commitBulkAllocations: (...args) => commitBulkAllocations(...args),
}))

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently }),
}))

const requirement = {
  id: 100,
  courseId: 10,
  courseCode: 'COMS3011',
  courseName: 'Software Design Project',
  startsAt: '2030-09-04T10:00:00.000Z',
  endsAt: '2030-09-04T14:00:00.000Z',
  windowHours: 4,
  tutorsNeeded: 2,
  requiredHours: 8,
  assignedHours: 0,
  shortageHours: 8,
  shortageTutors: 2,
  fillState: 'unfilled',
  status: 'OPEN',
  notes: null,
  createdById: 8,
  createdAt: '2026-09-24T09:00:00.000Z',
  updatedAt: '2026-09-24T09:00:00.000Z',
}

const proposal = {
  tutorId: 7,
  fullName: 'Sam Tutor',
  hours: 4,
  mark: 84,
  markBand: 80,
  usedHours: 2,
  weeklyLimit: 10,
}

const alternative = {
  tutorId: 9,
  fullName: 'Ash Tutor',
  hours: 4,
  mark: 88,
  markBand: 80,
  usedHours: 7,
  weeklyLimit: 10,
}

const previewItem = {
  requirementId: 100,
  courseId: 10,
  courseCode: 'COMS3011',
  courseName: 'Software Design Project',
  startsAt: '2030-09-04T10:00:00.000Z',
  endsAt: '2030-09-04T14:00:00.000Z',
  windowHours: 4,
  shortageHours: 8,
  tutorsWanted: 2,
  proposals: [proposal],
  unfilled: 1,
  note: '1 of 2 places could be proposed; no further eligible tutor is free for this session.',
  alternatives: [alternative],
}

function renderPage() {
  render(
    <MemoryRouter>
      <BulkAllocation />
    </MemoryRouter>,
  )
}

async function previewOne() {
  renderPage()
  fireEvent.click(await screen.findByLabelText(/COMS3011/i))
  fireEvent.click(screen.getByRole('button', { name: /preview allocations/i }))
  return screen.findByRole('heading', { name: /^preview$/i })
}

describe('BulkAllocation', () => {
  beforeEach(() => {
    listStaffingRequirements.mockReset().mockResolvedValue([requirement])
    previewBulkAllocations.mockReset().mockResolvedValue([previewItem])
    commitBulkAllocations.mockReset().mockResolvedValue([
      { requirementId: 100, tutorId: 7, outcome: 'saved', allocationId: 41 },
    ])
    getAccessTokenSilently.mockReset()
  })

  it('lists only open requirements that still need filling', async () => {
    renderPage()

    expect(await screen.findByLabelText(/COMS3011/i)).toBeInTheDocument()
    expect(screen.getByText(/8 tutor hours short, 2 tutors needed/i)).toBeVisible()
    expect(listStaffingRequirements).toHaveBeenCalledWith(
      { status: 'OPEN' },
      getAccessTokenSilently,
    )
  })

  it('keeps the shortage on its own line, apart from the session label', async () => {
    renderPage()
    const label = await screen.findByLabelText(/COMS3011/i)
    const text = label.closest('li').querySelector('label')

    // The two parts must not run together as "…at 14:0012 tutor hours short".
    // jsdom does no layout, so the guard is structural: the shortage is its own
    // element, which App.css lays out as a separate line.
    const shortage = within(text).getByText(/tutor hours short/i)
    expect(shortage.tagName).toBe('SPAN')
    expect(shortage).toHaveClass('helper-text')
    expect(text.firstChild.textContent).not.toMatch(/tutor hours short/i)
  })

  it('previews the chosen requirements and saves nothing yet', async () => {
    await previewOne()

    expect(previewBulkAllocations).toHaveBeenCalledWith(
      { requirementIds: [100], minimumMark: 65 },
      getAccessTokenSilently,
    )
    // Preview must not write: the commit call is what saves.
    expect(commitBulkAllocations).not.toHaveBeenCalled()
    expect(screen.getByText(/ranked by mark band, then who is least busy that week/i)).toBeVisible()
    expect(screen.getByText(/nothing here is saved yet/i)).toBeVisible()
  })

  it('shows the factors behind each proposal', async () => {
    await previewOne()

    const chips = screen.getByRole('list', { name: /why Sam Tutor is proposed/i })
    expect(within(chips).getByText('Mark 84%')).toBeVisible()
    expect(within(chips).getByText('2 of 10 hours used that week')).toBeVisible()
    expect(within(chips).getByText('4 tutor hours')).toBeVisible()
  })

  it('says when a requirement could not be filled completely', async () => {
    await previewOne()

    expect(screen.getByText(/1 of 2 places could be proposed/i)).toBeVisible()
  })

  it('commits the accepted proposal with no reason', async () => {
    await previewOne()
    fireEvent.click(screen.getByRole('button', { name: /confirm 1 allocation/i }))

    await waitFor(() => expect(commitBulkAllocations).toHaveBeenCalled())
    expect(commitBulkAllocations.mock.calls[0][0]).toEqual({
      minimumMark: 65,
      items: [{ requirementId: 100, tutorId: 7, proposedTutorId: 7 }],
    })
  })

  it('excludes an item the organiser unticks', async () => {
    await previewOne()
    fireEvent.click(screen.getByLabelText(/include Sam Tutor/i))

    expect(screen.getByRole('button', { name: /confirm 0 allocations/i })).toBeDisabled()
  })

  it('offers only eligible alternatives as replacements', async () => {
    await previewOne()

    const picker = screen.getByLabelText(/^tutor$/i)
    const options = within(picker)
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(options).toEqual(['Sam Tutor (proposed)', 'Ash Tutor'])
  })

  it('blocks confirming a changed tutor until a reason is given', async () => {
    await previewOne()
    fireEvent.change(screen.getByLabelText(/^tutor$/i), { target: { value: '9' } })

    expect(screen.getByLabelText(/why this tutor instead/i)).toBeVisible()
    expect(screen.getByRole('button', { name: /confirm 1 allocation/i })).toBeDisabled()
    expect(screen.getByText(/give a reason for choosing a different tutor/i)).toBeVisible()
  })

  it('sends the reason with the changed tutor', async () => {
    await previewOne()
    fireEvent.change(screen.getByLabelText(/^tutor$/i), { target: { value: '9' } })
    fireEvent.change(screen.getByLabelText(/why this tutor instead/i), {
      target: { value: 'Ash knows this lab.' },
    })

    const confirm = screen.getByRole('button', { name: /confirm 1 allocation/i })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)

    await waitFor(() => expect(commitBulkAllocations).toHaveBeenCalled())
    expect(commitBulkAllocations.mock.calls[0][0].items).toEqual([
      {
        requirementId: 100,
        tutorId: 9,
        proposedTutorId: 7,
        overrideReason: 'Ash knows this lab.',
      },
    ])
  })

  it('reports each item after confirming, saved or not', async () => {
    commitBulkAllocations.mockResolvedValue([
      { requirementId: 100, tutorId: 7, outcome: 'saved', allocationId: 41 },
      {
        requirementId: 100,
        tutorId: 9,
        outcome: 'failed',
        code: 'schedule-clash',
        message: 'The tutor has a timetable clash for this allocation.',
      },
    ])

    await previewOne()
    fireEvent.click(screen.getByRole('button', { name: /confirm 1 allocation/i }))

    const results = await screen.findByRole('heading', { name: /^results$/i })
    const section = results.closest('section')
    expect(within(section).getByText('Saved')).toBeVisible()
    expect(within(section).getByText('Not saved')).toBeVisible()
    expect(within(section).getByText(/timetable clash/i)).toBeVisible()
  })

  it('explains a failed preview without leaking detail', async () => {
    previewBulkAllocations.mockRejectedValue(
      Object.assign(new Error('private detail'), { code: 'REQUEST_FAILED' }),
    )

    renderPage()
    fireEvent.click(await screen.findByLabelText(/COMS3011/i))
    fireEvent.click(screen.getByRole('button', { name: /preview allocations/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /preview could not be produced safely/i,
    )
    expect(screen.queryByText(/private detail/i)).not.toBeInTheDocument()
  })

  it('says so when nothing needs filling', async () => {
    listStaffingRequirements.mockResolvedValue([
      { ...requirement, shortageTutors: 0, shortageHours: 0, fillState: 'fully-filled' },
    ])

    renderPage()

    expect(await screen.findByRole('heading', { name: /nothing needs filling/i })).toBeVisible()
  })
})
