import { useRef, useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { ConfirmationDialog } from './ConfirmationDialog'
import { DensityToggle } from './DensityToggle'
import WeeklySchedule from './WeeklySchedule'
function Recovery() {
 const heading = useRef(null), [open, setOpen] = useState(false), [done, setDone] = useState(false)
 return <><h2 ref={heading} tabIndex={-1}>Outcome</h2>{!done && <button onClick={() => setOpen(true)}>Review</button>}<ConfirmationDialog open={open} title="Review request" returnFocusRef={heading} onCancel={() => setOpen(false)} onConfirm={() => { setDone(true); setOpen(false) }}/></>
}
it('restores focus to a stable heading when a confirmed action removes its trigger', async () => {
 const user = userEvent.setup(); render(<Recovery/>); await user.click(screen.getByRole('button', { name: 'Review' })); expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus(); await user.tab({ shift: true }); expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus(); await user.keyboard('{Enter}'); expect(screen.getByRole('heading', { name: 'Outcome' })).toHaveFocus()
})
it('provides the same recurrence, status and time data as a keyboard-selectable list', async () => {
 const user = userEvent.setup(); render(<WeeklySchedule initialDate={new Date('2030-09-02T00:00:00')} slots={[{ id: 1, kind: 'allocation', category: 'TUTORING', label: 'Long course name', occurrenceStatus: 'SKIPPED', startsAt: '2030-09-02T10:00:00', endsAt: '2030-09-02T11:00:00' }]}/>);
 expect(screen.getByRole('article')).toHaveTextContent('Skipped'); const checkbox = screen.getByRole('checkbox', { name: 'Show schedule as a list' }); checkbox.focus(); await user.keyboard(' '); const list = screen.getByLabelText('Schedule list'); expect(list).toBeVisible(); expect(within(list).getByText('Long course name')).toBeInTheDocument(); expect(list).toHaveTextContent('10:00–11:00'); expect(list).toHaveTextContent('Skipped'); expect(screen.queryByRole('article')).not.toBeInTheDocument()
})
it('compact mode preserves content and actions with a labelled keyboard control', async () => {
 function Compact() { const [compact, setCompact] = useState(false); return <div data-testid="workspace" className={compact ? 'compact-mode' : ''}><DensityToggle compact={compact} onChange={setCompact}/><p>Pending request</p><button>Approve</button></div> }
 const user = userEvent.setup(); render(<Compact/>); await user.tab(); await user.keyboard(' '); expect(screen.getByTestId('workspace')).toHaveClass('compact-mode'); expect(screen.getByText('Pending request')).toBeVisible(); await user.tab(); expect(screen.getByRole('button', { name: 'Approve' })).toHaveFocus()
})
