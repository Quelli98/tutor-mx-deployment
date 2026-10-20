import { useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { submitStudentSickNote } from '../api/studentSickNotes'
import { ConfirmationDialog } from '../components/shared/ConfirmationDialog'
import { ConflictNotice } from '../components/shared/ConflictNotice'
export default function StudentSickNoteForm({ detail, refresh }) {
  const { getAccessTokenSilently } = useAuth0()
  const [reason, setReason] = useState(''), [confirm, setConfirm] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const busy = useRef(false), heading = useRef(null)
  async function submit() {
    if (busy.current) return
    busy.current = true; setPending(true); setError(''); setMessage('')
    try {
      await submitStudentSickNote(detail.booking.id, { bookingVersion: detail.booking.version, reason }, getAccessTokenSilently)
      setReason(''); setMessage('Sick note submitted. Awaiting Organiser review.'); await refresh()
    } catch (err) {
      setError(err.message)
      if (err.status === 409) try { await refresh(); setError(`${err.message} Latest booking loaded.`) } catch (failure) { setError(`${err.message} Refresh failed: ${failure.message}`) }
    } finally { busy.current = false; setPending(false); setConfirm(false) }
  }
  return <section aria-label="Student sick notes">
    <h4 ref={heading} tabIndex={-1}>Student sick notes</h4>
    <p className="helper-text">Your reason and review notes are visible to you and Organisers. No medical documents are required. A pending request pauses cancellation. Approval before the start releases the time as Excused; approval at or after the start records Skipped.</p>
    <ConflictNotice message={error}/>{message && <p role="status">{message}</p>}
    <p className="helper-text">Sick notes are linked to this booking and reviewed by an Organiser. You can check the latest decision here.</p>
    {detail.sickNotes?.length === 0 && <p>No sick notes submitted for this booking.</p>}
    <ul>{detail.sickNotes?.map(n => <li key={n.id}><strong>{n.status}</strong><p>{n.reason}</p>{n.reviewNote && <p>Review note: {n.reviewNote}</p>}</li>)}</ul>
    {detail.canSubmitSickNote && <form className="planning-form" onSubmit={e => { e.preventDefault(); setConfirm(true) }}><label>Reason for sick note<textarea required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)}/></label><button className="primary-button" disabled={pending || !reason.trim()}>Submit sick note</button></form>}
    <ConfirmationDialog open={confirm} title="Submit this sick note?" confirmLabel="Confirm sick note" isPending={pending} returnFocusRef={heading} onCancel={() => setConfirm(false)} onConfirm={submit}><p>{reason}</p></ConfirmationDialog>
  </section>
}
