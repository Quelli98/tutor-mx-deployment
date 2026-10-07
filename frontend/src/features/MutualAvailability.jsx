import { ConflictNotice } from '../components/shared/ConflictNotice'
import { createBooking } from '../api/scheduling'
import { ConfirmationDialog } from '../components/shared/ConfirmationDialog'
import { useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { discoverTutoring, findMutualAvailability } from '../api/planning'
import { listPublishedAcademicTerms } from '../api/timetableImport'

export default function MutualAvailability() {
  const { getAccessTokenSilently } = useAuth0()
  const [choices, setChoices] = useState([]), [terms, setTerms] = useState([])
  const [state, setState] = useState('loading'), [error, setError] = useState(''), [result, setResult] = useState(null)
  const [form, setForm] = useState({ choice: '', termId: '', startsAt: '', endsAt: '', durationMinutes: '60', dailyStartHour: '8', dailyEndHour: '18' })
  const [retry, setRetry] = useState(0), [limited, setLimited] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState(null), [booking, setBooking] = useState(null), [bookingPending, setBookingPending] = useState(false)
  const bookingBusy = useRef(false), heading = useRef(null)
  const request = useRef(0)
  useEffect(() => {
    let active = true
    Promise.all([discoverTutoring(getAccessTokenSilently), listPublishedAcademicTerms(getAccessTokenSilently)])
      .then(([options, academicTerms]) => { if (active) { setChoices(options.choices); setLimited(options.truncated); setTerms(academicTerms); setState('ready'); setError('') } })
      .catch(err => { if (active) { setError(err.message); setState('error') } })
    return () => { active = false }
  }, [getAccessTokenSilently, retry])
  useEffect(() => () => { request.current++ }, [])
  function edit(key, value) { setSelectedSlot(null); request.current++; setForm(current => ({ ...current, [key]: value })); setResult(null); if (state === 'searching') setState('ready') }
  async function submit(event) {
    event.preventDefault()
    const choice = choices.find(x => `${x.courseId}:${x.tutorId}` === form.choice)
    if (!choice) return
    const sequence = ++request.current
    setState('searching'); setError(''); setResult(null)
    try {
      const response = await findMutualAvailability({ courseId: choice.courseId, tutorId: choice.tutorId, termId: Number(form.termId), startsAt: new Date(`${form.startsAt}+02:00`).toISOString(), endsAt: new Date(`${form.endsAt}+02:00`).toISOString(), durationMinutes: Number(form.durationMinutes), dailyStartHour: Number(form.dailyStartHour), dailyEndHour: Number(form.dailyEndHour) }, getAccessTokenSilently)
      if (sequence === request.current) { setResult(response); setState('ready') }
    } catch (err) { if (sequence === request.current) { setError(err.message); setState('ready') } }
  }
  async function book() {
    if (bookingBusy.current || !selectedSlot) return
    const choice = choices.find(x => `${x.courseId}:${x.tutorId}` === form.choice)
    bookingBusy.current = true; setBookingPending(true); setError('')
    try {
      const response = await createBooking({ courseId: choice.courseId, tutorId: choice.tutorId, termId: Number(form.termId), ...selectedSlot }, getAccessTokenSilently)
      setBooking(response.booking); setResult(null); setSelectedSlot(null)
    } catch (err) { setError(err.message); if (err.status === 409) { setResult(null); setSelectedSlot(null) } }
    finally { bookingBusy.current = false; setBookingPending(false) }
  }
  const when = value => new Date(value).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' })
  return <main id="main-content" className="dashboard-shell tutor-workspace">
    <header className="dashboard-header"><div><p className="eyebrow">Student workspace</p><h1 ref={heading} tabIndex={-1}>Find a tutoring time</h1><p className="helper-text">Choose a course and tutor to see when you are both free. Your private timetable descriptions stay private.</p></div></header>
    {booking && <p role="status" className="status-message">{booking.status === 'CONFIRMED' ? 'Booking confirmed.' : `Booking status: ${booking.status}.`} <a href={`/student/timetable?booking=${booking.id}`}>View booking and timetable</a></p>}
    <ConflictNotice message={error}/>{error && state === 'error' && <button className="secondary-button" onClick={() => setRetry(x => x + 1)}>Retry</button>}
    {state === 'loading' ? <p role="status">Loading tutors and academic terms...</p> : <section className="role-card">
      <h2>Search availability</h2>
      <p className="helper-text">All times below are South African time (Africa/Johannesburg). Search up to 14 days within the next 180 days. These times are suggestions and are not reserved.</p>
      {limited && <p role="status">Showing the first 500 tutor/course choices.</p>}
      {!choices.length && state !== 'error' && <p>No eligible tutors are available yet.</p>}
      {!terms.length && state !== 'error' && <p>An organiser must publish an academic term before you can search.</p>}
      <form className="planning-form" onSubmit={submit}>
        <label>Course and tutor<select required value={form.choice} onChange={e => edit('choice', e.target.value)}><option value="">Choose a tutor</option>{choices.map(x => <option key={`${x.courseId}:${x.tutorId}`} value={`${x.courseId}:${x.tutorId}`}>{x.courseCode} — {x.courseName} · {x.tutorName}</option>)}</select></label>
        <label>Academic term<select required value={form.termId} onChange={e => edit('termId', e.target.value)}><option value="">Choose a term</option>{terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label>Search from<input required type="datetime-local" value={form.startsAt} onChange={e => edit('startsAt', e.target.value)} /></label>
        <label>Search until<input required type="datetime-local" value={form.endsAt} onChange={e => edit('endsAt', e.target.value)} /></label>
        <label>Session length (minutes)<input required type="number" min="15" max="180" step="1" value={form.durationMinutes} onChange={e => edit('durationMinutes', e.target.value)} /></label>
        <label>Daily start hour (0–23)<input required type="number" min="0" max="23" value={form.dailyStartHour} onChange={e => edit('dailyStartHour', e.target.value)} /></label>
        <label>Daily end hour (1–24)<input required type="number" min="1" max="24" value={form.dailyEndHour} onChange={e => edit('dailyEndHour', e.target.value)} /></label>
        <div className="button-row"><button className="primary-button" disabled={state === 'searching' || !terms.length || !choices.length}>{state === 'searching' ? 'Finding times...' : 'Find shared times'}</button></div>
      </form>
    </section>}
    {result && <section className="role-card" aria-label="Shared available times"><h2>Shared available times</h2><p role="status">{result.slots.length ? `${result.slots.length} possible times found.` : 'No common time found. Try another day, tutor or shorter session.'}</p><p className="helper-text">{result.policy}</p>
      {result.truncated && <p>Showing the first 80 times. Narrow the search or move the start date to see later options.</p>}
      {result.slots.length > 0 && <div className="planning-table-scroll" tabIndex="0" role="region" aria-label="Available session times"><table className="planning-table"><thead><tr><th>Starts</th><th>Ends</th><th>Duration</th><th>Book</th></tr></thead><tbody>{result.slots.map(slot => <tr key={slot.startsAt}><td>{when(slot.startsAt)}</td><td>{when(slot.endsAt)}</td><td>{result.durationMinutes} minutes</td><td><button className="primary-button" disabled={bookingPending} onClick={() => setSelectedSlot(slot)}>Book this time</button></td></tr>)}</tbody></table></div>}
    </section>}
    <ConfirmationDialog returnFocusRef={heading} open={Boolean(selectedSlot)} title="Confirm this tutoring booking?" confirmLabel="Confirm booking" isPending={bookingPending} onCancel={() => setSelectedSlot(null)} onConfirm={book}>
      {selectedSlot && <p>{choices.find(x => `${x.courseId}:${x.tutorId}` === form.choice)?.courseCode} with {choices.find(x => `${x.courseId}:${x.tutorId}` === form.choice)?.tutorName}: {when(selectedSlot.startsAt)} to {when(selectedSlot.endsAt)}. Availability is checked again when you confirm.</p>}
    </ConfirmationDialog>
  </main>
}
