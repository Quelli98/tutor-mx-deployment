import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildImportRequest, commitTimetableImport, currentTimeZone, isAcademicTermSummary,
  listAcademicTerms, previewTimetableImport,
} from './timetableImport'

const term = { id: 1, name: 'Demo 2030 Semester 2', startsOn: '2030-08-26', endsOn: '2030-11-29' }

const previewPayload = {
  source: 'CSV', timeZone: 'UTC', term,
  rows: [{
    sourceRow: 2, timeZone: 'UTC', localStartsAt: '2030-09-02T09:00', localEndsAt: '2030-09-02T11:00',
    localRecurrenceUntil: '2030-11-29', label: 'Maths', recurrence: 'WEEKLY', duplicate: false,
    slot: { type: 'BUSY', startsAt: '2030-09-02T09:00:00.000Z', endsAt: '2030-09-02T11:00:00.000Z', recurrence: 'WEEKLY', label: 'Maths', recurrenceUntil: '2030-11-29T23:59:59.999Z' },
    errors: [],
  }],
  validCount: 1, invalidCount: 0, duplicateCount: 0,
}

const commitPayload = { created: 1, createdIds: [7], skipped: [], invalidCount: 0, duplicateCount: 0 }

/** The real caller passes Auth0's getAccessTokenSilently, which resolves a token. */
const token = () => Promise.resolve('token-1')

function respond(body) {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body })
}

describe('buildImportRequest', () => {
  it('uses the configured timetable time zone independently of the browser zone', () => {
    const request = buildImportRequest({ source: 'CSV', text: 'a', termId: 3 })

    expect(currentTimeZone()).toBe('Africa/Johannesburg')
    expect(request).toEqual({ source: 'CSV', text: 'a', timeZone: currentTimeZone(), termId: 3 })
  })

  it('omits the term for automatic detection and preserves an explicit source time zone', () => {
    expect(buildImportRequest({ source: 'CSV', text: 'a', timeZone: 'UTC' }))
      .toEqual({ source: 'CSV', text: 'a', timeZone: 'UTC' })
  })

  it('rejects a missing format, empty text, oversized text and an invalid term', () => {
    expect(() => buildImportRequest({ source: 'XLSX', text: 'a', termId: 1 })).toThrow(/csv|calendar/i)
    expect(() => buildImportRequest({ source: 'CSV', text: '  ', termId: 1 })).toThrow(/paste or choose/i)
    expect(() => buildImportRequest({ source: 'CSV', text: 'x'.repeat(30_001), termId: 1 })).toThrow(/too large/i)
    expect(() => buildImportRequest({ source: 'CSV', text: 'a', termId: 0 })).toThrow(/academic term/i)
  })
})

describe('isAcademicTermSummary', () => {
  it('requires ordered ISO calendar days', () => {
    expect(isAcademicTermSummary(term)).toBe(true)
    expect(isAcademicTermSummary({ ...term, endsOn: '2030-08-01' })).toBe(false)
    expect(isAcademicTermSummary({ ...term, startsOn: '26/08/2030' })).toBe(false)
    expect(isAcademicTermSummary({ ...term, name: '  ' })).toBe(false)
    expect(isAcademicTermSummary(null)).toBe(false)
  })
})

describe('listAcademicTerms', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('returns the validated term list', async () => {
    respond({ data: { academicTerms: [term] } })

    await expect(listAcademicTerms(token)).resolves.toEqual([term])
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/academic-terms'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-1' }) }),
    )
  })

  it('rejects a response that breaks the contract', async () => {
    respond({ data: { academicTerms: [{ id: 1, name: 'T', startsOn: 'nope', endsOn: 'nope' }] } })

    await expect(listAcademicTerms(token)).rejects.toThrow(/agreed contract/i)
  })
})

describe('previewTimetableImport', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('posts the request and returns the preview', async () => {
    respond({ data: { preview: previewPayload } })

    const preview = await previewTimetableImport(
      { source: 'CSV', text: 'date,start,end', termId: 1, timeZone: 'UTC' }, token,
    )

    expect(preview).toEqual(previewPayload)
    const [url, options] = globalThis.fetch.mock.calls[0]
    expect(url).toContain('/api/tutor/time-slots/import/preview')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ source: 'CSV', text: 'date,start,end', timeZone: 'UTC', termId: 1 })
  })

  it('rejects a preview whose rows break the contract', async () => {
    respond({ data: { preview: { ...previewPayload, rows: [{ sourceRow: 1 }] } } })

    await expect(
      previewTimetableImport({ source: 'CSV', text: 'a', termId: 1, timeZone: 'UTC' }, token),
    ).rejects.toThrow(/agreed contract/i)
  })
})

describe('commitTimetableImport', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('posts to the commit route and returns the result', async () => {
    respond({ data: { result: commitPayload } })

    await expect(
      commitTimetableImport({ source: 'ICS', text: 'BEGIN:VEVENT', termId: 2, timeZone: 'UTC' }, token),
    ).resolves.toEqual(commitPayload)
    expect(globalThis.fetch.mock.calls[0][0]).toContain('/api/tutor/time-slots/import/commit')
  })

  it('rejects a result that breaks the contract', async () => {
    respond({ data: { result: { created: 1 } } })

    await expect(
      commitTimetableImport({ source: 'CSV', text: 'a', termId: 1, timeZone: 'UTC' }, token),
    ).rejects.toThrow(/agreed contract/i)
  })
})
