import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { listSwaps, getSwap, replacementOptions, createSwap, changeSwap } from '../api/scheduling'
import { fetchTutorDashboard } from '../api/tutorDashboard'
import { ConfirmationDialog } from '../components/shared/ConfirmationDialog'
const when = value => new Date(value).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' })
function Preview({ value, requester, replacement }) {
  return <div className="planning-table-scroll" role="region" aria-label="Swap before and after" tabIndex="0"><table className="planning-table"><thead><tr><th>Session / workload</th><th>Before</th><th>After approval</th></tr></thead><tbody>
    <tr><th>{value.courseCode}</th><td>{requester}</td><td>{replacement}</td></tr>
    <tr><th>Calendar time</th><td>{when(value.startsAt)} to {when(value.endsAt)}</td><td>Same time · {value.allocatedHours} allocated hours</td></tr>
    <tr><th>Original Tutor weekly hours</th><td>{value.requesterHoursBefore ?? 'Not set'}</td><td>{value.requesterHoursAfter ?? 'Not set'}</td></tr>
    <tr><th>Replacement weekly hours</th><td>{value.replacementHoursBefore ?? 'Not set'}</td><td>{value.replacementHoursAfter ?? 'Not set'}</td></tr>
  </tbody></table><p className="helper-text">Preview for the session’s allocation week. Final approval rechecks current eligibility, clashes and capacity.</p></div>
}
export default function SwapWorkspace({ role = 'TUTOR', swapId = Number(new URLSearchParams(window.location.search).get('swap')) }) {
  const { getAccessTokenSilently } = useAuth0()
  const [list, setList] = useState(null), [page, setPage] = useState(1), [allocations, setAllocations] = useState([]), [detail, setDetail] = useState(null)
  const [allocationId, setAllocationId] = useState(''), [options, setOptions] = useState(null), [replacementId, setReplacementId] = useState(''), [reason, setReason] = useState(''), [note, setNote] = useState('')
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [pending, setPending] = useState(false), [confirmation, setConfirmation] = useState(null)
  const busy = useRef(false), sequence = useRef(0), optionSequence = useRef(0)
  const refresh = useCallback(async () => {
    const [requests, dashboard] = await Promise.all([listSwaps(page, getAccessTokenSilently), role === 'TUTOR' ? fetchTutorDashboard(getAccessTokenSilently) : Promise.resolve({ allocations: [] })])
    setList(requests); setAllocations(dashboard.allocations.filter(a => a.status === 'CONFIRMED' && new Date(a.startsAt) > new Date()))
  }, [page, role, getAccessTokenSilently])
  useEffect(() => {
    let active = true
    const load = async () => { try { const [requests, dashboard] = await Promise.all([listSwaps(page, getAccessTokenSilently), role === 'TUTOR' ? fetchTutorDashboard(getAccessTokenSilently) : Promise.resolve({ allocations: [] })]); if (active) { setList(requests); setAllocations(dashboard.allocations.filter(a => a.status === 'CONFIRMED' && new Date(a.startsAt) > new Date())) } } catch (err) { if (active) setError(err.message) } }
    load(); window.addEventListener('focus', load)
    return () => { active = false; window.removeEventListener('focus', load) }
  }, [page, role, getAccessTokenSilently])
  const open = useCallback(async id => {
    const seq = ++sequence.current; setError(''); setConfirmation(null)
    try { const data = await getSwap(id, getAccessTokenSilently); if (seq === sequence.current) { setDetail(data); setNote('') } }
    catch (err) { if (seq === sequence.current) { setDetail(null); setError(err.message) } }
  }, [getAccessTokenSilently])
  useEffect(() => {
    let active = true
    const id = swapId
    const seq = ++sequence.current
    if (Number.isSafeInteger(id) && id > 0) getSwap(id, getAccessTokenSilently).then(data => { if (active && seq === sequence.current) setDetail(data) }).catch(err => { if (active) setError(err.message) })
    return () => { active = false }
  }, [getAccessTokenSilently, swapId])
  useEffect(() => () => { sequence.current++; optionSequence.current++ }, [])
  async function chooseAllocation(id) {
    const seq = ++optionSequence.current; setAllocationId(id); setOptions(null); setReplacementId(''); setError('')
    if (!id) return
    try { const data = await replacementOptions(Number(id), getAccessTokenSilently); if (seq === optionSequence.current) setOptions(data) }
    catch (err) { if (seq === optionSequence.current) setError(err.message) }
  }
  async function act() {
    if (busy.current) return
    busy.current = true; setPending(true); setError(''); setMessage('')
    try {
      const data = confirmation === 'request'
        ? await createSwap({ allocationId: Number(allocationId), replacementId: Number(replacementId), allocationRevision: options.allocationRevision, reason }, getAccessTokenSilently)
        : await changeSwap(detail.swap.id, { action: confirmation, version: detail.swap.version, note }, getAccessTokenSilently)
      sequence.current++; setDetail(data); setNote(''); setMessage(`Swap ${data.swap.status.toLowerCase()}.`)
      if (confirmation === 'request') { setAllocationId(''); setOptions(null); setReplacementId(''); setReason('') }
      await refresh()
    } catch (err) {
      setError(err.message)
      if (err.status === 409) {
        if (detail) await open(detail.swap.id)
        if (allocationId) await chooseAllocation(allocationId)
        try { await refresh(); setError(`${err.message} Latest state loaded. Review it before retrying.`) } catch (refreshError) { setError(`${err.message} Refresh failed: ${refreshError.message}`) }
      }
    } finally { busy.current = false; setPending(false); setConfirmation(null) }
  }
  const swap = detail?.swap, choice = options?.choices.find(c => c.tutorId === Number(replacementId))
  const actions = !swap ? [] : role === 'ORGANISER'
    ? [...(swap.status === 'ACCEPTED' ? ['approve'] : []), ...(['REQUESTED', 'ACCEPTED'].includes(swap.status) ? ['reject'] : [])]
    : [...(swap.requesterId === list?.actorId && ['REQUESTED', 'ACCEPTED'].includes(swap.status) ? ['cancel'] : []), ...(swap.replacementId === list?.actorId && swap.status === 'REQUESTED' ? ['accept', 'decline'] : [])]
  return <main id="main-content" className="dashboard-shell tutor-workspace planning-workspace">
    <header className="dashboard-header"><div><p className="eyebrow">{role === 'ORGANISER' ? 'Organiser' : 'Tutor'} workspace</p><h1>Tutor swaps</h1><p className="helper-text">The replacement Tutor accepts first. An Organiser makes the final decision before any live assignment changes.</p></div></header>
    {error && <p role="alert" className="status-message error">{error}</p>}{message && <p role="status" className="status-message">{message}</p>}
    {role === 'TUTOR' && <section className="role-card"><h2>Request a replacement</h2><p className="helper-text">Choose a future confirmed session without attendance or payroll history. All dates and times below use South African time.</p>
      <form className="planning-form" onSubmit={e => { e.preventDefault(); setConfirmation('request') }}>
        <label>Your session<select required value={allocationId} disabled={pending} onChange={e => chooseAllocation(e.target.value)}><option value="">Choose session</option>{allocations.map(a => <option key={a.id} value={a.id}>{a.courseCode} · {when(a.startsAt)}</option>)}</select></label>
        <label>Replacement Tutor<select required value={replacementId} disabled={!options || pending} onChange={e => setReplacementId(e.target.value)}><option value="">Choose eligible Tutor</option>{options?.choices.map(c => <option key={c.tutorId} value={c.tutorId}>{c.fullName}</option>)}</select></label>
        <label>Reason for swap<textarea required maxLength="1000" value={reason} onChange={e => setReason(e.target.value)} /></label>
        <div className="button-row"><button className="primary-button" disabled={!choice || pending}>Request swap</button><button type="button" className="secondary-button" disabled={!allocationId || pending} onClick={() => chooseAllocation(allocationId)}>Refresh eligible Tutors</button></div>
      </form>
      {options && !options.choices.length && <p>No eligible replacements for this session. Check again after availability or capacity changes.</p>}
      {choice && <Preview requester="You" replacement={choice.fullName} value={{ ...options.allocation, requesterHoursBefore: options.requesterHoursBefore, requesterHoursAfter: options.requesterHoursAfter, replacementHoursBefore: choice.hoursBefore, replacementHoursAfter: choice.hoursAfter }} />}
    </section>}
    <section className="role-card"><div className="planning-section-heading"><h2>{role === 'ORGANISER' ? 'Swap decisions' : 'Your swap requests and invitations'}</h2><button className="secondary-button" disabled={pending} onClick={() => refresh().catch(err => setError(err.message))}>Refresh swaps</button></div>
      {!list ? <p role="status">Loading swaps...</p> : <><ul className="scenario-library">{list.items.map(s => <li key={s.id}><div><strong>{s.snapshot.courseCode} · {s.requesterName} → {s.replacementName}</strong><p>{when(s.snapshot.startsAt)} · {s.status}</p></div><button className="secondary-button" disabled={pending} onClick={() => open(s.id)}>Swap details #{s.id}</button></li>)}</ul>{!list.items.length && <p>No swap requests yet.</p>}
        <div className="button-row"><button className="secondary-button" disabled={page === 1 || pending} onClick={() => setPage(p => p - 1)}>Previous swaps</button><span>Page {page}</span><button className="secondary-button" disabled={!list.hasMore || pending} onClick={() => setPage(p => p + 1)}>More swaps</button></div></>}
    </section>
    {swap && <section className="role-card" aria-label="Swap details"><h2>Swap #{swap.id} · {swap.status}</h2><p>Version {swap.version} · {swap.requesterName} → {swap.replacementName}</p><p>{swap.reason}</p><Preview value={swap.snapshot} requester={swap.requesterName} replacement={swap.replacementName} />
      <p className="helper-text">This is the preview recorded when the request was created. Current hard rules are checked again when accepting and approving.</p>
      <button className="secondary-button" disabled={pending} onClick={() => open(swap.id)}>Refresh swap details</button>
      {actions.length > 0 && <><label className="scheduling-note">Decision note (optional)<textarea maxLength="1000" value={note} onChange={e => setNote(e.target.value)} /></label><div className="button-row">{actions.map(action => <button key={action} className={['reject', 'decline', 'cancel'].includes(action) ? 'danger-button' : 'primary-button'} disabled={pending} onClick={() => setConfirmation(action)}>{action[0].toUpperCase() + action.slice(1)} swap</button>)}</div></>}
      <h3>Request history</h3><ol>{detail.history.map(e => <li key={e.id}>{e.action} · {e.actorName} · {when(e.createdAt)}{e.note && <p>{e.note}</p>}</li>)}</ol>
    </section>}
    <ConfirmationDialog open={Boolean(confirmation)} title={confirmation === 'request' ? 'Send this swap request?' : `${confirmation ? confirmation[0].toUpperCase() + confirmation.slice(1) : 'Review'} this swap?`} confirmLabel="Confirm decision" isPending={pending} onCancel={() => setConfirmation(null)} onConfirm={act}><p>{confirmation === 'approve' ? 'The original allocation will be cancelled and a replacement confirmed together, after checking the latest rules.' : 'This decision is recorded in the request history. Only final Organiser approval changes the live assignment.'}</p></ConfirmationDialog>
  </main>
}
