import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import StudentSickNoteForm from './StudentSickNoteForm'
import StudentSickNoteQueue from './StudentSickNoteQueue'
const mocks = vi.hoisted(() => ({ token: vi.fn(), submit: vi.fn(), list: vi.fn(), decide: vi.fn(), refresh: vi.fn() }))
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ getAccessTokenSilently: mocks.token }) }))
vi.mock('../api/studentSickNotes', () => ({ submitStudentSickNote: mocks.submit, listStudentSickNotes: mocks.list, decideStudentSickNote: mocks.decide }))
const item = { id: 1, bookingId: 7, bookingVersion: 2, version: 1, studentName: 'Student One', tutorName: 'Tutor One', courseCode: 'COMS', startsAt: '2030-09-02T11:00:00Z', endsAt: '2030-09-02T12:00:00Z', reason: 'Unwell', status: 'PENDING', occurrenceStatus: 'SCHEDULED' }
const detail = { booking: { id: 7, version: 1 }, sickNotes: [], canSubmitSickNote: true }
beforeEach(() => { vi.resetAllMocks(); mocks.list.mockResolvedValue({ items: [item], pendingCount: 1, page: 1, hasMore: false }); mocks.submit.mockResolvedValue(item); mocks.decide.mockResolvedValue({ ...item, status: 'APPROVED' }); mocks.refresh.mockResolvedValue(undefined) })
it('shows a clear empty state for an eligible booking with no sick notes', () => {
 render(<StudentSickNoteForm detail={detail} refresh={mocks.refresh}/>);
 expect(screen.getByText('No sick notes submitted for this booking.')).toBeInTheDocument();
 expect(screen.getByText(/sick notes are linked to this booking/i)).toBeInTheDocument();
})
it('requires a reason, confirms once and sends the current booking version', async () => {
 let finish; mocks.submit.mockImplementation(() => new Promise(resolve => { finish = resolve }))
 render(<StudentSickNoteForm detail={detail} refresh={mocks.refresh}/>);
 expect(screen.getByRole('button', { name: 'Submit sick note' })).toBeDisabled()
 fireEvent.change(screen.getByLabelText('Reason for sick note'), { target: { value: 'Unwell' } }); fireEvent.click(screen.getByRole('button', { name: 'Submit sick note' }));
 expect(mocks.submit).not.toHaveBeenCalled(); const button = within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm sick note' }); fireEvent.click(button); fireEvent.click(button)
 expect(mocks.submit).toHaveBeenCalledOnce(); expect(mocks.submit).toHaveBeenCalledWith(7, { bookingVersion: 1, reason: 'Unwell' }, mocks.token); finish(item)
 await screen.findByText(/Sick note submitted/); expect(mocks.refresh).toHaveBeenCalledOnce()
})
it('shows the decision and review note and hides submission when ineligible', () => {
 render(<StudentSickNoteForm detail={{ ...detail, canSubmitSickNote: false, sickNotes: [{ ...item, status: 'REJECTED', reviewNote: 'Clarify date' }] }} refresh={mocks.refresh}/>);
 expect(screen.getByText('REJECTED')).toBeInTheDocument(); expect(screen.getByText('Review note: Clarify date')).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Submit sick note' })).not.toBeInTheDocument()
})
it.each([true, false])('recovers stale submissions and accurately reports refresh success=%s', async success => {
 mocks.submit.mockRejectedValue(Object.assign(new Error('Session changed'), { status: 409 })); if (!success) mocks.refresh.mockRejectedValue(new Error('Offline'))
 render(<StudentSickNoteForm detail={detail} refresh={mocks.refresh}/>); fireEvent.change(screen.getByLabelText('Reason for sick note'), { target: { value: 'Unwell' } }); fireEvent.click(screen.getByRole('button', { name: 'Submit sick note' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm sick note' }));
 await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(success ? 'Latest booking loaded' : 'Refresh failed: Offline'))
})
it('requires a rejection note, confirms and refreshes the Organiser queue', async () => {
 const count = vi.fn(); render(<StudentSickNoteQueue onCountChange={count}/>); expect(await screen.findByRole('button', { name: 'Reject request #1' })).toBeDisabled(); expect(count).toHaveBeenCalledWith(1)
 fireEvent.change(screen.getByLabelText('Review note for request #1'), { target: { value: 'Please clarify' } }); fireEvent.click(screen.getByRole('button', { name: 'Reject request #1' }));
 mocks.list.mockResolvedValue({ items: [{ ...item, status: 'REJECTED', reviewNote: 'Please clarify' }], pendingCount: 0, hasMore: false }); fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
 await screen.findByText('Sick note rejected.'); await screen.findByText('Review note: Please clarify'); expect(mocks.decide).toHaveBeenCalledWith(1, { version: 1, bookingVersion: 2, decision: 'REJECTED', reviewNote: 'Please clarify' }, mocks.token); expect(screen.queryByRole('button', { name: 'Approve request #1' })).not.toBeInTheDocument()
})
it('refreshes a stale Organiser view, removes invalid actions and recovers focus', async () => {
 render(<StudentSickNoteQueue/>); fireEvent.click(await screen.findByRole('button', { name: 'Approve request #1' })); mocks.decide.mockRejectedValue(Object.assign(new Error('Another Organiser acted'), { status: 409 })); mocks.list.mockResolvedValue({ items: [{ ...item, status: 'APPROVED' }], pendingCount: 0, hasMore: false }); fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
 await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Latest queue loaded'))
 expect(screen.queryByRole('button', { name: 'Approve request #1' })).not.toBeInTheDocument()
 // ConflictNotice focuses the alert in an effect after the message renders.
 await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
})
it('fails closed if refreshing after a conflict fails', async () => {
 render(<StudentSickNoteQueue/>); fireEvent.click(await screen.findByRole('button', { name: 'Approve request #1' })); mocks.decide.mockRejectedValue(Object.assign(new Error('Changed'), { status: 409 })); mocks.list.mockRejectedValue(new Error('Offline')); fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
 await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Refresh failed: Offline')); expect(screen.queryByRole('button', { name: 'Approve request #1' })).not.toBeInTheDocument()
})
it('does not submit two decisions while one is in flight', async () => {
 let finish; mocks.decide.mockImplementation(() => new Promise(resolve => { finish = resolve })); render(<StudentSickNoteQueue/>); fireEvent.click(await screen.findByRole('button', { name: 'Approve request #1' })); const button = screen.getByRole('button', { name: 'Confirm decision' }); fireEvent.click(button); fireEvent.click(button); expect(mocks.decide).toHaveBeenCalledOnce(); finish(item); await screen.findByText('Sick note approved.')
})
