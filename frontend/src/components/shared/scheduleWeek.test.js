import { describe, expect, it } from 'vitest'
import { sessionLengthText } from './scheduleWeek'

describe('sessionLengthText', () => {
  // The server produces the same words from the same windows; src/app.test.ts
  // runs this identical table, so the two cannot drift apart.
  it.each([
      ['2030-09-04T10:00:00.000Z', '2030-09-04T12:00:00.000Z', '2 hours'],
      ['2030-09-04T10:00:00.000Z', '2030-09-04T11:00:00.000Z', '1 hour'],
      ['2030-09-04T10:00:00.000Z', '2030-09-04T11:30:00.000Z', '1 hour 30 minutes'],
      ['2030-09-04T10:00:00.000Z', '2030-09-04T12:45:00.000Z', '2 hours 45 minutes'],
      ['2030-09-04T10:00:00.000Z', '2030-09-04T10:45:00.000Z', '45 minutes'],
      ['2030-09-04T10:00:00.000Z', '2030-09-04T10:20:00.000Z', '20 minutes'],
      ['2030-09-04T10:00:00.000Z', '2030-09-04T10:01:00.000Z', '1 minute'],
      ['2030-09-04T10:00:00.000Z', '2030-09-04T11:01:00.000Z', '1 hour 1 minute'],
  ])('says %s to %s as %s', (startsAt, endsAt, expected) => {
    expect(sessionLengthText(new Date(startsAt), new Date(endsAt))).toBe(expected)
  })
})
