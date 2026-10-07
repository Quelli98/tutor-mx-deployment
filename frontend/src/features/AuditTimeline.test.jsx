import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import AuditTimeline from './AuditTimeline'
import AllocationRestore from './AllocationRestore'
const mocks = vi.hoisted(() => ({ token: vi.fn(), list: vi.fn(), get: vi.fn(), export: vi.fn(), history: vi.fn(), preview: vi.fn(), restore: vi.fn(), refreshed: vi.fn() }))
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ getAccessTokenSilently: mocks.token }) }))
vi.mock('../api/audit', () => ({ listAudit: mocks.list, getAudit: mocks.get, exportAudit: mocks.export, allocationHistory: mocks.history, previewRestore: mocks.preview, restoreAllocation: mocks.restore }))
const allocation = { id: 7, tutorId: 3, courseId: 1, startsAt: '2030-09-02T08:00:00Z', endsAt: '2030-09-02T10:00:00Z', allocatedHours: 2, status: 'CONFIRMED', version: 2 }
const event = { id: 1, actorId: 9, actorName: 'Organiser One', action: 'ALLOCATION_UPDATED', targetType: 'allocation', targetId: 7, reason: 'Correct assignment', createdAt: '2030-09-01T12:00:00Z', before: { ...allocation, allocatedHours: 1 }, after: allocation }
const preview = { current: allocation, historical: { ...allocation, allocatedHours: 1 }, expectedVersion: 2, eventId: 1, side: 'after', canRestore: true, reasons: [] }
beforeEach(() => {
 vi.resetAllMocks(); window.history.replaceState({}, '', '/'); mocks.list.mockResolvedValue({ items: [event], page: 1, hasMore: false }); mocks.get.mockResolvedValue(event); mocks.history.mockResolvedValue({ items: [event] }); mocks.preview.mockResolvedValue(preview); mocks.restore.mockResolvedValue({ allocationId: 8 }); mocks.refreshed.mockResolvedValue(undefined)
})
it('shows actor/action/target context and redacted before/after detail', async () => {
 render(<AuditTimeline/>); fireEvent.click(await screen.findByRole('button', { name: 'Audit details #1' })); const detail = await screen.findByRole('region', { name: 'Audit event details' }); expect(detail).toHaveTextContent('Organiser One'); expect(within(detail).getByRole('region', { name: 'Audit before and after' })).toHaveTextContent('Allocated Hours'); expect(detail).toHaveTextContent('Correct assignment'); expect(await screen.findByRole('button', { name: 'Preview restore' })).toBeEnabled()
})
it('applies date, actor, action and target filters and resets pagination', async () => {
 render(<AuditTimeline/>); await screen.findByRole('button', { name: 'Audit details #1' }); fireEvent.change(screen.getByLabelText('Actor ID'), { target: { value: '9' } }); fireEvent.change(screen.getByLabelText('Target type'), { target: { value: 'allocation' } }); fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'ALLOCATION_UPDATED' } }); fireEvent.change(screen.getByLabelText('Audit from'), { target: { value: '2030-09-01T00:00' } }); fireEvent.click(screen.getByRole('button', { name: 'Apply audit filters' })); await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ actorId: '9', targetType: 'allocation', action: 'ALLOCATION_UPDATED', from: '2030-08-31T22:00:00.000Z', page: 1 }, mocks.token))
})
it('opens target context from the audit link and exports applied filters', async () => {
 window.history.replaceState({}, '', '/?auditTarget=allocation&auditTargetId=7'); mocks.export.mockResolvedValue({ csv: 'id,reason\r\n1,safe\r\n', count: 1 }); const create = vi.fn(() => 'blob:audit'), revoke = vi.fn(); Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke }); const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
 render(<AuditTimeline/>); await screen.findByRole('button', { name: 'Audit details #1' }); fireEvent.click(screen.getByRole('button', { name: 'Export audit CSV' })); await screen.findByText('Exported 1 redacted audit events.'); expect(mocks.export).toHaveBeenCalledWith({ targetType: 'allocation', targetId: '7' }, mocks.token); expect(create).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce(); click.mockRestore()
})
it('requires a preview and reason, then sends the displayed version on confirmation', async () => {
 render(<AllocationRestore allocationId={7} eventId={1} onRestored={mocks.refreshed}/>); expect(screen.queryByRole('button', { name: 'Restore these values' })).not.toBeInTheDocument(); fireEvent.click(await screen.findByRole('button', { name: 'Preview restore' })); const comparison = await screen.findByRole('region', { name: 'Restore comparison' }); expect(comparison).toHaveTextContent('Current'); expect(comparison).toHaveTextContent('Historical'); expect(screen.getByRole('button', { name: 'Restore these values' })).toBeDisabled(); fireEvent.change(screen.getByLabelText('Reason for restore'), { target: { value: 'Fix mistaken hours' } }); fireEvent.click(screen.getByRole('button', { name: 'Restore these values' })); expect(mocks.restore).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' })); await screen.findByText(/Restored as allocation #8/); expect(mocks.restore).toHaveBeenCalledWith(7, { eventId: 1, side: 'after', expectedVersion: 2, reason: 'Fix mistaken hours' }, mocks.token); expect(mocks.refreshed).toHaveBeenCalledOnce()
})
it('does not offer restore when the preview fails current rules', async () => {
 mocks.preview.mockResolvedValue({ ...preview, canRestore: false, reasons: ['insufficient-mark'] }); render(<AllocationRestore allocationId={7} eventId={1}/>); fireEvent.click(await screen.findByRole('button', { name: 'Preview restore' })); await screen.findByText('insufficient-mark'); expect(screen.queryByRole('button', { name: 'Restore these values' })).not.toBeInTheDocument()
})
it('invalidates the preview when the selected historical side changes', async () => {
 render(<AllocationRestore allocationId={7} eventId={1}/>); fireEvent.click(await screen.findByRole('button', { name: 'Preview restore' })); await screen.findByRole('region', { name: 'Restore comparison' }); fireEvent.change(screen.getByLabelText('Historical values'), { target: { value: 'before' } }); expect(screen.queryByRole('region', { name: 'Restore comparison' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Restore these values' })).not.toBeInTheDocument()
})
it('removes a stale restore action and requires another preview after a conflict', async () => {
 mocks.restore.mockRejectedValue(Object.assign(new Error('Allocation changed'), { status: 409 })); render(<AllocationRestore allocationId={7} eventId={1}/>); fireEvent.click(await screen.findByRole('button', { name: 'Preview restore' })); await screen.findByRole('region', { name: 'Restore comparison' }); fireEvent.change(screen.getByLabelText('Reason for restore'), { target: { value: 'Correct' } }); fireEvent.click(screen.getByRole('button', { name: 'Restore these values' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Preview again before retrying')); expect(screen.queryByRole('button', { name: 'Restore these values' })).not.toBeInTheDocument()
})
it('explains a bounded export refusal instead of downloading incomplete data', async () => {
 mocks.export.mockRejectedValue(new Error('Narrow the filters to export at most 1,000 events.')); render(<AuditTimeline/>); fireEvent.click(screen.getByRole('button', { name: 'Export audit CSV' })); expect(await screen.findByRole('alert')).toHaveTextContent('at most 1,000 events')
})
