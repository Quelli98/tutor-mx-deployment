import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TimetableImport from './TimetableImport'

const mockListTerms = vi.fn()
const mockPreview = vi.fn()
const mockCommit = vi.fn()
const tokenGetter = vi.fn()
const onImported = vi.fn()

vi.mock('../api/timetableImport', () => ({
  listPublishedAcademicTerms: (...args) => mockListTerms(...args),
  previewTimetableImport: (...args) => mockPreview(...args),
  commitTimetableImport: (...args) => mockCommit(...args),
  currentTimeZone: () => 'UTC',
}))

// One finished term and one still to come, so the picker's default is decided by
// the term's end date rather than by list order.
const finishedTerm = { id: 1, name: 'Demo 2019 Semester 1', startsOn: '2019-02-11', endsOn: '2019-06-14' }
const upcomingTerm = { id: 2, name: 'Demo 2030 Semester 2', startsOn: '2030-08-26', endsOn: '2030-11-29' }

const csvText = 'date,start,end,label,repeat\n2030-09-02,09:00,11:00,Maths tutorial,weekly'

const readyRow = {
  sourceRow: 2,
  timeZone: 'UTC',
  localStartsAt: '2030-09-02T09:00',
  localEndsAt: '2030-09-02T11:00',
  localRecurrenceUntil: '2030-11-29',
  label: 'Maths tutorial',
  recurrence: 'WEEKLY',
  duplicate: false,
  slot: {
    type: 'BUSY',
    startsAt: '2030-09-02T09:00:00.000Z',
    endsAt: '2030-09-02T11:00:00.000Z',
    recurrence: 'WEEKLY',
    label: 'Maths tutorial',
    recurrenceUntil: '2030-11-29T23:59:59.999Z',
  },
  errors: [],
}

const brokenRow = {
  sourceRow: 3,
  timeZone: 'UTC',
  localStartsAt: null,
  localEndsAt: null,
  localRecurrenceUntil: null,
  label: null,
  recurrence: null,
  duplicate: false,
  slot: null,
  errors: ['"2030-13-40" is not a valid date. Use YYYY-MM-DD.'],
}

function previewPayload(overrides = {}) {
  const rows = overrides.rows ?? [readyRow]
  return {
    source: 'CSV',
    timeZone: 'UTC',
    term: upcomingTerm,
    rows,
    validCount: rows.filter((row) => row.errors.length === 0).length,
    invalidCount: rows.filter((row) => row.errors.length > 0).length,
    duplicateCount: rows.filter((row) => row.duplicate).length,
    ...overrides,
  }
}

/** Renders and waits for the term list to settle so no state update lands late. */
async function renderImport() {
  render(<TimetableImport tokenOrGetter={tokenGetter} onImported={onImported} />)
  await waitFor(() => expect(screen.getByLabelText(/academic term/i)).toHaveValue(''))
}

function typeRows(value = csvText) {
  fireEvent.change(screen.getByLabelText(/timetable rows/i), { target: { value } })
}

describe('TimetableImport', () => {
  beforeEach(() => {
    mockListTerms.mockReset()
    mockListTerms.mockResolvedValue([finishedTerm, upcomingTerm])
    mockPreview.mockReset()
    mockPreview.mockResolvedValue(previewPayload())
    mockCommit.mockReset()
    mockCommit.mockResolvedValue({ created: 1, createdIds: [7], skipped: [], invalidCount: 0, duplicateCount: 0 })
    onImported.mockReset()
  })

  it.each(['synchronous', 'asynchronous'])('keeps confirmed import success when the %s refresh fails', async (mode) => {
    if (mode === 'synchronous') onImported.mockImplementation(() => { throw new Error('refresh failed') })
    else onImported.mockRejectedValue(new Error('refresh failed'))
    await renderImport()
    typeRows()
    fireEvent.click(screen.getByRole('button', { name: /preview import/i }))
    fireEvent.click(await screen.findByRole('button', { name: /import 1 new entry/i }))
    expect(await screen.findByText('Imported 1 schedule entry.')).toBeInTheDocument()
    expect(await screen.findByText(/was saved, but the schedule could not be refreshed/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /import 1 new entry/i })).not.toBeInTheDocument()
    expect(mockCommit).toHaveBeenCalledTimes(1)
  })

  it('does not default to an unrelated term before parsing', async () => {
    await renderImport()
    typeRows()
    fireEvent.click(screen.getByRole('button', { name: /preview import/i }))

    await screen.findByRole('heading', { name: /import preview/i })
    expect(mockPreview).toHaveBeenCalledWith(
      { source: 'CSV', text: csvText, termId: undefined, timeZone: 'UTC' },
      tokenGetter,
    )
    expect(mockCommit).not.toHaveBeenCalled()
    expect(screen.getByText(/1 new entries · ↺ 0 already in your timetable · ⚠ 0 errors/i)).toBeInTheDocument()
  })

  it('shows local times and the recurrence that will be stored for each row', async () => {
    await renderImport()
    typeRows()
    fireEvent.click(screen.getByRole('button', { name: /preview import/i }))

    const table = await screen.findByRole('table', { name: /parsed timetable rows/i })
    const [, firstRow] = within(table).getAllByRole('row')
    expect(within(firstRow).getByText(new Date('2030-09-02T09:00').toLocaleString())).toBeInTheDocument()
    expect(within(firstRow).getByText(new Date('2030-09-02T11:00').toLocaleString())).toBeInTheDocument()
    expect(within(firstRow).getByText('Maths tutorial')).toBeInTheDocument()
    expect(within(firstRow).getByText('Weekly until 2030-11-29')).toBeInTheDocument()
    expect(within(firstRow).getByText('✓ New / Ready')).toBeInTheDocument()
  })

  it('keeps a bad row beside its own message instead of rejecting the whole file', async () => {
    mockPreview.mockResolvedValue(previewPayload({ rows: [readyRow, brokenRow] }))
    await renderImport()
    typeRows()
    fireEvent.click(screen.getByRole('button', { name: /preview import/i }))

    await screen.findByRole('heading', { name: /import preview/i })
    expect(screen.getByText(/1 new entries · ↺ 0 already in your timetable · ⚠ 1 errors/i)).toBeInTheDocument()
    expect(screen.getByText('"2030-13-40" is not a valid date. Use YYYY-MM-DD.')).toBeInTheDocument()
    expect(screen.getByText('✓ New / Ready')).toBeInTheDocument()
    // Only the row that parsed can be saved, and the button says how many.
    expect(screen.getByRole('button', { name: 'Import 1 new entry' })).toBeEnabled()
  })

  it('saves exactly what was previewed, then asks the schedule to reload', async () => {
    await renderImport()
    typeRows()
    fireEvent.click(screen.getByRole('button', { name: /preview import/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Import 1 new entry' }))

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1))
    expect(mockCommit).toHaveBeenCalledWith(
      { source: 'CSV', text: csvText, termId: 2, timeZone: 'UTC' },
      tokenGetter,
    )
    expect(mockCommit.mock.calls[0][0]).toEqual({ ...mockPreview.mock.calls[0][0], termId: 2 })
    expect(await screen.findByText('Imported 1 schedule entry.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /import preview/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/timetable rows/i)).toHaveValue('')
  })

  it('reports a failed save without pretending anything was stored', async () => {
    mockCommit.mockRejectedValue(new Error('That timetable changed while you were working on it. Preview it again.'))
    await renderImport()
    typeRows()
    fireEvent.click(screen.getByRole('button', { name: /preview import/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Import 1 new entry' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/changed while you were working on it/i)
    expect(onImported).not.toHaveBeenCalled()
    // The preview stays put so the tutor can check it and try again.
    expect(screen.getByRole('heading', { name: /import preview/i })).toBeInTheDocument()
  })

  it('refuses to save when every row has a problem', async () => {
    mockPreview.mockResolvedValue(previewPayload({ rows: [brokenRow, { ...brokenRow, sourceRow: 4 }] }))
    await renderImport()
    typeRows()
    fireEvent.click(screen.getByRole('button', { name: /preview import/i }))

    await screen.findByRole('heading', { name: /import preview/i })
    expect(screen.getByRole('button', { name: 'Import 0 new entries' })).toBeDisabled()
    expect(screen.getByText(/fix the rows that need attention/i)).toBeInTheDocument()
  })

  it('handles a file with no rows at all', async () => {
    mockPreview.mockResolvedValue(previewPayload({ rows: [] }))
    await renderImport()
    typeRows('date,start,end')
    fireEvent.click(screen.getByRole('button', { name: /preview import/i }))

    expect(await screen.findByText(/that file had no rows to import/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 0 new entries' })).toBeDisabled()
  })

  it('shows a file-level problem but keeps the pasted text so it can be fixed', async () => {
    mockPreview.mockRejectedValue(new Error('Import at most 400 rows at a time. This file had 405.'))
    await renderImport()
    typeRows()
    fireEvent.click(screen.getByRole('button', { name: /preview import/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/at most 400 rows/i)
    expect(screen.getByLabelText(/timetable rows/i)).toHaveValue(csvText)
    expect(mockCommit).not.toHaveBeenCalled()
  })

  it('reads a chosen calendar file and switches the reader to the calendar format', async () => {
    await renderImport()
    const calendar = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20300902T090000\nEND:VEVENT\nEND:VCALENDAR'
    const file = new File([calendar], 'term.ics', { type: 'text/calendar' })
    fireEvent.change(screen.getByLabelText(/choose a file/i), { target: { files: [file] } })

    expect(await screen.findByText(/loaded term\.ics/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/a calendar \(\.ics\) file/i)).toBeChecked()
    expect(screen.getByLabelText(/calendar contents/i)).toHaveValue(calendar)
  })

  it('drops a stale preview when the format changes', async () => {
    await renderImport()
    typeRows()
    fireEvent.click(screen.getByRole('button', { name: /preview import/i }))
    await screen.findByRole('heading', { name: /import preview/i })

    fireEvent.click(screen.getByLabelText(/a calendar \(\.ics\) file/i))

    expect(screen.queryByRole('heading', { name: /import preview/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/calendar contents/i)).toHaveValue('')
    expect(screen.getByRole('button', { name: /preview import/i })).toBeDisabled()
  })

  it('says when terms cannot be loaded and reloads them on retry', async () => {
    mockListTerms.mockReset()
    mockListTerms.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([upcomingTerm])
    render(<TimetableImport tokenOrGetter={tokenGetter} onImported={onImported} />)

    expect(await screen.findByRole('heading', { name: /academic terms unavailable/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/academic term/i)).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    await waitFor(() => expect(screen.getByLabelText(/academic term/i)).toHaveValue(''))
    expect(screen.queryByRole('heading', { name: /academic terms unavailable/i })).not.toBeInTheDocument()
  })

  it('allows a preview to explain missing published terms', async () => {
    mockListTerms.mockResolvedValue([])
    render(<TimetableImport tokenOrGetter={tokenGetter} onImported={onImported} />)

    expect(await screen.findByRole('option', { name: /no published terms available/i })).toBeInTheDocument()
    typeRows()

    expect(screen.getByRole('button', { name: /preview import/i })).toBeEnabled()
  })
  it('provides a downloadable CSV template and visible column guidance', async () => {
    await renderImport()
    expect(screen.getByRole('link', { name: /Download CSV template/i })).toHaveAttribute('href', '/templates/timetable-template.csv')
    expect(screen.getByRole('link', { name: /Download CSV template/i })).toHaveAttribute('download', 'timetable-template.csv')
    fireEvent.click(screen.getByText('View example'))
    expect(screen.getByText(/COMS3010A Lecture - WSS5/)).toBeInTheDocument()
    expect(screen.getByText(/once \/ weekly \/ fortnightly/)).toBeInTheDocument()
  })
  it('shows duplicate rows separately and imports only new entries', async () => {
    mockPreview.mockResolvedValue(previewPayload({ rows: [readyRow, { ...readyRow, sourceRow: 3, duplicate: true }], validCount: 1, duplicateCount: 1 }))
    await renderImport(); typeRows()
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }))
    expect(await screen.findByText(/Already in your timetable — skipped/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 1 new entry' })).toBeEnabled()
  })
  it('shows the automatically detected Term 4 clearly', async () => {
    mockPreview.mockResolvedValue(previewPayload({ detectedTerm: true, term: { ...upcomingTerm, termNumber: 4, year: 2030 }, dateRange: { startsOn: '2030-09-02', endsOn: '2030-09-02' } }))
    await renderImport(); typeRows()
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }))
    expect(await screen.findByText('Automatically detected: Term 4 · 2030 ✓')).toBeInTheDocument()
  })

})
