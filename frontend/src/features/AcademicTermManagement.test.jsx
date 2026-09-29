import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AcademicTermManagement from './AcademicTermManagement'
const create = vi.fn()
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ getAccessTokenSilently: 'token' }) }))
vi.mock('../api/timetableImport', () => ({
  listAcademicTerms: async () => [], createAcademicTerm: (...args) => create(...args),
  updateAcademicTerm: vi.fn(), deleteAcademicTerm: vi.fn(),
}))
beforeEach(() => { create.mockReset(); create.mockImplementation(async (input) => ({ id: 7, ...input })) })
describe('academic terms', () => {
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
