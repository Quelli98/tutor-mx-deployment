import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ExcuseForm from './ExcuseForm'

const mockSubmitExcuse = vi.fn()
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
}))

describe('ExcuseForm', () => {
  beforeEach(() => {
    mockSubmitExcuse.mockReset()
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
})
