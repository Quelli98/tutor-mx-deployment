import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { decideStudentSickNote, listStudentSickNotes } from '../api/studentSickNotes'
import { ConfirmationDialog } from '../components/shared/ConfirmationDialog'
import { ConflictNotice } from '../components/shared/ConflictNotice'
const when = value => new Date(value).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' })
export default function StudentSickNoteQueue({ onCountChange }) {
  const { getAccessTokenSilently } = useAuth0()
  const [data, setData] = useState(null), [page, setPage] = useState(1), [notes, setNotes] = useState({}), [decision, setDecision] = useState(null), [pending, setPending] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const busy = useRef(false), sequence = useRef(0), heading = useRef(null)
  const refresh = useCallback(async () => {
    const seq = ++sequence.current
    const next = await listStudentSickNotes(page, getAccessTokenSilently)
    if (seq === sequence.current) { setData(next); onCountChange?.(next.pendingCount) }
  }, [page, getAccessTokenSilently, onCountChange])
  useEffect(() => { const invalidate = () => { sequence.current++ }; const load = () => refresh().catch(err => setError(err.message)); load(); window.addEventListener('focus', load); return () => { invalidate(); window.removeEventListener('focus', load) } }, [refresh])
  async function decide() {
    if (busy.current || !decision) return
    busy.current = true; setPending(true); setError(''); setMessage('')
    const { item, status } = decision
    try {
      await decideStudentSickNote(item.id, { version: item.version, bookingVersion: item.bookingVersion, decision: status, reviewNote: notes[item.id] || '' }, getAccessTokenSilently)
      setMessage(`Sick note ${status.toLowerCase()}.`); setData(null); await refresh()
    } catch (err) {
      setError(err.message)
      if (err.status === 409) { setData(null); try { await refresh(); setError(`${err.message} Latest queue loaded.`) } catch (failure) { setError(`${err.message} Refresh failed: ${failure.message}`) } }
    } finally { busy.current = false; setPending(false); setDecision(null) }
  }
  return <section className="role-card" aria-label="Student sick-note approvals">
    <div className="section-heading-row"><h2 ref={heading} tabIndex={-1}>Student sick notes</h2><button className="secondary-button" disabled={pending} onClick={() => refresh().then(() => setError('')).catch(err => setError(err.message))}>Refresh sick notes</button></div>
    <p className="helper-text">Times in South African time. Approval before the session starts excuses it and frees the time; approval at or after the start records Skipped. Rejection keeps the booking scheduled.</p>
    <ConflictNotice message={error}/>{message && <p role="status">{message}</p>}
    {!data ? <p role="status">Sick-note queue has not loaded.</p> : <>
      {!data.items.length && <p>No Student sick notes.</p>}
      <div className="approval-list">{data.items.map(item => <article className="approval-card" key={item.id}>
        <h3>{item.studentName} · {item.courseCode}</h3><p>With {item.tutorName} · {when(item.startsAt)} to {when(item.endsAt)}</p><p>Status: <strong>{item.status}</strong> · Attendance: {item.occurrenceStatus}</p><p className="scheduling-note">{item.reason}</p>
        {item.status === 'PENDING' ? <><label>Review note for request #{item.id}<textarea maxLength={1000} value={notes[item.id] || ''} onChange={e => setNotes(previous => ({ ...previous, [item.id]: e.target.value }))}/></label><p className="helper-text">A review note is required for rejection.</p><div className="button-row"><button className="primary-button" disabled={pending} onClick={() => setDecision({ item, status: 'APPROVED' })}>Approve request #{item.id}</button><button className="danger-button" disabled={pending || !notes[item.id]?.trim()} onClick={() => setDecision({ item, status: 'REJECTED' })}>Reject request #{item.id}</button></div></> : item.reviewNote && <p>Review note: {item.reviewNote}</p>}
      </article>)}</div>
      <div className="button-row"><button className="secondary-button" disabled={pending || page === 1} onClick={() => setPage(p => p - 1)}>Previous sick notes</button><span>Page {page}</span><button className="secondary-button" disabled={pending || !data.hasMore} onClick={() => setPage(p => p + 1)}>More sick notes</button></div>
    </>}
    <ConfirmationDialog open={Boolean(decision)} title={decision?.status === 'APPROVED' ? 'Approve Student sick note?' : 'Reject Student sick note?'} confirmLabel="Confirm decision" isPending={pending} returnFocusRef={heading} onCancel={() => setDecision(null)} onConfirm={decide}><p>{decision?.item.studentName} · {decision?.item.courseCode}</p><p>{decision && notes[decision.item.id]}</p></ConfirmationDialog>
  </section>
}
