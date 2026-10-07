import { useCallback, useEffect, useRef, useState } from 'react'
import {
  commitTimetableImport, currentTimeZone, listPublishedAcademicTerms, previewTimetableImport,
} from '../api/timetableImport'
import { ErrorState, LoadingState } from '../components/shared/StatusMessage'

const SAMPLE = `date,start,end,label,repeat,until,category
2026-09-30,08:00,09:45,COMS3005A Lecture - C9,weekly,,class
2026-10-01,08:00,09:45,COMS3011A Lecture - CB38,weekly,,class
2026-10-01,10:15,12:00,COMS3010A Lecture - WSS5,weekly,,class
2026-10-02,12:30,13:15,COMS3005A Tutorial,weekly,,class`

function termLabel(term) {
  return term.termNumber && term.year ? `Term ${term.termNumber} · ${term.year}` : term.name
}

/** The first line of a CSV or pasted table, so the paste box can be checked early. */
function looksLikeCalendar(text) {
  return /BEGIN:VEVENT/i.test(text)
}

function formatLocal(value) {
  if (!value) return '-'
  const parsed = new Date(value)
  return Number.isFinite(parsed.valueOf()) ? parsed.toLocaleString() : value
}

function formatRecurrence(row) {
  if (row.recurrence === 'FORTNIGHTLY') return row.localRecurrenceUntil ? `Fortnightly until ${row.localRecurrenceUntil}` : 'Fortnightly'
  if (row.recurrence !== 'WEEKLY') return 'One-off'
  return row.localRecurrenceUntil ? `Weekly until ${row.localRecurrenceUntil}` : 'Weekly'
}

export default function TimetableImport({ tokenOrGetter, onImported }) {
  const [terms, setTerms] = useState([])
  const [termId, setTermId] = useState('')
  const [source, setSource] = useState('CSV')
  const [text, setText] = useState('')
  const [loadStatus, setLoadStatus] = useState('loading')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState(null)
  const [fileName, setFileName] = useState('')
  const fileInput = useRef(null)

  const load = useCallback(async (isActive = () => true) => {
    setLoadStatus('loading')
    try {
      const result = await listPublishedAcademicTerms(tokenOrGetter)
      if (!isActive()) return
      setTerms(result)
      setTermId('')
      setLoadStatus('success')
    } catch {
      if (isActive()) setLoadStatus('error')
    }
  }, [tokenOrGetter])

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(() => active)
    return () => { active = false }
  }, [load])

  function clearFeedback() {
    setError('')
    setMessage('')
  }

  function chooseSource(next) {
    setSource(next)
    setTermId('')
    // A calendar file is a different format entirely, so keeping the old text
    // would only produce confusing row errors.
    setText('')
    setFileName('')
    setPreview(null)
    clearFeedback()
    if (fileInput.current) fileInput.current.value = ''
  }

  async function readFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (pending) return
    clearFeedback()
    setPreview(null)
    setPending(true)
    setTermId('')
    try {
      const contents = await file.text()
      setText(contents)
      setFileName(file.name)
      // Switch to the calendar reader when the file says it is one.
      const format = looksLikeCalendar(contents) ? 'ICS' : 'CSV'
      setSource(format)
      setPreview(await previewTimetableImport({ source: format, text: contents, timeZone: currentTimeZone() }, tokenOrGetter))
    } catch (failure) {
      setError(failure?.message || 'That file could not be read. Try pasting its contents instead.')
    } finally {
      setPending(false)
    }
  }

  async function handlePreview(event) {
    event.preventDefault()
    if (pending) return
    clearFeedback()
    setPreview(null)
    setPending(true)
    try {
      setPreview(await previewTimetableImport({
        source, text, termId: termId ? Number(termId) : undefined, timeZone: currentTimeZone(),
      }, tokenOrGetter))
    } catch (failure) {
      setError(failure?.message || 'The timetable could not be read. Check the format and try again.')
    } finally {
      setPending(false)
    }
  }

  async function handleCommit() {
    if (pending || !preview) return
    clearFeedback()
    setPending(true)
    try {
      const result = await commitTimetableImport({
        source, text, termId: preview.term.id, timeZone: currentTimeZone(),
      }, tokenOrGetter)
      setMessage(
        result.created === 1
          ? 'Imported 1 schedule entry.'
          : `Imported ${result.created} schedule entries.`,
      )
      setText('')
      setTermId('')
      setFileName('')
      setPreview(null)
      if (fileInput.current) fileInput.current.value = ''
      try {
        await onImported?.()
      } catch {
        setError('Your timetable was saved, but the schedule could not be refreshed. Reload the schedule to see it.')
      }
    } catch (failure) {
      setError(failure?.message || 'The timetable save could not be confirmed. Retry the same import to check it safely.')
    } finally {
      setPending(false)
    }
  }

  const importable = preview ? preview.validCount : 0

  return (
    <section className="role-card tutor-form-card" aria-labelledby="timetable-import-heading">
      <div>
        <h2 id="timetable-import-heading">Import your timetable</h2>
        <p className="helper-text" id="import-help">
          Upload your timetable without entering every class manually. Choose CSV / ICS or paste rows below.
          We detect the published academic term from your dates and show a preview before saving.
        </p>
      </div>

      <aside className="status-note" aria-label="CSV template instructions">
        <h3>Need a template?</h3>
        <a className="secondary-button" href="/templates/timetable-template.csv" download="timetable-template.csv">Download CSV template</a>
        <details>
          <summary>View example</summary>
          <pre style={{ overflowX: 'auto' }}>{SAMPLE}</pre>
          <p>Replace the example dates and classes with yours.</p>
        </details>
        <dl className="import-column-help">
          <dt>date</dt><dd>First occurrence: YYYY-MM-DD.</dd>
          <dt>start / end</dt><dd>24-hour HH:MM, for example 08:00 / 09:45.</dd>
          <dt>label</dt><dd>Your timetable display name; include the course, activity and venue.</dd>
          <dt>repeat</dt><dd>once / weekly / fortnightly.</dd>
          <dt>until</dt><dd>Optional final repeat date (YYYY-MM-DD). Leave blank to stop at term end.</dd>
          <dt>category</dt><dd>class / study / busy. Existing unavailable, lecture, lab, tutorial and seminar values also work.</dd>
        </dl>
        <p>Times use Africa/Johannesburg. Import one academic term at a time. Teaching breaks pause recurring entries.</p>
      </aside>

      <form className="tutor-form schedule-editor" onSubmit={handlePreview} noValidate aria-describedby="import-help">
        <div className="field-group">
          <label htmlFor="import-term">Academic term</label>
          <select id="import-term" value={termId} disabled={pending || loadStatus !== 'success'}
            onChange={(event) => { setTermId(event.target.value); setPreview(null); clearFeedback() }}>
            <option value="">{terms.length ? "Automatically detect from file dates" : "No published terms available"}</option>
            {terms.map((term) => (
              <option key={term.id} value={term.id}>
                {termLabel(term)} ({term.startsOn} to {term.endsOn})
              </option>
            ))}
          </select>
        </div>

        <fieldset className="field-group">
          <legend>Format</legend>
          <label className="checkbox-field" htmlFor="import-source-csv">
            <input id="import-source-csv" type="radio" name="import-source" checked={source === 'CSV'}
              disabled={pending} onChange={() => chooseSource('CSV')} />
            Pasted rows or a .csv file
          </label>
          <label className="checkbox-field" htmlFor="import-source-ics">
            <input id="import-source-ics" type="radio" name="import-source" checked={source === 'ICS'}
              disabled={pending} onChange={() => chooseSource('ICS')} />
            A calendar (.ics) file
          </label>
        </fieldset>

        <div className="field-group">
          <label htmlFor="import-file">Choose a file (optional)</label>
          <input id="import-file" type="file" ref={fileInput} disabled={pending}
            accept=".csv,.ics,text/csv,text/calendar,text/plain"
            onChange={readFile} aria-describedby="import-file-help" />
          <p className="helper-text" id="import-file-help">
            {fileName ? `Loaded ${fileName}.` : 'Reading a file fills the box below so you can check it first.'}
          </p>
        </div>

        <div className="field-group">
          <label htmlFor="import-text">{source === 'ICS' ? 'Calendar contents' : 'Timetable rows'}</label>
          <textarea id="import-text" rows={8} value={text} disabled={pending}
            placeholder={source === 'ICS' ? 'BEGIN:VCALENDAR...' : SAMPLE}
            onChange={(event) => { setText(event.target.value); setPreview(null) }}
            aria-describedby="import-text-help" />
          <p className="helper-text" id="import-text-help">
            {source === 'ICS'
              ? 'Paste the contents of the calendar file. Weekly and fortnightly events are imported; one-off events stay as single entries.'
              : 'The first line must name the columns: date, start, end, and optionally label, repeat, until and category.'}
          </p>
        </div>

        <div className="button-row">
          <button className="primary-button" type="submit" disabled={pending || text.trim().length === 0 || loadStatus !== 'success'}>
            {pending && !preview ? 'Reading...' : 'Preview import'}
          </button>
        </div>
      </form>

      {pending && <LoadingState title="Working on your timetable" message="This only takes a moment." />}
      {loadStatus === 'error' && (
        <ErrorState title="Academic terms unavailable" message="Terms could not be loaded, so the import is disabled."
          onRetry={() => load()} />
      )}
      {message && <p className="status-note" role="status">{message}</p>}
      {error && <p className="status-note danger" role="alert">{error}</p>}

      {preview && (
        <section className="import-preview" aria-labelledby="import-preview-heading">
          <h3 id="import-preview-heading">Import preview</h3>
          {preview.suggestedTerm && <p className="status-note danger" role="alert">
            This class starts outside the selected academic term. Matching term: {termLabel(preview.suggestedTerm)}.
            <button className="secondary-button" type="button" disabled={pending} onClick={() => { setTermId(String(preview.suggestedTerm.id)); setPreview(null); clearFeedback() }}>Use {termLabel(preview.suggestedTerm)}</button>
          </p>}
          <p role="status"><strong>{preview.detectedTerm ? "Automatically detected" : "Academic term"}: {termLabel(preview.term)} ✓</strong></p>
          <p>{preview.rows.length} rows found{preview.dateRange && ` · ${preview.dateRange.startsOn} – ${preview.dateRange.endsOn}`}</p>
          <p className="helper-text">
            Times are shown in {preview.timeZone} and repeated weekly entries stop at the end of {preview.term.name}.
          </p>
          <p className="status-note">
            ✓ {preview.validCount} new entries · ↺ {preview.duplicateCount} already in your timetable · ⚠ {preview.invalidCount} errors.
            Already existing entries will be skipped automatically.
          </p>

          <div className="table-scroll">
            <table>
              <caption className="visually-hidden">Parsed timetable rows</caption>
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Starts</th>
                  <th scope="col">Ends</th>
                  <th scope="col">Description</th>
                  <th scope="col">Repeats</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={`${row.sourceRow}-${row.localStartsAt ?? 'invalid'}`}>
                    <td>{row.sourceRow}</td>
                    <td>{formatLocal(row.localStartsAt)}</td>
                    <td>{formatLocal(row.localEndsAt)}</td>
                    <td>{row.label || '-'}</td>
                    <td>{formatRecurrence(row)}</td>
                    <td>
                      {row.duplicate ? <span className="status-note">↺ Already in your timetable — skipped</span> : row.errors.length === 0
                        ? <span className="status-note">✓ New / Ready</span>
                        : <ul className="import-row-errors" aria-label="Needs attention">
                          {row.errors.map((item) => <li key={item} className="error-text">{item}</li>)}
                        </ul>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.rows.length === 0 && <p>That file had no rows to import.</p>}

          <div className="button-row">
            <button className="primary-button" type="button" disabled={pending || importable === 0}
              onClick={handleCommit}>
              {pending ? 'Saving...' : `Import ${importable} new ${importable === 1 ? 'entry' : 'entries'}`}
            </button>
            <button className="secondary-button" type="button" disabled={pending}
              onClick={() => { setPreview(null); clearFeedback() }}>
              Cancel
            </button>
          </div>
          {preview.validCount === 0 && preview.rows.length > 0 && (
            <p className="helper-text">
              {preview.invalidCount === 0 ? "Everything is already in your timetable. Nothing will be duplicated." : "Fix the rows that need attention and preview again."}
            </p>
          )}
        </section>
      )}
    </section>
  )
}
