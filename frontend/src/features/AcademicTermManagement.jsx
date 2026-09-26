import { useCallback, useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import {
  createAcademicTerm,
  deleteAcademicTerm,
  listAcademicTerms,
  updateAcademicTerm,
} from '../api/timetableImport'
import { ConfirmationDialog } from '../components/shared/ConfirmationDialog'
import { ErrorState, LoadingState } from '../components/shared/StatusMessage'

const EMPTY_FORM = { name: '', startsOn: '', endsOn: '', year: '', termNumber: '1', published: false, teachingBreaks: '' }

function validate(form) {
  const errors = {}
  if (!form.name.trim()) errors.name = 'A name is required.'
  if (!form.startsOn) errors.startsOn = 'A start date is required.'
  if (!form.endsOn) errors.endsOn = 'An end date is required.'
  else if (form.startsOn && form.endsOn < form.startsOn) errors.endsOn = 'End date must be on or after the start date.'
  if (!form.year.trim() || !Number.isInteger(Number(form.year)) || Number(form.year) < 2000) errors.year = 'Enter a valid year (e.g. 2026).'
  if (!['1', '2', '3'].includes(form.termNumber)) errors.termNumber = 'Choose term 1, 2 or 3.'
  if (form.teachingBreaks.trim()) {
    const parts = form.teachingBreaks.split(',').map((part) => part.trim()).filter(Boolean)
    for (const part of parts) {
      const [start, end] = part.split('..').map((s) => s.trim())
      if (!start || !end || start > end) {
        errors.teachingBreaks = 'Each break must be start..end dates (e.g. 2026-03-15..2026-03-22).'
        break
      }
    }
  }
  return errors
}

export default function AcademicTermManagement() {
  const { getAccessTokenSilently } = useAuth0()
  const [terms, setTerms] = useState([])
  const [status, setStatus] = useState('loading')
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [termToDelete, setTermToDelete] = useState(null)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const result = await listAcademicTerms(getAccessTokenSilently)
      setTerms(result)
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }, [getAccessTokenSilently])

  useEffect(() => {
    load()
  }, [load])

  function reset() {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setErrors({})
  }

  function edit(term) {
    setForm({
      name: term.name,
      startsOn: term.startsOn,
      endsOn: term.endsOn,
      year: String(term.year ?? ''),
      termNumber: String(term.termNumber ?? '1'),
      published: Boolean(term.published),
      teachingBreaks: Array.isArray(term.teachingBreaks)
        ? term.teachingBreaks.map((b) => `${b.startsOn}..${b.endsOn}`).join(', ')
        : '',
    })
    setEditingId(term.id)
    setErrors({})
    setError('')
    setMessage('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (pending) return
    const nextErrors = validate(form)
    setErrors(nextErrors)
    setError('')
    setMessage('')
    if (Object.keys(nextErrors).length) return

    const breaks = form.teachingBreaks.trim()
      ? form.teachingBreaks.split(',').map((part) => {
        const [startsOn, endsOn] = part.trim().split('..').map((s) => s.trim())
        return { startsOn, endsOn }
      })
      : []

    const payload = {
      name: form.name.trim(),
      startsOn: form.startsOn,
      endsOn: form.endsOn,
      year: Number(form.year),
      termNumber: Number(form.termNumber),
      published: form.published,
      teachingBreaks: breaks,
    }

    setPending(true)
    try {
      if (editingId) {
        await updateAcademicTerm(editingId, payload, getAccessTokenSilently)
        setMessage('Academic term updated.')
      } else {
        await createAcademicTerm(payload, getAccessTokenSilently)
        setMessage('Academic term created.')
      }
      reset()
      await load()
    } catch (failure) {
      setError(failure?.message || 'The term could not be saved. Check the details and try again.')
    } finally {
      setPending(false)
    }
  }

  async function confirmDelete() {
    if (!termToDelete || pending) return
    setPending(true)
    setError('')
    setMessage('')
    try {
      await deleteAcademicTerm(termToDelete.id, getAccessTokenSilently)
      setTerms((current) => current.filter((t) => t.id !== termToDelete.id))
      if (editingId === termToDelete.id) reset()
      setMessage('Academic term deleted.')
    } catch {
      setError('The term could not be deleted. Try again.')
    } finally {
      setPending(false)
      setTermToDelete(null)
    }
  }

  function field(name, value) {
    setForm((current) => ({ ...current, [name]: value }))
  }

  return (
    <main id="main-content" className="dashboard-shell organiser-home">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Organiser settings</p>
          <h1>Academic terms</h1>
          <p className="helper-text">
            Manage the academic year and terms. Terms control which dates tutors can import timetables for, and teaching breaks pause weekly recurrence during those weeks.
          </p>
        </div>
      </header>

      <section className="role-card tutor-form-card" aria-labelledby="term-form-heading">
        <h2 id="term-form-heading">{editingId ? 'Edit term' : 'Add term'}</h2>
        <form className="tutor-form schedule-editor" onSubmit={handleSubmit} noValidate>
          <div className="field-group">
            <label htmlFor="term-name">Name</label>
            <input id="term-name" value={form.name} maxLength={120} disabled={pending}
              onChange={(event) => field('name', event.target.value)}
              aria-invalid={Boolean(errors.name)} placeholder="e.g. Semester 1, 2026" />
            {errors.name && <p className="error-text">{errors.name}</p>}
          </div>
          <div className="field-group">
            <label htmlFor="term-year">Year</label>
            <input id="term-year" type="number" min="2000" max="2099" value={form.year} disabled={pending}
              onChange={(event) => field('year', event.target.value)}
              aria-invalid={Boolean(errors.year)} />
            {errors.year && <p className="error-text">{errors.year}</p>}
          </div>
          <div className="field-group">
            <label htmlFor="term-number">Term number</label>
            <select id="term-number" value={form.termNumber} disabled={pending}
              onChange={(event) => field('termNumber', event.target.value)}>
              <option value="1">Term 1</option>
              <option value="2">Term 2</option>
              <option value="3">Term 3</option>
            </select>
            {errors.termNumber && <p className="error-text">{errors.termNumber}</p>}
          </div>
          <div className="field-group">
            <label htmlFor="term-starts">Start date</label>
            <input id="term-starts" type="date" value={form.startsOn} disabled={pending}
              onChange={(event) => field('startsOn', event.target.value)}
              aria-invalid={Boolean(errors.startsOn)} />
            {errors.startsOn && <p className="error-text">{errors.startsOn}</p>}
          </div>
          <div className="field-group">
            <label htmlFor="term-ends">End date</label>
            <input id="term-ends" type="date" value={form.endsOn} disabled={pending}
              onChange={(event) => field('endsOn', event.target.value)}
              aria-invalid={Boolean(errors.endsOn)} />
            {errors.endsOn && <p className="error-text">{errors.endsOn}</p>}
          </div>
          <div className="field-group">
            <label htmlFor="term-breaks">Teaching breaks (optional)</label>
            <input id="term-breaks" value={form.teachingBreaks} disabled={pending}
              onChange={(event) => field('teachingBreaks', event.target.value)}
              placeholder="e.g. 2026-03-15..2026-03-22, 2026-06-01..2026-06-07"
              aria-describedby="term-breaks-help"
              aria-invalid={Boolean(errors.teachingBreaks)} />
            <p className="helper-text" id="term-breaks-help">Comma-separated date ranges. Weekly entries pause during these weeks.</p>
            {errors.teachingBreaks && <p className="error-text">{errors.teachingBreaks}</p>}
          </div>
          <label className="checkbox-field" htmlFor="term-published">
            <input id="term-published" type="checkbox" checked={form.published} disabled={pending}
              onChange={(event) => field('published', event.target.checked)} />
            Published (visible to tutors for import)
          </label>
          <div className="button-row">
            <button className="primary-button" type="submit" disabled={pending}>
              {pending ? 'Saving...' : editingId ? 'Save term' : 'Create term'}
            </button>
            {editingId && <button className="secondary-button" type="button" disabled={pending} onClick={reset}>Cancel edit</button>}
          </div>
        </form>
        {message && <p className="status-note" role="status">{message}</p>}
        {error && <p className="status-note danger" role="alert">{error}</p>}
      </section>

      <section className="role-card" aria-labelledby="term-list-heading">
        <h2 id="term-list-heading">Existing terms</h2>
        {status === 'loading' && <LoadingState title="Loading terms" message="Checking saved academic terms." />}
        {status === 'error' && <ErrorState title="Terms unavailable" message="Academic terms could not be loaded." onRetry={load} />}
        {status === 'success' && (terms.length === 0
          ? <p>No academic terms have been created yet.</p>
          : <ul className="detail-record-list" aria-label="Academic terms">
            {terms.map((term) => (
              <li key={term.id}>
                <strong>{term.name}</strong>
                <span>{term.startsOn} to {term.endsOn}</span>
                <span>Year {term.year ?? '?'}, Term {term.termNumber ?? '?'}{term.published ? ' — Published' : ' — Draft'}</span>
                <div className="button-row">
                  <button type="button" className="secondary-button" disabled={pending} onClick={() => edit(term)}>Edit</button>
                  <button type="button" className="danger-button" disabled={pending} onClick={() => setTermToDelete(term)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>)}
      </section>

      <ConfirmationDialog open={Boolean(termToDelete)} title="Delete academic term?" confirmLabel="Delete term"
        isPending={pending} onConfirm={confirmDelete} onCancel={() => { if (!pending) setTermToDelete(null) }}>
        <p>This removes the term. Existing imported entries are not deleted but will no longer be linked to a term.</p>
      </ConfirmationDialog>
    </main>
  )
}
