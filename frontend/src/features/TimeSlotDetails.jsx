function formatDateTime(value) {
  return new Date(value).toLocaleString()
}

// Shared wording keeps the tutor editor and organiser read-only view consistent.
export default function TimeSlotDetails({ slot }) {
  return (
    <>
      <strong>Busy{slot.label ? ` — ${slot.label}` : ''}</strong>
      <span>First occurrence: {formatDateTime(slot.startsAt)} to {formatDateTime(slot.endsAt)}</span>
      <span>
        {slot.recurrence === 'WEEKLY'
          ? `Repeats weekly from ${formatDateTime(slot.startsAt)}${slot.recurrenceUntil
            ? ` through ${formatDateTime(slot.recurrenceUntil)} (inclusive last occurrence start).`
            : ', indefinitely (no last occurrence start).'
          }`
          : 'Once-off (does not repeat).'}
      </span>
    </>
  )
}
