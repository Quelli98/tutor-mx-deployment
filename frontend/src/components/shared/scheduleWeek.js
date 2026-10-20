import { attendanceLabel, sessionDay } from './attendance'
export function addDays(date, days) {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

export function localMonday(date) {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  return addDays(start, -((start.getDay() + 6) % 7))
}

export function weekRangeLabel(start) {
  const end = addDays(start, 6)
  const full = (date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${start.getDate()}–${full(end)}`
  }
  return `${full(start)} – ${full(end)}`
}

export function localTime(date) {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function scheduleForWeek(slots, weekStart) {
  const weekEnd = addDays(weekStart, 7)
  const days = Array.from({ length: 7 }, (_, index) => ({ date: addDays(weekStart, index), blocks: [] }))
  const entries = slots.flatMap((slot) => [slot, ...(slot.exceptions ?? [])
    .filter((item) => item.exceptionType !== 'CANCELLED' && item.newStartsAt && item.newEndsAt)
    .map((item) => ({ ...slot, id: `${slot.id}-moved-${item.occurrenceDate}`, startsAt: item.newStartsAt,
      endsAt: item.newEndsAt, recurrence: null, recurrenceUntil: null, exceptions: [], teachingBreaks: [] }))])
  for (const slot of entries) {
    const isAllocation = slot.kind === 'allocation'
    if (isAllocation && slot.occurrenceStatus === 'EXCUSED') continue
    if (!isAllocation && slot.type !== 'BUSY') continue
    const start = new Date(slot.startsAt)
    const end = new Date(slot.endsAt)
    let occurrenceStart = start
    let occurrenceEnd = end
    const period = slot.recurrence === 'FORTNIGHTLY' ? 14 : slot.recurrence === 'WEEKLY' ? 7 : 0
    if (period > 0) {
      const periodMs = period * 86400000
      const periods = Math.max(0, Math.floor((weekStart - end) / periodMs))
      occurrenceStart = addDays(start, periods * period)
      occurrenceEnd = addDays(end, periods * period)
      while (occurrenceEnd <= weekStart) {
        occurrenceStart = addDays(occurrenceStart, period)
        occurrenceEnd = addDays(occurrenceEnd, period)
      }
    }
    while (occurrenceStart < weekEnd) {
      if (period > 0 && slot.recurrenceUntil && occurrenceStart > new Date(slot.recurrenceUntil)) break
      const occurrenceDay = sessionDay(occurrenceStart)
      const exception = slot.exceptions?.find((item) => item.occurrenceDate === occurrenceDay)
      const paused = period > 0 && slot.teachingBreaks?.some((item) => occurrenceDay >= item.startsOn && occurrenceDay <= item.endsOn)
      const hidden = exception?.exceptionType === 'CANCELLED' || exception?.newStartsAt || paused
      const shownStart = exception?.newStartsAt ? new Date(exception.newStartsAt) : occurrenceStart
      const shownEnd = exception?.newEndsAt ? new Date(exception.newEndsAt) : occurrenceEnd
      for (const day of days) {
        const dayEnd = addDays(day.date, 1)
        if (!hidden && shownStart < dayEnd && day.date < shownEnd) {
          const clippedStart = new Date(Math.max(day.date, shownStart))
          const clippedEnd = new Date(Math.min(dayEnd, shownEnd))
          day.blocks.push({
            id: `${slot.id ?? 'alloc'}-${occurrenceStart.valueOf()}-${day.date.valueOf()}`,
            label: slot.label?.trim() || (isAllocation ? 'Tutoring' : 'Unavailable'),
            startsAt: clippedStart,
            endsAt: clippedEnd,
            startMinute: clippedStart.getHours() * 60 + clippedStart.getMinutes(),
            endMinute: clippedEnd.valueOf() === dayEnd.valueOf() ? 1440 : clippedEnd.getHours() * 60 + clippedEnd.getMinutes(),
            category: slot.category ?? (isAllocation ? 'TUTORING' : 'UNAVAILABLE'),
            kind: isAllocation ? 'allocation' : 'slot',
            occurrenceStatus: slot.occurrenceStatus,
            attendanceLabel: attendanceLabel(slot),
          })
        }
      }
      if (period === 0) break
      occurrenceStart = addDays(occurrenceStart, period)
      occurrenceEnd = addDays(occurrenceEnd, period)
    }
  }
  for (const day of days) {
    const laneEnds = []
    day.blocks.sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute)
    for (const block of day.blocks) {
      let lane = laneEnds.findIndex((end) => end <= block.startMinute)
      if (lane === -1) lane = laneEnds.length
      laneEnds[lane] = block.endMinute
      block.lane = lane + 1
    }
    day.lanes = Math.max(1, laneEnds.length)
  }
  return days
}

/**
 * A session length said the way a person would: "2 hours", "1 hour 30 minutes",
 * "45 minutes".
 *
 * The wording is duplicated from sessionLengthText in src/app.ts on purpose -
 * the browser cannot import server code - and both sides are checked against the
 * same table of examples so they can never drift apart.
 */
export function sessionLengthText(startsAt, endsAt) {
  const totalMinutes = Math.round((endsAt.valueOf() - startsAt.valueOf()) / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const parts = []

  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`)
  if (minutes > 0 || hours === 0) {
    parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`)
  }

  return parts.join(' ')
}

/**
 * A tutoring session is a slot in a day, not a term. Duplicated from
 * MAX_SESSION_HOURS in src/app.ts for the same reason as sessionLengthText, and
 * pinned by the same agreement test. The server and the database refuse anything
 * longer; this only saves the organiser a round trip.
 */
export const MAX_SESSION_HOURS = 8

export function maximumSessionLengthMessage(startsAt, endsAt) {
  return `A session cannot be longer than ${MAX_SESSION_HOURS} hours. This one is ${sessionLengthText(startsAt, endsAt)}. Check the start and end dates.`
}

const DAY_MS = 86_400_000

function periodDays(recurrence) {
  if (recurrence === 'FORTNIGHTLY') return 14
  if (recurrence === 'WEEKLY') return 7
  return 0
}

/**
 * The next occurrences of a repeating entry that have not finished yet, named
 * by the Johannesburg date they start on: the same key the server and the
 * weekly calendar use for an exception.
 */
export function upcomingOccurrences(slot, now = new Date(), count = 12) {
  const period = periodDays(slot.recurrence)
  if (!period) return []
  const start = new Date(slot.startsAt)
  const end = new Date(slot.endsAt)
  const until = slot.recurrenceUntil ? new Date(slot.recurrenceUntil) : null
  const step = period * DAY_MS
  const result = []
  for (let k = Math.max(0, Math.floor((now - end) / step)); result.length < count; k += 1) {
    const startsAt = new Date(start.valueOf() + k * step)
    if (until && startsAt > until) break
    const endsAt = new Date(end.valueOf() + k * step)
    if (endsAt > now) result.push({ date: sessionDay(startsAt), startsAt, endsAt })
  }
  return result
}
