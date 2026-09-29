import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AcademicTermManagement from './AcademicTermManagement'
const list = vi.fn()
const create = vi.fn()
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ getAccessTokenSilently: 'token' }) }))
vi.mock('../api/timetableImport', () => ({
  listAcademicTerms: (...args) => list(...args), createAcademicTerm: (...args) => create(...args),
  updateAcademicTerm: vi.fn(), deleteAcademicTerm: vi.fn(),
}))
beforeEach(() => {
  list.mockReset().mockResolvedValue([])
  create.mockReset(); create.mockImplementation(async (input) => ({ id: 7, ...input }))
})
describe('academic terms', () => {
  it('moves an existing term into the edit form when its Edit button is used', async () => {
    list.mockResolvedValue([{
      id: 13,
      name: 'Semester 2 Term 3',
      startsOn: '2026-07-20',
      endsOn: '2026-09-04',
      year: 2026,
      termNumber: 3,
      published: true,
      teachingBreaks: [],
    }])

    render(<AcademicTermManagement />)
    await screen.findByText('Semester 2 Term 3')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Term 3' }))

    expect(screen.getByRole('heading', { name: 'Edit term' })).toBeInTheDocument()
    expect(screen.getByLabelText('Display name (optional)')).toHaveValue('Semester 2 Term 3')
    expect(screen.getByLabelText('Term number')).toHaveValue('3')
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-07-20')
  })

  it('moves a term from the Existing terms list into the same edit form', async () => {
    list.mockResolvedValue([{
      id: 14,
      name: 'Semester 2 Term 4',
      startsOn: '2026-09-14',
      endsOn: '2026-10-27',
      year: 2026,
      termNumber: 4,
      published: true,
      teachingBreaks: [],
    }])

    render(<AcademicTermManagement />)
    const existing = await screen.findByRole('list', { name: 'Academic terms' })
    fireEvent.click(within(existing).getByRole('button', { name: 'Edit' }))

    expect(screen.getByRole('heading', { name: 'Edit term' })).toBeInTheDocument()
    expect(screen.getByLabelText('Display name (optional)')).toHaveValue('Semester 2 Term 4')
  })

  it.each(['1','2','3','4'])('creates Term %s with an explicit year and dates', async (number) => {
    render(<AcademicTermManagement />)
    await screen.findByText('No academic terms have been created yet.')
    expect(screen.getByRole('list', { name: 'Four academic terms' })).toHaveTextContent('Term 4')
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2026' } })
    fireEvent.change(screen.getByLabelText('Term number'), { target: { value: number } })
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-28' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-11-30' } })
    fireEvent.click(screen.getByLabelText(/Published/))
    fireEvent.click(screen.getByRole('button', { name: 'Create term' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ year: 2026, termNumber: Number(number), published: true, name: `Term ${number}, 2026` }), 'token'))
  })
})
