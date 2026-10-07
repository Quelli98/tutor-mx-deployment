import { fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ExcuseForm from './ExcuseForm'

const mockSubmitExcuse = vi.fn()
const mockFetchExcuseStatus = vi.fn()
const tokenGetter = vi.fn()
const allocations = [
  {
    id: 1,
    courseCode: 'DEMO101',
    startsAt: '2030-09-04T14:00:00.000Z',
    status: 'CONFIRMED',
  },
]

vi.mock('../api/excuse', () => ({
  submitExcuse: (...args) => mockSubmitExcuse(...args),
  fetchExcuseStatus: (...args) => mockFetchExcuseStatus(...args),
}))

function apiError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

describe('ExcuseForm', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    mockSubmitExcuse.mockReset()
    mockFetchExcuseStatus.mockReset()
  })

  it('does not submit without an assigned session and reason', () => {
    render(<ExcuseForm allocations={allocations} tokenOrGetter={tokenGetter} />)
    fireEvent.click(screen.getByRole('button', { name: /submit excuse/i }))

    expect(screen.getByLabelText(/^session$/i)).toHaveAccessibleDescription(/select the session/i)
    expect(screen.getByLabelText(/^reason$/i)).toHaveAccessibleDescription(/reason is required/i)
    expect(mockSubmitExcuse).not.toHaveBeenCalled()
  })

  it('submits an own session and shows confirmation', async () => {
    mockSubmitExcuse.mockResolvedValue({
      id: 3,
      allocationId: 1,
      reason: 'Sick',
      status: 'PENDING',
    })
    render(<ExcuseForm allocations={allocations} tokenOrGetter={tokenGetter} />)
    fireEvent.change(screen.getByLabelText(/^session$/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/^reason$/i), { target: { value: 'Sick' } })
    fireEvent.click(screen.getByRole('button', { name: /submit excuse/i }))

    await waitFor(() => {
      expect(mockSubmitExcuse).toHaveBeenCalledWith(
        { allocationId: 1, reason: 'Sick' },
        tokenGetter,
      )
    })
    expect(await screen.findByText(/excuse submitted/i)).toBeInTheDocument()
  })

  it('allows a retrospective sick submission', async () => {
    const pastAllocations = [
      {
        id: 2,
        courseCode: 'DEMO101',
        startsAt: '2020-09-04T14:00:00.000Z',
        status: 'CONFIRMED',
      },
    ]
    render(<ExcuseForm allocations={pastAllocations} tokenOrGetter={tokenGetter} />)
    fireEvent.change(screen.getByLabelText(/^session$/i), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(/^reason$/i), { target: { value: 'Sick' } })
    fireEvent.click(screen.getByRole('button', { name: /submit excuse/i }))

    await waitFor(() => expect(mockSubmitExcuse).toHaveBeenCalledWith({ allocationId: 2, reason: 'Sick' }, tokenGetter))
  })

  it('explains when the session was already excused', async () => {
    mockSubmitExcuse.mockRejectedValueOnce(
      apiError('EXCUSE_DUPLICATE', 'An excuse has already been submitted for this session.'),
    )
    render(<ExcuseForm allocations={allocations} tokenOrGetter={tokenGetter} />)
    fireEvent.change(screen.getByLabelText(/^session$/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/^reason$/i), { target: { value: 'Sick' } })
    fireEvent.click(screen.getByRole('button', { name: /submit excuse/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /an excuse has already been submitted for this session/i,
    )
    expect(mockFetchExcuseStatus).not.toHaveBeenCalled()
  })

  it('hands the submitted excuse to the status section', async () => {
    mockSubmitExcuse.mockResolvedValueOnce({
      id: 3,
      allocationId: 1,
      reason: 'Sick',
      status: 'PENDING',
    })
    render(<ExcuseForm allocations={allocations} tokenOrGetter={tokenGetter} />)
    fireEvent.change(screen.getByLabelText(/^session$/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/^reason$/i), { target: { value: 'Sick' } })
    fireEvent.click(screen.getByRole('button', { name: /submit excuse/i }))

    expect(await screen.findByText(/excuse submitted/i)).toBeInTheDocument()
    const statusSection = screen.getByRole('region', { name: /submitted excuses/i })
    expect(await within(statusSection).findByText(/DEMO101/)).toBeInTheDocument()
    expect(
      within(statusSection).getByText(/waiting for the organiser decision/i),
    ).toBeInTheDocument()
    expect(mockFetchExcuseStatus).not.toHaveBeenCalled()
  })
})
