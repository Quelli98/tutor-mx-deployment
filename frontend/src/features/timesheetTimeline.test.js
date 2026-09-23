import { describe, expect, it } from 'vitest'
import { buildTimeline, formatMoment, hoursLabel } from './timesheetTimeline'

const statement = 'I confirm the hours on this timesheet are accurate.'

function history(overrides = {}) {
  return {
    timesheet: {
      id: 12,
      weekStart: '2030-09-02',
      status: 'RETURNED',
      submittedAt: '2030-09-06T12:00:00.000Z',
      reviewedAt: '2030-09-09T08:30:00.000Z',
      reviewReason: 'Please correct Tuesday hours',
      totalHours: 4.5,
      editable: true,
      ...overrides.timesheet,
    },
    workLogs: [
      {
        id: 2,
        timesheetId: 12,
        allocationId: 2,
        workDate: '2030-09-03',
        hours: 2.5,
        description: 'Tuesday lab',
      },
    ],
    revisions: [
      {
        id: 5,
        kind: 'RETURN',
        workLogId: null,
        authorProfileId: 8,
        reason: 'Please correct Tuesday hours',
        previousHours: null,
        previousDescription: null,
        newHours: null,
        newDescription: null,
        createdAt: '2030-09-09T08:30:05.000Z',
      },
    ],
    declarations: [],
    disputes: [],
    declaration: { statementVersion: 's3-m3-v1', statement },
    ...overrides,
  }
}

const correction = {
  id: 6,
  kind: 'CORRECTION',
  workLogId: 2,
  authorProfileId: 7,
  reason: 'Please correct Tuesday hours',
  previousHours: 2.5,
  previousDescription: 'Tuesday lab',
  newHours: 1.5,
  newDescription: 'Shortened Tuesday lab',
  createdAt: '2030-09-10T09:00:00.000Z',
}

const declaration = {
  id: 3,
  timesheetId: 12,
  statementVersion: 's3-m3-v1',
  declaredAt: '2030-09-10T09:05:00.000Z',
}

const dispute = {
  id: 4,
  timesheetId: 12,
  tutorId: 7,
  reason: 'The session ran the full two hours',
  status: 'OPEN',
  raisedByProfileId: 7,
  resolvedByProfileId: null,
  resolutionReason: null,
  resolvedAt: null,
  createdAt: '2030-09-11T10:00:00.000Z',
}

describe('buildTimeline', () => {
  it('has nothing to show without a history', () => {
    expect(buildTimeline(null)).toEqual([])
  })

  it('orders the story of a week by when each event happened', () => {
    const events = buildTimeline(
      history({
        timesheet: { submittedAt: '2030-09-12T11:00:00.000Z' },
        revisions: [correction, ...history().revisions],
        declarations: [declaration],
      }),
    )

    expect(events.map((event) => event.kind)).toEqual([
      'RETURN',
      'CORRECTION',
      'DECLARATION',
      'SUBMITTED',
    ])
    expect(events.at(-1).title).toBe('Sent for review')
  })

  it('puts an event that answers another one after it', () => {
    const sameMoment = '2030-09-10T09:00:00.000Z'
    const events = buildTimeline(
      history({
        revisions: [{ ...correction, createdAt: sameMoment }],
        declarations: [{ ...declaration, declaredAt: sameMoment }],
      }),
    )

    expect(events.map((event) => event.kind)).toEqual([
      'SUBMITTED',
      'CORRECTION',
      'DECLARATION',
    ])
  })

  it('keeps the figures a correction replaced beside the new ones', () => {
    const events = buildTimeline(history({ revisions: [correction] }))
    const corrected = events.find((event) => event.kind === 'CORRECTION')

    expect(corrected.title).toBe('Corrected')
    expect(corrected.detail).toContain('2.5h to 1.5h')
    expect(corrected.detail).toContain('Tuesday lab')
    expect(corrected.detail).toContain('Shortened Tuesday lab')
  })

  it('records who acknowledged which declaration wording, and when', () => {
    const events = buildTimeline(history({ declarations: [declaration] }))
    const acknowledged = events.find((event) => event.kind === 'DECLARATION')

    expect(acknowledged.detail).toBe('Wording version s3-m3-v1')
    expect(acknowledged.at).toBe('2030-09-10T09:05:00.000Z')
  })

  it('answers a dispute with the organiser resolution', () => {
    const events = buildTimeline(
      history({
        disputes: [
          {
            ...dispute,
            status: 'RESOLVED',
            resolvedByProfileId: 8,
            resolutionReason: 'Hours corrected after all',
            resolvedAt: '2030-09-12T09:00:00.000Z',
          },
        ],
      }),
    )

    expect(events.map((event) => event.kind)).toEqual([
      'SUBMITTED',
      'RETURN',
      'DISPUTE',
      'RESOLUTION',
    ])
    expect(events[2].detail).toBe('Reason: The session ran the full two hours')
    expect(events[3].detail).toBe('Answer: Hours corrected after all')
  })

  it('says so plainly when hours or a description are missing', () => {
    const events = buildTimeline(
      history({
        revisions: [
          {
            ...correction,
            previousHours: null,
            previousDescription: null,
            newHours: null,
            newDescription: '',
          },
        ],
      }),
    )

    const corrected = events.find((event) => event.kind === 'CORRECTION')
    expect(corrected.detail).toContain('no hours recorded')
    expect(corrected.detail).toContain('no description')
  })
})

describe('timeline labels', () => {
  it('prints hours without trailing zeros', () => {
    expect(hoursLabel(2)).toBe('2h')
    expect(hoursLabel(1.5)).toBe('1.5h')
    expect(hoursLabel(null)).toBe('no hours recorded')
  })

  it('falls back to the raw value when a moment cannot be read', () => {
    expect(formatMoment(null)).toBe('')
    expect(formatMoment('not a date')).toBe('not a date')
  })
})
