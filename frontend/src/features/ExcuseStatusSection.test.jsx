import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ExcuseStatusSection from './ExcuseStatusSection'

const mockFetchExcuseStatus = vi.fn()
const tokenGetter = vi.fn()

vi.mock('../api/excuse', () => ({
  fetchExcuseStatus: (...args) => mockFetchExcuseStatus(...args),
}))

const STORAGE_KEY = 'tutormx.tutorExcuses'

const allocations = [
  { id: 1, courseCode: 'DEMO101', startsAt: '2030-09-04T14:00:00.000Z', status: 'CONFIRMED' },
]

const pendingExcuse = {
  id: 5,
  allocationId: 1,
  reason: 'Medical appointment',
  status: 'PENDING',
  reviewReason: null,
  createdAt: '2030-09-03T08:00:00.000Z',
  updatedAt: '2030-09-03T08:00:00.000Z',
}

const approvedExcuse = {
  ...pendingExcuse,
  status: 'APPROVED',
  updatedAt: '2030-09-05T09:00:00.000Z',
}

const rejectedExcuse = {
  ...pendingExcuse,
  status: 'REJECTED',
  reviewReason: 'Insufficient evidence',
  updatedAt: '2030-09-05T09:00:00.000Z',
}

function apiError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function storeExcuses(summaries, scope = null) {
  const key = scope ? `${STORAGE_KEY}.${scope}` : STORAGE_KEY
  window.sessionStorage.setItem(key, JSON.stringify(summaries))
}

describe('ExcuseStatusSection', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    mockFetchExcuseStatus.mockReset()
    tokenGetter.mockReset()
  })

  it('shows guidance when no excuses are tracked yet', () => {
    render(<ExcuseStatusSection tokenOrGetter={tokenGetter} />)

    expect(screen.getByText(/no excuses submitted yet/i)).toBeInTheDocument()
    expect(mockFetchExcuseStatus).not.toHaveBeenCalled()
  })

  it('tracks a fresh form submission as pending without refetching', () => {
    render(
      <ExcuseStatusSection
        submitted={{ id: 5, allocationId: 1, reason: 'Medical appointment', status: 'PENDING' }}
        allocations={allocations}
        tokenOrGetter={tokenGetter}
      />,
    )

    expect(screen.getByText(/DEMO101/)).toBeInTheDocument()
    expect(screen.getByText(/waiting for the organiser decision/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /check for decision/i })).toBeInTheDocument()
    expect(mockFetchExcuseStatus).not.toHaveBeenCalled()
  })

  it('does not show excuses cached for another signed-in tutor', () => {
    storeExcuses([pendingExcuse], 'auth0|other-tutor')

    render(
      <ExcuseStatusSection
        allocations={allocations}
        tokenOrGetter={tokenGetter}
        storageScope="auth0|current-tutor"
      />,
    )

    expect(screen.getByText(/no excuses submitted yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/waiting for the organiser decision/i)).not.toBeInTheDocument()
  })

  it('restores a stored pending excuse and shows the organiser approval after checking', async () => {
    storeExcuses([pendingExcuse])
    mockFetchExcuseStatus
      .mockResolvedValueOnce(pendingExcuse)
      .mockResolvedValueOnce(approvedExcuse)
    render(<ExcuseStatusSection allocations={allocations} tokenOrGetter={tokenGetter} />)

    fireEvent.click(await screen.findByRole('button', { name: /check for decision/i }))

    expect(mockFetchExcuseStatus).toHaveBeenCalledWith(5, tokenGetter)
    expect(await screen.findByText(/approved by the organiser/i)).toBeInTheDocument()
  })

  it('shows the organiser note on a rejected excuse', async () => {
    storeExcuses([rejectedExcuse])
    mockFetchExcuseStatus.mockResolvedValue(rejectedExcuse)
    render(<ExcuseStatusSection allocations={allocations} tokenOrGetter={tokenGetter} />)

    expect(await screen.findByText(/rejected by the organiser/i)).toBeInTheDocument()
    expect(screen.getByText(/organiser note: insufficient evidence/i)).toBeInTheDocument()
  })

  it('drops a stored excuse the server no longer knows', async () => {
    storeExcuses([pendingExcuse])
    mockFetchExcuseStatus.mockRejectedValueOnce(
      apiError('EXCUSE_NOT_FOUND', 'The requested excuse could not be found.'),
    )
    render(<ExcuseStatusSection allocations={allocations} tokenOrGetter={tokenGetter} />)

    expect(await screen.findByText(/no excuses submitted yet/i)).toBeInTheDocument()
    expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY))).toEqual([])
  })

  it('refetches the decision quietly when the window regains focus', async () => {
    mockFetchExcuseStatus.mockResolvedValueOnce(rejectedExcuse)
    render(
      <ExcuseStatusSection
        submitted={{ id: 5, allocationId: 1, reason: 'Medical appointment', status: 'PENDING' }}
        allocations={allocations}
        tokenOrGetter={tokenGetter}
      />,
    )

    expect(await screen.findByText(/waiting for the organiser decision/i)).toBeInTheDocument()

    fireEvent(window, new Event('focus'))

    expect(await screen.findByText(/rejected by the organiser/i)).toBeInTheDocument()
    expect(screen.getByText(/organiser note: insufficient evidence/i)).toBeInTheDocument()
  })

  it('does not stack refreshes when focus fires while a check is running', async () => {
    storeExcuses([pendingExcuse])
    mockFetchExcuseStatus.mockImplementationOnce(() => new Promise(() => {}))
    render(<ExcuseStatusSection allocations={allocations} tokenOrGetter={tokenGetter} />)

    await waitFor(() => expect(mockFetchExcuseStatus).toHaveBeenCalledTimes(1))
    fireEvent(window, new Event('focus'))
    fireEvent(window, new Event('focus'))

    expect(mockFetchExcuseStatus).toHaveBeenCalledTimes(1)
  })

  it('labels a stored session that is no longer assigned', async () => {
    storeExcuses([pendingExcuse])
    mockFetchExcuseStatus.mockResolvedValue(pendingExcuse)
    render(<ExcuseStatusSection allocations={[]} tokenOrGetter={tokenGetter} />)

    expect(await screen.findByText('Session 1')).toBeInTheDocument()
    expect(screen.getByText(/waiting for the organiser decision/i)).toBeInTheDocument()
  })

  it('shows a safe message when the status check fails', async () => {
    storeExcuses([pendingExcuse])
    mockFetchExcuseStatus
      .mockResolvedValueOnce(pendingExcuse)
      .mockRejectedValueOnce(apiError('REQUEST_FAILED', 'The request failed.'))
    render(<ExcuseStatusSection allocations={allocations} tokenOrGetter={tokenGetter} />)

    fireEvent.click(await screen.findByRole('button', { name: /check for decision/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be checked/i)
    expect(screen.getByText(/waiting for the organiser decision/i)).toBeInTheDocument()
  })
})
