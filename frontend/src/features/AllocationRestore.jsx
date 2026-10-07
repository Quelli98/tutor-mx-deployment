import { useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { allocationHistory, previewRestore, restoreAllocation } from '../api/audit'
import { ConfirmationDialog } from '../components/shared/ConfirmationDialog'
import { ConflictNotice } from '../components/shared/ConflictNotice'
const when = value => new Date(value).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' })
const fields = { tutorId: 'Tutor ID', courseId: 'Course ID', startsAt: 'Start', endsAt: 'End', allocatedHours: 'Hours', status: 'Status', version: 'Version' }
export default function AllocationRestore({ allocationId, eventId, onRestored }) {
 const { getAccessTokenSilently } = useAuth0()
 const [history, setHistory] = useState(null), [selected, setSelected] = useState(String(eventId)), [side, setSide] = useState('after'), [preview, setPreview] = useState(null), [reason, setReason] = useState(''), [error, setError] = useState(''), [result, setResult] = useState(null), [confirm, setConfirm] = useState(false), [pending, setPending] = useState(false)
 const sequence = useRef(0), busy = useRef(false), heading = useRef(null)
 useEffect(() => { let active = true; allocationHistory(allocationId, getAccessTokenSilently).then(data => { if (active) setHistory(data.items) }).catch(err => { if (active) setError(err.message) }); return () => { active = false } }, [allocationId, getAccessTokenSilently])
 function change(setter, value) { sequence.current++; setter(value); setPreview(null); setResult(null); setError('') }
 async function compare() {
  const seq = ++sequence.current; setPending(true); setPreview(null); setError('')
  try { const data = await previewRestore(allocationId, { eventId: Number(selected), side }, getAccessTokenSilently); if (seq === sequence.current) setPreview(data) } catch (err) { if (seq === sequence.current) setError(err.message) } finally { setPending(false) }
 }
 async function restore() {
  if (busy.current || !preview) return
  busy.current = true; setPending(true); setError('')
  try { const data = await restoreAllocation(allocationId, { eventId: preview.eventId, side: preview.side, expectedVersion: preview.expectedVersion, reason }, getAccessTokenSilently); setResult(data); setPreview(null); setReason(''); await onRestored?.() }
  catch (err) { setError(err.message); if (err.status === 409) { setPreview(null); setError(`${err.message} Preview again before retrying.`) } }
  finally { busy.current = false; setPending(false); setConfirm(false) }
 }
 return <section aria-label="Allocation restore" className="booking-detail">
  <h3 ref={heading} tabIndex={-1}>Restore allocation #{allocationId}</h3><p className="helper-text">Preview a historical version first. Restore creates a new allocation and cancels the old identity; it preserves all history. Current mark, timetable and capacity rules still apply. Allocations with attendance, work-log, overflow, swap or prior restore history are protected.</p>
  <ConflictNotice message={error}/>
  {result && <p role="status">Restored as allocation #{result.allocationId}. <a href={`/organiser/command-centre?auditTarget=allocation&auditTargetId=${result.allocationId}`}>View restored allocation audit</a></p>}
  {history && <form className="planning-form" onSubmit={e => { e.preventDefault(); compare() }}><label>Historical event<select value={selected} required disabled={pending} onChange={e => change(setSelected, e.target.value)}><option value="">Choose an event</option>{history.map(event => <option key={event.id} value={event.id}>#{event.id} · {event.action} · {when(event.createdAt)}</option>)}</select></label><label>Historical values<select value={side} disabled={pending} onChange={e => change(setSide, e.target.value)}><option value="before">Before this event</option><option value="after">After this event</option></select></label><button className="secondary-button" disabled={pending || !selected}>Preview restore</button></form>}
  {preview && <><p className="helper-text">Restore requires a mark of at least {preview.requiredMark ?? 50}%, preserving any stricter current threshold.</p><div className="planning-table-scroll" role="region" aria-label="Restore comparison" tabIndex={0}><table className="planning-table"><caption>Current allocation versus selected historical values</caption><thead><tr><th scope="col">Field</th><th scope="col">Current</th><th scope="col">Historical</th></tr></thead><tbody>{Object.entries(fields).map(([key, label]) => <tr key={key}><th scope="row">{label}</th>{[preview.current, preview.historical].map((row, i) => <td key={i}>{row[key] == null ? '—' : key.endsWith('At') ? when(row[key]) : String(row[key])}</td>)}</tr>)}</tbody></table></div>
   {!preview.canRestore ? <div role="status"><p>Restore is currently unavailable:</p><ul>{preview.reasons.map(text => <li key={text}>{text}</li>)}</ul></div> : <form className="planning-form" onSubmit={e => { e.preventDefault(); setConfirm(true) }}><label>Reason for restore<textarea required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)}/></label><button className="primary-button" disabled={pending || !reason.trim()}>Restore these values</button></form>}
  </>}
  <ConfirmationDialog open={confirm} returnFocusRef={heading} title="Restore this historical allocation?" confirmLabel="Confirm restore" isPending={pending} onCancel={() => setConfirm(false)} onConfirm={restore}><p>{reason}</p><p>The server will check the current version and eligibility again before creating the replacement allocation.</p></ConfirmationDialog>
 </section>
}
