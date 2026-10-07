export function attendanceLabel(allocation) {
  if (allocation.occurrenceStatus === 'SKIPPED') return 'Skipped · Sick'
  if (allocation.occurrenceStatus === 'EXCUSED') return 'Excused · Sick'
  if (allocation.excusePending) return 'Excuse pending'
  return ''
}
export function sessionDay(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value))
  const read = (type) => parts.find((part) => part.type === type).value
  return `${read('year')}-${read('month')}-${read('day')}`
}
export const sickStyle = { background: '#fef3c7', borderColor: '#b45309', color: '#78350f' }
