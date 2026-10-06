import { addDays, localMonday, scheduleForWeek } from '../components/shared/scheduleWeek'

const DAY_MS = 86_400_000

const isFuture = (value, now) => new Date(value) > now

/** The figures the Student home leads with, from the lists the page already loads. */
export function studentSummary({ workItems = [], requests = [], now = new Date() }) {
  const approved = requests.filter((request) => request.status === 'ACCEPTED')
  const upcoming = approved
    .filter((request) => isFuture(request.endsAt, now))
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
  return {
    openCount: workItems.filter((work) => work.status === 'OPEN').length,
    pendingCount: requests.filter((request) => request.status === 'PENDING').length,
    upcomingCount: upcoming.length,
    nextSession: upcoming[0] ?? null,
    approvedHours: Math.round(approved.reduce((total, request) => total + Number(request.hours || 0), 0) * 100) / 100,
  }
}

/**
 * Everything on the Student's calendar between `from` and `to`: their own
 * classes and busy times (repeating entries expanded by the same rules as My
 * timetable) and the volunteer sessions an organiser approved.
 */
export function scheduleItems({ slots = [], requests = [], from, to }) {
  const items = new Map()
  for (let monday = localMonday(from); monday < to; monday = addDays(monday, 7)) {
    for (const day of scheduleForWeek(slots, monday)) {
      for (const block of day.blocks) {
        if (block.endsAt <= from || block.startsAt >= to) continue
        // A block that runs past midnight is split per day; keep it once.
        const key = block.id.split('-').slice(0, -1).join('-')
        const existing = items.get(key)
        if (existing) {
          existing.endsAt = new Date(Math.max(existing.endsAt, block.endsAt))
          continue
        }
        items.set(key, {
          key,
          kind: block.category === 'CLASS' ? 'class' : 'busy',
          title: block.label,
          startsAt: block.startsAt,
          endsAt: block.endsAt,
        })
      }
    }
  }
  for (const request of requests) {
    if (request.status !== 'ACCEPTED') continue
    const startsAt = new Date(request.startsAt)
    const endsAt = new Date(request.endsAt)
    if (endsAt <= from || startsAt >= to) continue
    items.set(`volunteer-${request.id}`, {
      key: `volunteer-${request.id}`,
      kind: 'volunteer',
      title: `${request.courseCode} volunteer session`,
      startsAt,
      endsAt,
    })
  }
  return [...items.values()].sort((a, b) => a.startsAt - b.startsAt || a.title.localeCompare(b.title))
}

/** The weeks (Monday first) of the month that contains `monthStart`; days outside it are null. */
export function monthGrid(monthStart) {
  const first = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1)
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const leading = (first.getDay() + 6) % 7
  const cells = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => new Date(first.getFullYear(), first.getMonth(), index + 1)),
  ]
  while (cells.length % 7) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7))
}

export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function daysFrom(now, days) {
  return new Date(now.valueOf() + days * DAY_MS)
}

const COURSE_TONES = ['accent-pink', 'accent-blue', 'accent-orchid', 'accent-coral', 'accent-navy', 'accent-purple']

/** One colour per course code, in code order, so a course looks the same in every list. */
export function courseTones(codes) {
  const unique = [...new Set(codes.filter(Boolean))].sort()
  return new Map(unique.map((code, index) => [code, COURSE_TONES[index % COURSE_TONES.length]]))
}

const dayKey = (value) => {
  const date = new Date(value)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/** Open work grouped by the day each session starts, soonest first. */
export function workByDay(workItems) {
  const days = new Map()
  for (const work of [...workItems].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))) {
    const key = dayKey(work.startsAt)
    if (!days.has(key)) {
      const start = new Date(work.startsAt)
      days.set(key, { key, date: new Date(start.getFullYear(), start.getMonth(), start.getDate()), items: [] })
    }
    days.get(key).items.push(work)
  }
  return [...days.values()]
}

/**
 * Requests still in play (waiting for an organiser, or approved and not over yet), soonest first,
 * and the rest (finished, not approved or withdrawn), most recent first.
 */
export function splitRequests(requests, now = new Date()) {
  const isCurrent = (request) =>
    request.status === 'PENDING' || (request.status === 'ACCEPTED' && isFuture(request.endsAt, now))
  return {
    current: requests.filter(isCurrent).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)),
    past: requests.filter((request) => !isCurrent(request)).sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt)),
  }
}
