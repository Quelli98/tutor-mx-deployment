function formatDate(value) {
  return new Date(value).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function TimeSlotDetails({ slot }) {
  const start = new Date(slot.startsAt)
  const dayName = start.toLocaleDateString(undefined, { weekday: 'long' })
  const timeRange = `${formatTime(slot.startsAt)}–${formatTime(slot.endsAt)}`

  return (
    <>
      <strong>{slot.label || 'Unavailable'}</strong>
      <span>
        {slot.recurrence === 'WEEKLY'
          ? `Every ${dayName} · ${timeRange}`
          : `${formatDate(slot.startsAt)} · ${timeRange}`}
      </span>
      {slot.recurrence === 'WEEKLY' && (
        <span>
          From {formatDate(slot.startsAt)}
          {slot.recurrenceUntil ? ` until ${formatDate(slot.recurrenceUntil)}` : ' (ongoing)'}
        </span>
      )}
    </>
  )
}
