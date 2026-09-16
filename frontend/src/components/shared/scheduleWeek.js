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
  for (const slot of slots.filter((entry) => entry.type === 'BUSY')) {
    const start = new Date(slot.startsAt)
    const end = new Date(slot.endsAt)
    let occurrenceStart = start
    let occurrenceEnd = end
    if (slot.recurrence === 'WEEKLY') {
      // Advance calendar days, not UTC milliseconds, to preserve local time across DST.
      const weeks = Math.max(0, Math.floor((weekStart - end) / 604800000))
      occurrenceStart = addDays(start, weeks * 7)
      occurrenceEnd = addDays(end, weeks * 7)
      while (occurrenceEnd <= weekStart) {
        occurrenceStart = addDays(occurrenceStart, 7)
        occurrenceEnd = addDays(occurrenceEnd, 7)
      }
    }
    while (occurrenceStart < weekEnd) {
      if (slot.recurrence === 'WEEKLY' && slot.recurrenceUntil && occurrenceStart > new Date(slot.recurrenceUntil)) break
      for (const day of days) {
        const dayEnd = addDays(day.date, 1)
        if (occurrenceStart < dayEnd && day.date < occurrenceEnd) {
          const clippedStart = new Date(Math.max(day.date, occurrenceStart))
          const clippedEnd = new Date(Math.min(dayEnd, occurrenceEnd))
          day.blocks.push({
            id: `${slot.id}-${occurrenceStart.valueOf()}-${day.date.valueOf()}`,
            label: slot.label?.trim() || 'Unavailable',
            startsAt: clippedStart,
            endsAt: clippedEnd,
            startMinute: clippedStart.getHours() * 60 + clippedStart.getMinutes(),
            endMinute: clippedEnd.valueOf() === dayEnd.valueOf() ? 1440 : clippedEnd.getHours() * 60 + clippedEnd.getMinutes(),
          })
        }
      }
      if (slot.recurrence !== 'WEEKLY') break
      occurrenceStart = addDays(occurrenceStart, 7)
      occurrenceEnd = addDays(occurrenceEnd, 7)
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
