import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { listBookings, getBooking, cancelBooking } from '../api/scheduling'
import { ConfirmationDialog } from '../components/shared/ConfirmationDialog'
const when = value => new Date(value).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' })
export default function BookingPanel({ onChanged, bookingId = Number(new URLSearchParams(window.location.search).get('booking')) }) {
  const { getAccessTokenSilently } = useAuth0()
  const [list, setList] = useState(null), [page, setPage] = useState(1), [detail, setDetail] = useState(null)
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [pending, setPending] = useState(false), [confirm, setConfirm] = useState(false), [note, setNote] = useState('')
  const sequence = useRef(0), busy = useRef(false)
  const refresh = useCallback(async () => { setList(await listBookings({ page }, getAccessTokenSilently)) }, [page, getAccessTokenSilently])
  useEffect(() => {
    let active = true
    const load = () => listBookings({ page }, getAccessTokenSilently).then(data => { if (active) setList(data) }).catch(err => { if (active) setError(err.message) })
    load(); window.addEventListener('focus', load)
    return () => { active = false; window.removeEventListener('focus', load) }
  }, [page, getAccessTokenSilently])
  const open = useCallback(async id => {
    const seq = ++sequence.current; setError(''); setConfirm(false)
    try { const data = await getBooking(id, getAccessTokenSilently); if (seq === sequence.current) { setDetail(data); setNote('') } }
    catch (err) { if (seq === sequence.current) { setDetail(null); setError(err.message) } }
  }, [getAccessTokenSilently])
  useEffect(() => {
    let active = true
    const id = bookingId
    const seq = ++sequence.current
    if (Number.isSafeInteger(id) && id > 0) getBooking(id, getAccessTokenSilently).then(data => { if (active && seq === sequence.current) setDetail(data) }).catch(err => { if (active) setError(err.message) })
    return () => { active = false }
  }, [getAccessTokenSilently, bookingId])
  useEffect(() => () => { sequence.current++ }, [])
  async function cancel() {
    if (busy.current || !detail) return
    busy.current = true; setPending(true); setError(''); setMessage('')
    try { const data = await cancelBooking(detail.booking.id, { version: detail.booking.version, note }, getAccessTokenSilently); setDetail(data); setMessage('Booking cancelled. This time is available again.'); await refresh(); await onChanged?.() }
    catch (err) { setError(err.message); if (err.status === 409) { await open(detail.booking.id); setError(`${err.message} Latest booking loaded.`); try { await refresh(); await onChanged?.() } catch (refreshError) { setError(`${err.message} Refresh failed: ${refreshError.message}`) } } }
    finally { busy.current = false; setPending(false); setConfirm(false) }
  }
  return <section className="role-card" aria-label="My tutoring bookings">
    <div className="planning-section-heading"><div><h2>My tutoring bookings</h2><p className="helper-text">Appointments with a Student and Tutor. Times shown in South African time.</p></div><button className="secondary-button" disabled={pending} onClick={() => refresh().catch(err => setError(err.message))}>Refresh bookings</button></div>
    {error && <p role="alert" className="status-message error">{error}</p>}{message && <p role="status" className="status-message">{message}</p>}
    {!list ? <p role="status">Loading bookings...</p> : <>
      {!list.items.length && <p>No tutoring bookings yet.</p>}
      <ul className="scenario-library">{list.items.map(b => <li key={b.id}><div><strong>{b.courseCode} · {b.studentName} with {b.tutorName}</strong><p>{when(b.startsAt)} to {when(b.endsAt)} · {b.status}{b.occurrenceStatus !== 'SCHEDULED' ? ` · ${b.occurrenceStatus}` : ''}</p></div><button className="secondary-button" disabled={pending} onClick={() => open(b.id)}>Booking details #{b.id}</button></li>)}</ul>
      <div className="button-row"><button className="secondary-button" disabled={page === 1 || pending} onClick={() => setPage(p => p - 1)}>Previous bookings</button><span>Page {page}</span><button className="secondary-button" disabled={!list.hasMore || pending} onClick={() => setPage(p => p + 1)}>More bookings</button></div>
    </>}
    {detail && <section className="booking-detail" aria-label="Booking details"><h3>{detail.booking.courseCode} — {detail.booking.courseName}</h3><p>{detail.booking.studentName} with {detail.booking.tutorName}</p><p>{when(detail.booking.startsAt)} to {when(detail.booking.endsAt)}</p><p>Status: {detail.booking.status} · Version {detail.booking.version}</p>
      <p className="helper-text">Either participant can cancel a scheduled booking before it starts. Cancellation keeps the history and notifies both people.</p>
      <button className="secondary-button" disabled={pending} onClick={() => open(detail.booking.id)}>Refresh booking details</button>
      {detail.canCancel && <form className="planning-form" onSubmit={e => { e.preventDefault(); setConfirm(true) }}><label>Cancellation note (optional)<textarea maxLength="1000" value={note} onChange={e => setNote(e.target.value)} /></label><button className="danger-button" disabled={pending}>Cancel booking</button></form>}
      <h4>Booking history</h4><ol>{detail.history.map(e => <li key={e.id}>{e.action} · {e.actorName} · {when(e.createdAt)}{e.note && <p>{e.note}</p>}</li>)}</ol>
    </section>}
    <ConfirmationDialog open={confirm} title="Cancel this tutoring booking?" confirmLabel="Confirm cancellation" isPending={pending} onCancel={() => setConfirm(false)} onConfirm={cancel}><p>Both participants will be notified, and the time will become available again.</p></ConfirmationDialog>
  </section>
}
