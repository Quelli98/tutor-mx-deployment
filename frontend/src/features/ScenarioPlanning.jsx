import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { listScenarios, createScenario, getScenario, compareScenario, changeScenario, heartbeatScenario } from '../api/planning'
import { listCourses, listTutors, listAllocationCandidates } from '../api/organiser'
import { ConfirmationDialog } from '../components/shared/ConfirmationDialog'

const blankItem = { id: null, tutorId: '', courseId: '', startsAt: '', endsAt: '', allocatedHours: '1', minimumMark: '50' }
const zaInput = value => new Date(new Date(value).valueOf() + 7200000).toISOString().slice(0,16)
const iso = value => new Date(`${value}+02:00`).toISOString()
const when = value => new Date(value).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' })
const money = value => value == null ? 'Rate not set' : `R ${Number(value).toFixed(2)}`
function assignment(item) { return item ? `${item.courseCode} · ${item.tutorName} · ${when(item.startsAt)}–${when(item.endsAt)} · ${item.allocatedHours} h` : '—' }

function Comparison({ value }) {
  const { liveMetrics: live, draftMetrics: draft, diff } = value
  const tutors = [...new Set([...live.workload, ...draft.workload].map(x => x.tutorId))]
  return <section className="role-card" aria-label="Compare with live">
    <h2>Compare with Live</h2>
    {value.liveChanged && <p role="status" className="status-message">Live assignments have changed since this draft was copied. Review every difference before publishing.</p>}
    <p className="helper-text">This scenario replaces confirmed assignments starting within its planning window. Projected cost is for that window, not approved payroll spend. Open requirements fully inside the window contribute to shortages.</p>
    <div className="planning-table-scroll" tabIndex="0" role="region" aria-label="Scenario metrics"><table className="planning-table"><thead><tr><th>Measure</th><th>Live</th><th>Draft</th><th>Difference</th></tr></thead><tbody>
      <tr><th>Allocated hours</th><td>{live.hours}</td><td>{draft.hours}</td><td>{(draft.hours - live.hours).toFixed(2)}</td></tr>
      <tr><th>Shortage hours</th><td>{live.shortageHours}</td><td>{draft.shortageHours}</td><td>{(draft.shortageHours - live.shortageHours).toFixed(2)}</td></tr>
      <tr><th>Projected cost</th><td>{money(live.projectedCost)}</td><td>{money(draft.projectedCost)}</td><td>{live.projectedCost == null || draft.projectedCost == null ? 'Not comparable' : money(draft.projectedCost - live.projectedCost)}</td></tr>
      {tutors.map(id => { const before = live.workload.find(x => x.tutorId === id), after = draft.workload.find(x => x.tutorId === id); return <tr key={id}><th>{(after || before).tutorName} workload</th><td>{before?.hours || 0} h</td><td>{after?.hours || 0} h</td><td>{((after?.hours || 0) - (before?.hours || 0)).toFixed(2)} h</td></tr> })}
    </tbody></table></div>
    <div className="planning-table-scroll" tabIndex="0" role="region" aria-label="Assignment differences"><table className="planning-table"><thead><tr><th>Change</th><th>Live assignment</th><th>Draft assignment</th></tr></thead><tbody>
      {diff.added.map(x => <tr key={`add-${x.id}`}><th>Added</th><td>—</td><td>{assignment(x)}</td></tr>)}
      {diff.removed.map(x => <tr key={`remove-${x.id}`}><th>Removed</th><td>{assignment(x)}</td><td>—</td></tr>)}
      {diff.changed.map(x => <tr key={`change-${x.after.id}`}><th>Changed</th><td>{assignment(x.before)}</td><td>{assignment(x.after)}</td></tr>)}
      {!diff.added.length && !diff.removed.length && !diff.changed.length && <tr><td colSpan="3">No assignment differences.</td></tr>}
    </tbody></table></div>
    <h3>Course budget projections</h3><div className="planning-table-scroll" tabIndex="0" role="region" aria-label="Course budget comparison"><table className="planning-table"><thead><tr><th>Course</th><th>Budget</th><th>Live cost</th><th>Draft cost</th><th>Draft budget remaining</th></tr></thead><tbody>{[...new Set([...live.courses,...draft.courses].map(x=>x.courseId))].map(id=>{const before=live.courses.find(x=>x.courseId===id),after=draft.courses.find(x=>x.courseId===id),course=after||before;return <tr key={id}><th>{course.courseCode}</th><td>{course.budget==null?'Not set':money(course.budget)}</td><td>{money(before?.projectedCost ?? (before ? null : 0))}</td><td>{money(after?.projectedCost ?? (after ? null : 0))}</td><td>{after ? (after.budgetRemaining==null?'Not set':money(after.budgetRemaining)) : (course.budget==null?'Not set':money(course.budget))}</td></tr>})}</tbody></table></div>
  </section>
}

export default function ScenarioPlanning() {
  const { getAccessTokenSilently } = useAuth0()
  const [library, setLibrary] = useState([]), [filter, setFilter] = useState('DRAFT'), [courses, setCourses] = useState([]), [tutors, setTutors] = useState([])
  const [detail, setDetail] = useState(null), [comparison, setComparison] = useState(null), [presence, setPresence] = useState([])
  const [create, setCreate] = useState({ name: '', startsAt: '', endsAt: '' }), [meta, setMeta] = useState({ name: '', notes: '' }), [duplicateName, setDuplicateName] = useState('')
  const [item, setItem] = useState(blankItem), [candidates, setCandidates] = useState([])
  const [pending, setPending] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [message, setMessage] = useState(''), [confirmation, setConfirmation] = useState(null)
  const selected = useRef(null), request = useRef(0), busy = useRef(false), openedFromQuery = useRef(false)
  const scenario = detail?.scenario
  const refreshLibrary = useCallback(async () => { setLibrary(await listScenarios(filter, getAccessTokenSilently)) }, [filter, getAccessTokenSilently])
  useEffect(() => {
    let active = true
    Promise.all([listScenarios(filter, getAccessTokenSilently), listCourses(getAccessTokenSilently), listTutors(getAccessTokenSilently)])
      .then(([scenarios, allCourses, allTutors]) => { if (active) { setLibrary(scenarios); setCourses(allCourses); setTutors(allTutors); setLoading(false) } })
      .catch(err => { if (active) { setError(err.message); setLoading(false) } })
    return () => { active = false }
  }, [filter, getAccessTokenSilently])
  useEffect(() => () => { request.current++ }, [])
  useEffect(() => {
    if (openedFromQuery.current) return undefined
    openedFromQuery.current = true
    const id = Number(new URLSearchParams(window.location.search).get('scenario'))
    if (!Number.isSafeInteger(id) || id < 1) return undefined
    let active = true
    const seq = ++request.current
    getScenario(id, getAccessTokenSilently)
      .then(data => {
        if (!active || seq !== request.current) return
        selected.current = data.scenario.id
        setDetail(data); setComparison(null)
        setMeta({ name:data.scenario.name, notes:data.scenario.notes })
        setItem(blankItem); setCandidates([]); setDuplicateName(`${data.scenario.name} copy`.slice(0,120))
      })
      .catch(err => { if (active && seq === request.current) setError(err.message) })
    return () => { active = false }
  }, [getAccessTokenSilently])
  useEffect(() => {
    if (!scenario?.id) return undefined
    let active = true
    const heartbeat = async () => { try { const people = await heartbeatScenario(scenario.id, getAccessTokenSilently); if (active) setPresence(people) } catch { if (active) setPresence(null) } }
    heartbeat(); const timer = setInterval(heartbeat, 25000)
    return () => { active = false; clearInterval(timer) }
  }, [scenario?.id, getAccessTokenSilently])
  function accept(data, reset = false) {
    request.current++
    selected.current = data.scenario.id; setDetail(data); setComparison(null)
    if (reset) { setMeta({ name: data.scenario.name, notes: data.scenario.notes }); setItem(blankItem); setCandidates([]); setDuplicateName(`${data.scenario.name} copy`.slice(0,120)) }
  }
  async function open(id, keepInputs = false) {
    const seq = ++request.current; setError(''); setComparison(null)
    try { const data = await getScenario(id, getAccessTokenSilently); if (seq === request.current) { accept(data, !keepInputs); if (keepInputs) setMessage('Latest version loaded. Your unsaved form inputs are preserved; compare them before saving again.') } }
    catch (err) { if (seq === request.current) setError(err.message) }
  }
  async function mutate(action, extras = {}) {
    if (busy.current || !scenario) return
    busy.current = true; setPending(true); setError(''); setMessage('')
    try {
      const data = await changeScenario(scenario.id, { action, version: scenario.version, ...extras }, getAccessTokenSilently)
      if (data.deleted) { selected.current = null; setDetail(null); setComparison(null) }
      else { accept(data, action === 'duplicate'); if (action === 'save-item') { setItem(blankItem); setCandidates([]) } }
      setConfirmation(null); setMessage(action === 'publish' ? 'Scenario published. Live assignments were updated together.' : 'Scenario saved.'); await refreshLibrary()
    } catch (err) { setError(err.message); setConfirmation(null); setComparison(null) }
    finally { busy.current = false; setPending(false) }
  }
  async function createDraft(event) {
    event.preventDefault(); if (busy.current) return
    busy.current = true; setPending(true); setError('')
    try { const data = await createScenario({ ...create, startsAt: iso(create.startsAt), endsAt: iso(create.endsAt) }, getAccessTokenSilently); accept(data,true); setCreate({ name:'', startsAt:'',endsAt:'' }); await refreshLibrary(); setMessage('Draft copied from live assignments. Live allocations have not changed.') }
    catch (err) { setError(err.message) } finally { busy.current=false;setPending(false) }
  }
  async function compareLive() {
    const seq = ++request.current, id = scenario.id; setError('')
    try { const value = await compareScenario(id,getAccessTokenSilently); if (seq === request.current && selected.current === id) { if (value.version !== scenario.version) throw new Error('This draft changed. Refresh the scenario before comparing again.'); setComparison(value) } }
    catch (err) { if (seq === request.current) { setComparison(null);setError(err.message) } }
  }
  function editItem(value) { setItem({ ...value, startsAt: zaInput(value.startsAt), endsAt: zaInput(value.endsAt) }); setCandidates([]); document.getElementById('scenario-assignment-heading')?.scrollIntoView?.({ behavior:'smooth' }) }
  const payload = () => ({ ...(item.id ? { id:item.id } : {}), tutorId:Number(item.tutorId), courseId:Number(item.courseId), startsAt:iso(item.startsAt), endsAt:iso(item.endsAt), allocatedHours:Number(item.allocatedHours), minimumMark:Number(item.minimumMark) })
  async function rank() {
    setError('');setCandidates([])
    try { const value=payload();setCandidates(await listAllocationCandidates({ ...value, requestedHours:value.allocatedHours, excludeAllocationId:detail.items.find(x=>x.id===item.id)?.sourceAllocationId },getAccessTokenSilently)) }
    catch (err) { setError(err.message || 'Choose a course, time and hours first.') }
  }
  return <main id="main-content" className="dashboard-shell planning-workspace">
    <header className="dashboard-header"><div><p className="eyebrow">Organiser workspace</p><h1>Scenario planning</h1><p className="helper-text">Explore staffing plans in a draft, compare them with live assignments, then publish when you are ready.</p></div></header>
    {error && <div role="alert" className="status-message error"><p>{error}</p>{scenario && <button className="secondary-button" disabled={pending} onClick={()=>open(scenario.id,true)}>Refresh latest scenario</button>}</div>}
    {message && <p role="status" className="status-message">{message}</p>}
    <section className="role-card"><h2>Create a draft from live</h2><p className="helper-text">Choose a future window of up to 28 days. All date and time fields use South African time.</p><form className="planning-form" onSubmit={createDraft}>
      <label>New scenario name<input required maxLength="120" value={create.name} onChange={e=>setCreate({...create,name:e.target.value})} /></label>
      <label>Planning from<input required type="datetime-local" value={create.startsAt} onChange={e=>setCreate({...create,startsAt:e.target.value})} /></label>
      <label>Planning until<input required type="datetime-local" value={create.endsAt} onChange={e=>setCreate({...create,endsAt:e.target.value})} /></label>
      <button className="primary-button" disabled={pending}>Create draft</button>
    </form></section>
    <section className="role-card"><div className="planning-section-heading"><h2>Scenario library</h2><label>Show scenarios<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="DRAFT">Draft</option><option value="ARCHIVED">Archived</option><option value="PUBLISHED">Published</option></select></label></div>
      {loading ? <p role="status">Loading scenarios...</p> : !library.length ? <p>No scenarios in this category.</p> : <ul className="scenario-library">{library.map(s=><li key={s.id}><button className="secondary-button" disabled={pending} onClick={()=>open(s.id)} aria-pressed={scenario?.id===s.id}>{s.name}</button><span>{s.itemCount} assignments · Version {s.version} · {s.updatedByName || 'Former organiser'} · {when(s.updatedAt)}</span></li>)}</ul>}
    </section>
    {scenario && <>
      <section className="role-card"><h2>{scenario.name}</h2><p>{scenario.status} · Version {scenario.version} · Updated by {scenario.updatedByName || 'Former organiser'} at {when(scenario.updatedAt)}</p><p>{when(scenario.startsAt)} to {when(scenario.endsAt)}</p>
        <p aria-live="polite">{presence===null?'Collaborator presence is temporarily unavailable.':`Active organisers: ${presence.map(x=>x.fullName).join(', ') || 'Checking...'}`}</p><p className="helper-text">Activity expires after 90 seconds. It does not reserve the draft or grant permission.</p>
        <div className="button-row"><button className="secondary-button" disabled={pending} onClick={()=>open(scenario.id,true)}>Refresh latest scenario</button><button className="secondary-button" disabled={pending} onClick={compareLive}>Compare with Live</button>{scenario.status==='DRAFT'&&<button className="secondary-button" disabled={pending} onClick={()=>mutate('archive')}>Archive draft</button>}{scenario.status==='ARCHIVED'&&<button className="secondary-button" disabled={pending} onClick={()=>mutate('reopen')}>Reopen draft</button>}{scenario.status!=='PUBLISHED'&&<button className="danger-button" disabled={pending} onClick={()=>setConfirmation('delete')}>Delete scenario</button>}</div>
        <form className="planning-form" onSubmit={e=>{e.preventDefault();mutate('duplicate',{name:duplicateName})}}><label>Copy name<input required maxLength="120" value={duplicateName} onChange={e=>setDuplicateName(e.target.value)} /></label><button className="secondary-button" disabled={pending}>Duplicate scenario</button></form>
        {scenario.status==='DRAFT'&&<form className="planning-form" onSubmit={e=>{e.preventDefault();mutate('metadata',meta)}}><label>Scenario name<input required maxLength="120" value={meta.name} onChange={e=>setMeta({...meta,name:e.target.value})} /></label><label>Planning notes<textarea maxLength="2000" value={meta.notes} onChange={e=>setMeta({...meta,notes:e.target.value})} /></label><button className="secondary-button" disabled={pending}>Save name and notes</button></form>}
      </section>
      <section className="role-card"><h2>Draft assignments</h2><p className="helper-text">Locks protect draft assignments from edits and removal until explicitly unlocked. Publish always rechecks current hard rules.</p>
        <ul className="scenario-assignments">{detail.items.map(x=><li key={x.id}><div><strong>{x.courseCode} · {x.tutorName}</strong><p>{when(x.startsAt)} to {when(x.endsAt)} · {x.allocatedHours} hours</p><span>{x.locked?'Locked':'Unlocked'}</span></div>{scenario.status==='DRAFT'&&<div className="button-row"><button className="secondary-button" disabled={pending||x.locked} onClick={()=>editItem(x)}>Edit assignment</button><button className="secondary-button" disabled={pending} onClick={()=>mutate('lock',{itemId:x.id,locked:!x.locked})}>{x.locked?'Unlock':'Lock'}</button><button className="danger-button" disabled={pending||x.locked} onClick={()=>mutate('remove-item',{itemId:x.id})}>Remove from draft</button></div>}</li>)}</ul>
        {!detail.items.length&&<p>No assignments in this draft.</p>}
        {scenario.status==='DRAFT'&&<><h3 id="scenario-assignment-heading">{item.id?'Edit assignment':'Add assignment'}</h3><form className="planning-form" onSubmit={e=>{e.preventDefault();mutate('save-item',{item:payload()})}}>
          <label>Course<select required value={item.courseId} onChange={e=>{setItem({...item,courseId:e.target.value});setCandidates([])}}><option value="">Choose course</option>{courses.map(c=><option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}</select></label>
          <label>Tutor<select required value={item.tutorId} onChange={e=>setItem({...item,tutorId:e.target.value})}><option value="">Choose tutor</option>{tutors.map(t=><option key={t.id} value={t.id}>{t.fullName}</option>)}</select></label>
          <label>Assignment start<input required type="datetime-local" value={item.startsAt} onChange={e=>setItem({...item,startsAt:e.target.value})} /></label><label>Assignment end<input required type="datetime-local" value={item.endsAt} onChange={e=>setItem({...item,endsAt:e.target.value})} /></label>
          <label>Allocated hours<input required type="number" min="0.01" max="8" step="0.01" value={item.allocatedHours} onChange={e=>setItem({...item,allocatedHours:e.target.value})} /></label><label>Minimum mark<input required type="number" min="0" max="100" step="0.01" value={item.minimumMark} onChange={e=>setItem({...item,minimumMark:e.target.value})} /></label>
          <div className="button-row"><button className="primary-button" disabled={pending}>Save draft assignment</button><button type="button" className="secondary-button" disabled={pending||!item.courseId||!item.startsAt||!item.endsAt} onClick={rank}>Show ranked tutors</button>{item.id&&<button type="button" className="secondary-button" onClick={()=>setItem(blankItem)}>Cancel edit</button>}</div>
        </form>{candidates.length>0&&<div><p className="helper-text">Ranked by the existing live allocation rules. A draft may remove an existing clash; Publish checks the complete final plan.</p><ul className="scenario-library">{candidates.map(c=><li key={c.tutorId}><button className="secondary-button" onClick={()=>setItem({...item,tutorId:c.tutorId})}>{c.fullName}</button><span>{c.mark}% · {c.remainingHours} hours remaining · {c.isEligible?'Eligible in live plan':c.reasonCodes.join(', ')}</span></li>)}</ul></div>}</>}
      </section>
      {comparison&&<><Comparison value={comparison} />{scenario.status==='DRAFT'&&<section className="role-card"><h2>Publish this plan</h2><p>Publishing replaces the reviewed live assignments in this planning window. All changes succeed together or none are applied.</p><button className="primary-button" disabled={pending} onClick={()=>setConfirmation('publish')}>Publish scenario</button></section>}</>}
    </>}
    <ConfirmationDialog open={Boolean(confirmation)} title={confirmation==='publish'?'Publish this scenario to live?':'Delete this scenario?'} confirmLabel={confirmation==='publish'?'Confirm publish':'Delete scenario'} isPending={pending} onCancel={()=>setConfirmation(null)} onConfirm={()=>mutate(confirmation,confirmation==='publish'?{liveRevision:comparison?.liveRevision}:{})}>
      <p>{confirmation==='publish'?'The reviewed live assignments will be replaced. Eligibility, clashes and capacity will be checked again before any change is committed.':'This discards the scenario and its draft assignments. Live allocations remain unchanged.'}</p>
    </ConfirmationDialog>
  </main>
}
