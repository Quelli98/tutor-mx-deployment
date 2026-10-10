import { useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { Link } from 'react-router-dom'
import { compareProposalStrategies, generateProposal, getProposalExplanations, adjustProposal } from '../api/proposals'
import { listScenarios } from '../api/planning'

const iso = value => new Date(`${value}+02:00`).toISOString()
const zaInput = value => new Date(new Date(value).valueOf() + 7200000).toISOString().slice(0, 16)
const when = value => new Date(value).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' })
const money = value => value == null ? 'Rate not set' : `R ${Number(value).toFixed(2)}`
const labels = { BALANCED:'Balanced', STRONGEST_MATCH:'Strongest Match', FAIR_WORKLOAD:'Fair Workload', BUDGET_AWARE:'Budget Aware' }
function defaultRange() {
  const start = new Date(Date.now() + 86400000)
  start.setMinutes(0, 0, 0)
  const end = new Date(start.valueOf() + 7 * 86400000)
  return { name:'Whole-school proposal', startsAt:zaInput(start), endsAt:zaInput(end), preset:'BALANCED', baseScenarioId:'' }
}
function workloadSummary(metrics) {
  if (!metrics?.workload?.length) return 'No allocated hours'
  return metrics.workload.map(row => `${row.tutorName}: ${row.hours} h`).join(' · ')
}
function hardRuleText(value) {
  if (value?.chosen && value?.eligible) return 'Hard rules: Pass — mark, clash and selected-week capacity.'
  if (value?.chosen) return `Hard rules: Recheck required${value.hardFailures?.length ? ` — ${value.hardFailures.join(', ')}` : ''}.`
  return value?.eligible ? 'Hard rules: Pass.' : `Hard rules: Fail — ${(value?.hardFailures || []).join(', ') || 'not currently eligible'}.`
}
function Explanation({ assignment }) {
  const chosen = assignment.explanation?.find(row => row.chosen)
  const alternatives = (assignment.explanation || []).filter(row => !row.chosen)
  return <div className="proposal-explanation">
    <p><strong>{hardRuleText(chosen)}</strong></p>
    <p>{chosen?.reason || 'The current explanation is unavailable. Refresh before publishing.'}</p>
    {chosen?.softScore != null && <p>Soft score: {Number(chosen.softScore).toFixed(2)}</p>}
    {chosen?.factors?.length > 0 && <ul>{chosen.factors.map((factor, index) => <li key={`${chosen.tutorId}-${index}`}>{factor}</li>)}</ul>}
    <details><summary>Why not the others?</summary>{alternatives.length ? <ul>{alternatives.map(row => <li key={row.tutorId}><strong>{row.fullName}:</strong> {row.reason}{row.softScore != null ? ` Soft score ${Number(row.softScore).toFixed(2)}.` : ''}</li>)}</ul> : <p>No other candidate was returned for this requirement.</p>}</details>
  </div>
}

function Shortages({ shortages = [] }) {
  return shortages.length > 0 && <div className="status-message"><strong>Needs attention:</strong>{shortages.map(value => <div key={value.requirementId ?? value.courseCode}><p>{value.courseCode}: {value.hours} h short</p><details><summary>Why is this requirement unfilled?</summary>{value.explanation?.length ? <ul>{value.explanation.map(row => <li key={row.tutorId}><strong>{row.fullName}:</strong> {row.reason}</li>)}</ul> : <p>No candidate explanation is available. Review current tutor eligibility and the starting draft.</p>}</details></div>)}</div>
}

export default function ProposalLab(){
  const { getAccessTokenSilently } = useAuth0()
  const [form, setForm] = useState(defaultRange)
  const [drafts, setDrafts] = useState([])
  const [comparison, setComparison] = useState([])
  const [comparisonReview, setComparisonReview] = useState(null)
  const [result, setResult] = useState(null)
  const [explanations, setExplanations] = useState(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [draftError, setDraftError] = useState('')
  const [message, setMessage] = useState('')
  const [adjust, setAdjust] = useState({itemId:'',tutorId:'',reason:''})

  useEffect(() => {
    let active = true
    listScenarios('DRAFT', getAccessTokenSilently)
      .then(value => { if (active) setDrafts(Array.isArray(value) ? value : []) })
      .catch(err => { if (active) setDraftError(err?.message || 'Draft scenarios could not be loaded. You can still generate from live allocations.') })
    return () => { active = false }
  }, [getAccessTokenSilently])

  function changeForm(changes) {
    setComparison([]); setComparisonReview(null); setMessage('')
    setForm(current => ({ ...current, ...changes }))
  }
  const basePart = () => form.baseScenarioId ? { baseScenarioId:Number(form.baseScenarioId) } : {}
  const payload = (preset=form.preset) => ({ name:form.name, startsAt:iso(form.startsAt), endsAt:iso(form.endsAt), preset, ...basePart() })
  function chooseBase(value) {
    const selected = drafts.find(row => String(row.id) === String(value))
    setComparison([])
    setComparisonReview(null)
    setForm(current => selected ? { ...current, baseScenarioId:String(selected.id), startsAt:zaInput(selected.startsAt), endsAt:zaInput(selected.endsAt) } : { ...current, baseScenarioId:'' })
  }
  async function compare(){
    setPending(true); setError(''); setComparison([]); setComparisonReview(null)
    try {
      const value = await compareProposalStrategies({ name:form.name, startsAt:iso(form.startsAt), endsAt:iso(form.endsAt), ...basePart() }, getAccessTokenSilently)
      setComparison(value)
      setMessage('Strategy comparison generated from identical inputs, locks and hard rules. Review workload and explanations before saving a strategy.')
    } catch(e) { setError(e.message) } finally { setPending(false) }
  }
  async function generate(preset=form.preset, comparisonToken){
    setPending(true); setError(''); setResult(null); setExplanations(null); setMessage('')
    try {
      const data = await generateProposal({...payload(preset), ...(comparisonToken ? { comparisonToken } : {})}, getAccessTokenSilently)
      setResult(data); setForm(current => ({...current,preset}))
      setExplanations(await getProposalExplanations(data.scenario.id, getAccessTokenSilently))
      setMessage('Proposal saved as a normal draft Scenario. Review the explanations, then Compare with Live before publishing.')
    } catch(e) { setError(e.message) } finally { setPending(false) }
  }
  async function applyAdjust(e){
    e.preventDefault(); if(!result) return; setPending(true); setError('')
    try {
      const data = await adjustProposal(result.scenario.id, {version:result.scenario.version,itemId:Number(adjust.itemId),tutorId:Number(adjust.tutorId),reason:adjust.reason}, getAccessTokenSilently)
      setResult(current => ({...current,...data}))
      setExplanations(await getProposalExplanations(result.scenario.id, getAccessTokenSilently))
      setAdjust({itemId:'',tutorId:'',reason:''})
      setMessage('Eligible manual adjustment saved with its reason.')
    } catch(err) {
      setError(err.message)
      if (err.status === 409) {
        try {
          const latest = await getProposalExplanations(result.scenario.id, getAccessTokenSilently)
          setExplanations(latest); setResult(current => ({ ...current, scenario: latest.scenario }))
          setAdjust({itemId:'',tutorId:'',reason:''})
        } catch { setExplanations(null) }
      }
    } finally { setPending(false) }
  }

  return <main id="main-content" className="dashboard-shell planning-workspace">
    <header className="dashboard-header"><div><p className="eyebrow">Organiser workspace</p><h1>Allocation proposal lab</h1><p className="helper-text">Generate explainable whole-school draft staffing plans. Hard rules never change; strategy presets change only the soft preference weights.</p></div></header>
    {error && <p role="alert" className="status-message error">{error}</p>}{message && <p role="status" className="status-message">{message}</p>}
    <section className="role-card"><h2>Generate a proposal</h2><p className="helper-text">Confirmed Student tutoring bookings are part of the shared clash rules used by candidate eligibility. Choose an existing Draft only when you want its current assignments and locks to be the starting point.</p>{draftError && <p className="status-message">{draftError}</p>}<div className="planning-form">
      <label>Proposal name<input maxLength="120" value={form.name} onChange={e=>changeForm({name:e.target.value})}/></label>
      <label>Starting draft / locks (optional)<select value={form.baseScenarioId} onChange={e=>chooseBase(e.target.value)}><option value="">Live allocations only</option>{drafts.map(row=><option key={row.id} value={row.id}>{row.name} · Version {row.version}</option>)}</select></label>
      <label>Planning from<input type="datetime-local" value={form.startsAt} onChange={e=>changeForm({startsAt:e.target.value,baseScenarioId:''})}/></label>
      <label>Planning until<input type="datetime-local" value={form.endsAt} onChange={e=>changeForm({endsAt:e.target.value,baseScenarioId:''})}/></label>
      <label>Strategy preset<select value={form.preset} onChange={e=>setForm({...form,preset:e.target.value})}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <div className="button-row"><button className="primary-button" disabled={pending} onClick={()=>generate()}>Generate Proposal</button><button className="secondary-button" disabled={pending} onClick={compare}>Compare all strategies</button></div>
    </div></section>

    {comparison.length>0 && <section className="role-card"><h2>Strategy comparison + impact lab</h2><p className="helper-text">Every row uses the same planning window, starting draft/locks and hard rules. Coverage, shortage, projected cost and workload use the proposal's shared scenario/report definitions.</p><div className="planning-table-scroll" tabIndex="0" role="region" aria-label="Strategy impact comparison"><table className="planning-table"><thead><tr><th>Strategy</th><th>New assignments</th><th>Allocated hours</th><th>Shortage hours</th><th>Projected cost</th><th>Workload</th><th>Actions</th></tr></thead><tbody>{comparison.map(value=><tr key={value.preset}><th>{labels[value.preset]}</th><td>{value.metrics.proposedAssignments}</td><td>{value.metrics.allocatedHours ?? value.metrics.coveredTutorHours}</td><td>{value.metrics.shortageHours}</td><td>{money(Object.prototype.hasOwnProperty.call(value.metrics, 'projectedCost') ? value.metrics.projectedCost : value.metrics.projectedAddedSpend)}</td><td>{workloadSummary(value.metrics)}</td><td><div className="button-row"><button className="secondary-button" disabled={pending} onClick={()=>setComparisonReview(value)}>Review why</button><button className="secondary-button" disabled={pending} onClick={()=>generate(value.preset,value.comparisonToken)}>Save this strategy as Scenario</button></div></td></tr>)}</tbody></table></div>
      {comparisonReview && <div className="proposal-strategy-review" aria-label={`${labels[comparisonReview.preset]} explanation`}><h3>{labels[comparisonReview.preset]}: Why these Tutors?</h3><Shortages shortages={comparisonReview.shortages}/>{comparisonReview.assignments?.length ? comparisonReview.assignments.map((assignment,index)=><article key={`${assignment.requirementId}-${assignment.tutorId}-${index}`}><h4>{assignment.courseCode} · {assignment.tutorName}</h4><p>{when(assignment.startsAt)} – {when(assignment.endsAt)}</p><Explanation assignment={assignment}/></article>) : <p>No new assignment was proposed for this strategy. Review shortage hours and the current draft coverage above.</p>}</div>}
    </section>}

    {result && <section className="role-card"><h2>Proposal cockpit: Why this Tutor? / Why not?</h2><p><strong>{result.scenario.name}</strong> · {labels[explanations?.preset || form.preset]} · Draft Scenario #{result.scenario.id}</p><p className="helper-text">Final path: Generate Proposal → Why these Tutors? → Save as Scenario → Compare with Live → Publish.</p><div className="button-row"><Link className="secondary-button" to={`/organiser/scenarios?scenario=${result.scenario.id}`}>Open Scenario planning</Link></div>
      <Shortages shortages={result.proposal?.shortages}/>
      <div className="planning-table-scroll" tabIndex="0" role="region" aria-label="Proposal assignments"><table className="planning-table"><thead><tr><th>Course</th><th>Suggested Tutor</th><th>Time</th><th>Why this Tutor?</th></tr></thead><tbody>{(explanations?.assignments||[]).map(assignment=><tr key={assignment.id}><th>{assignment.courseCode}</th><td>{assignment.tutorName}</td><td>{when(assignment.startsAt)} – {when(assignment.endsAt)}</td><td><Explanation assignment={assignment}/></td></tr>)}</tbody></table>{!explanations?.assignments?.length && <p>No new engine-generated assignment is in this proposal. Existing/locked coverage is preserved; review shortages before publishing.</p>}</div>
      <h3>Manual eligible adjustment</h3><p className="helper-text">A manual change must still pass mark, clash and selected-week capacity rules and requires a reason.</p><form className="planning-form" onSubmit={applyAdjust}><label>Proposal assignment<select required value={adjust.itemId} onChange={e=>setAdjust({...adjust,itemId:e.target.value,tutorId:''})}><option value="">Choose assignment</option>{(explanations?.assignments||[]).map(assignment=><option key={assignment.id} value={assignment.id}>{assignment.courseCode} · {assignment.tutorName}</option>)}</select></label><label>Eligible replacement Tutor<select required value={adjust.tutorId} onChange={e=>setAdjust({...adjust,tutorId:e.target.value})}><option value="">Choose Tutor</option>{(explanations?.assignments.find(assignment=>String(assignment.id)===String(adjust.itemId))?.explanation||[]).filter(value=>value.eligible&&!value.chosen).map(value=><option key={value.tutorId} value={value.tutorId}>{value.fullName}</option>)}</select></label><label>Reason<textarea required minLength="3" maxLength="500" value={adjust.reason} onChange={e=>setAdjust({...adjust,reason:e.target.value})}/></label><button className="secondary-button" disabled={pending}>Save eligible adjustment</button></form>
    </section>}
  </main>
}
